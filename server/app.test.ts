import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb } from './db';

function setup(allowSignup = true) {
  const { db } = openDb(':memory:');
  const app = createApp(db, { allowSignup });
  /** A tiny browser: remembers the session cookie between requests. */
  const client = () => {
    let cookie = '';
    return async (method: string, url: string, body?: unknown) => {
      const res = await app.request(url, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, json: (await res.json()) as any };
    };
  };
  return { client };
}

describe('accounts', () => {
  it('registers, signs in, and keeps profiles apart', async () => {
    const { client } = setup();
    const sam = client();
    const alex = client();

    expect((await sam('GET', '/api/me')).status).toBe(401);
    expect((await sam('POST', '/api/register', { username: 'Sam', password: 'correct horse' })).status).toBe(200);
    expect((await sam('GET', '/api/me')).json.username).toBe('sam');
    expect((await alex('POST', '/api/register', { username: 'sam', password: 'another one' })).status).toBe(409);
    expect((await alex('POST', '/api/register', { username: 'alex', password: 'another one' })).status).toBe(200);

    const samPlans = (await sam('GET', '/api/plans')).json;
    const alexPlans = (await alex('GET', '/api/plans')).json;
    expect(samPlans).toHaveLength(1);
    expect(samPlans[0].isLive).toBe(true);
    expect((await alex('GET', `/api/plans/${samPlans[0].id}`)).status).toBe(404);
    expect((await alex('GET', `/api/plans/${alexPlans[0].id}`)).status).toBe(200);

    await sam('POST', '/api/logout');
    expect((await sam('GET', '/api/me')).status).toBe(401);
    expect((await sam('POST', '/api/login', { username: 'sam', password: 'wrong' })).status).toBe(401);
    expect((await sam('POST', '/api/login', { username: 'sam', password: 'correct horse' })).status).toBe(200);
  });

  it('rejects weak input and honours the signup switch', async () => {
    const open = setup().client();
    expect((await open('POST', '/api/register', { username: 'ab', password: 'long enough' })).status).toBe(400);
    expect((await open('POST', '/api/register', { username: 'sam', password: 'short' })).status).toBe(400);
    const closed = setup(false).client();
    expect((await closed('POST', '/api/register', { username: 'sam', password: 'long enough' })).status).toBe(403);
  });
});

describe('plans', () => {
  it('saves with a version check so two devices cannot overwrite each other', async () => {
    const { client } = setup();
    const laptop = client();
    await laptop('POST', '/api/register', { username: 'sam', password: 'correct horse' });
    const phone = client();
    await phone('POST', '/api/login', { username: 'sam', password: 'correct horse' });

    const id = (await laptop('GET', '/api/plans')).json[0].id;
    const plan = (await laptop('GET', `/api/plans/${id}`)).json;
    plan.data.partnerName = 'Alex';

    expect((await laptop('PUT', `/api/plans/${id}`, { data: plan.data, version: plan.version })).json.version).toBe(2);
    expect((await phone('PUT', `/api/plans/${id}`, { data: plan.data, version: plan.version })).status).toBe(409);
    expect((await phone('GET', `/api/plans/${id}`)).json.data.partnerName).toBe('Alex');
    expect((await laptop('PUT', `/api/plans/${id}`, { data: { nope: true }, version: 2 })).status).toBe(400);
  });

  it('copies a plan into a what-if, then applies or discards it', async () => {
    const { client } = setup();
    const sam = client();
    await sam('POST', '/api/register', { username: 'sam', password: 'correct horse' });
    const liveId = (await sam('GET', '/api/plans')).json[0].id;

    const whatIf = (await sam('POST', '/api/plans', { fromId: liveId, name: 'New car' })).json;
    expect(whatIf.isLive).toBe(false);
    whatIf.data.partnerName = 'Changed';
    await sam('PUT', `/api/plans/${whatIf.id}`, { data: whatIf.data, version: whatIf.version });
    expect((await sam('GET', `/api/plans/${liveId}`)).json.data.partnerName).toBe('Partner');

    expect((await sam('DELETE', `/api/plans/${liveId}`)).status).toBe(400);
    expect((await sam('POST', `/api/plans/${whatIf.id}/apply`)).status).toBe(200);
    expect((await sam('GET', `/api/plans/${liveId}`)).json.data.partnerName).toBe('Changed');
    expect((await sam('GET', '/api/plans')).json).toHaveLength(1);

    const second = (await sam('POST', '/api/plans', { fromId: liveId })).json;
    expect((await sam('DELETE', `/api/plans/${second.id}`)).status).toBe(200);
    expect((await sam('GET', '/api/plans')).json).toHaveLength(1);
  });
});
