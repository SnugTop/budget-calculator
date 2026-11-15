import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { newPlan, looksLikePlan } from '../shared/ops';
import { hashPassword, newToken, verifyPassword } from './auth';
import type { Db } from './db';
import { plans, sessions, users } from './schema';

const SESSION_DAYS = 180;
const COOKIE = 'sid';
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

type Env = { Variables: { userId: number } };

export function createApp(db: Db, opts: { allowSignup: boolean }) {
  const app = new Hono<Env>();
  const api = new Hono<Env>();

  const startSession = (c: Parameters<typeof setCookie>[0], userId: number) => {
    const token = newToken();
    const maxAge = SESSION_DAYS * 86_400;
    db.insert(sessions)
      .values({ token, userId, expiresAt: Date.now() + maxAge * 1000 })
      .run();
    // Not marked Secure: the app is served over plain http on a home network.
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge });
  };

  const validName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(s);
  const validPassword = (s: unknown): s is string => typeof s === 'string' && s.length >= 8 && s.length <= 200;

  // ---- accounts

  api.get('/config', (c) => c.json({ allowSignup: opts.allowSignup }));

  api.post('/register', async (c) => {
    if (!opts.allowSignup) return c.json({ error: 'New profiles are turned off on this server.' }, 403);
    const body = await c.req.json().catch(() => ({}));
    if (!validName(body.username)) {
      return c.json({ error: 'Use 3 to 32 letters, numbers, dots, dashes or underscores for the username.' }, 400);
    }
    if (!validPassword(body.password)) return c.json({ error: 'Use a password of at least 8 characters.' }, 400);
    const username = body.username.toLowerCase();
    if (db.select().from(users).where(eq(users.username, username)).get()) {
      return c.json({ error: 'That username is taken.' }, 409);
    }
    const user = db
      .insert(users)
      .values({ username, passwordHash: hashPassword(body.password), createdAt: now() })
      .returning()
      .get();
    db.insert(plans)
      .values({ userId: user.id, name: 'Live plan', isLive: true, data: newPlan(today()), updatedAt: now() })
      .run();
    startSession(c, user.id);
    return c.json({ username: user.username });
  });

  api.post('/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.toLowerCase() : '';
    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user || typeof body.password !== 'string' || !verifyPassword(body.password, user.passwordHash)) {
      return c.json({ error: 'Wrong username or password.' }, 401);
    }
    startSession(c, user.id);
    return c.json({ username: user.username });
  });

  api.post('/logout', (c) => {
    const token = getCookie(c, COOKIE);
    if (token) db.delete(sessions).where(eq(sessions.token, token)).run();
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---- everything below needs a signed-in profile

  api.use('*', async (c, next) => {
    const token = getCookie(c, COOKIE);
    const session = token ? db.select().from(sessions).where(eq(sessions.token, token)).get() : undefined;
    if (!session || session.expiresAt < Date.now()) return c.json({ error: 'Sign in first.' }, 401);
    c.set('userId', session.userId);
    await next();
  });

  api.get('/me', (c) => {
    const user = db.select().from(users).where(eq(users.id, c.get('userId'))).get();
    return user ? c.json({ username: user.username }) : c.json({ error: 'Sign in first.' }, 401);
  });

  api.post('/password', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const user = db.select().from(users).where(eq(users.id, c.get('userId'))).get();
    if (!user || typeof body.current !== 'string' || !verifyPassword(body.current, user.passwordHash)) {
      return c.json({ error: 'The current password is wrong.' }, 400);
    }
    if (!validPassword(body.next)) return c.json({ error: 'Use a password of at least 8 characters.' }, 400);
    db.update(users).set({ passwordHash: hashPassword(body.next) }).where(eq(users.id, user.id)).run();
    return c.json({ ok: true });
  });

  // ---- plans

  const mine = (c: { get: (k: 'userId') => number }, id: number) =>
    db
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.userId, c.get('userId'))))
      .get();

  api.get('/plans', (c) => {
    const rows = db.select().from(plans).where(eq(plans.userId, c.get('userId'))).all();
    return c.json(
      rows.map((r) => ({ id: r.id, name: r.name, isLive: r.isLive, version: r.version, updatedAt: r.updatedAt })),
    );
  });

  api.get('/plans/:id', (c) => {
    const row = mine(c, Number(c.req.param('id')));
    return row ? c.json(row) : c.json({ error: 'Plan not found.' }, 404);
  });

  /** Save a plan. Refused when another device saved first, so nothing is overwritten unseen. */
  api.put('/plans/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    if (!looksLikePlan(body.data) || typeof body.version !== 'number') {
      return c.json({ error: 'That is not a valid plan.' }, 400);
    }
    const result = db
      .update(plans)
      .set({ data: body.data, version: body.version + 1, updatedAt: now() })
      .where(and(eq(plans.id, id), eq(plans.userId, c.get('userId')), eq(plans.version, body.version)))
      .run();
    if (result.changes === 0) {
      return mine(c, id)
        ? c.json({ error: 'This plan was changed on another device. Reload to see the latest.' }, 409)
        : c.json({ error: 'Plan not found.' }, 404);
    }
    return c.json({ version: body.version + 1 });
  });

  /** Start a what-if: a named copy of another plan. */
  api.post('/plans', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const from = mine(c, Number(body.fromId));
    if (!from) return c.json({ error: 'Plan not found.' }, 404);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'What-if';
    const row = db
      .insert(plans)
      .values({ userId: c.get('userId'), name, isLive: false, data: from.data, updatedAt: now() })
      .returning()
      .get();
    return c.json(row);
  });

  /** Make a what-if the live plan, then drop the what-if. */
  api.post('/plans/:id/apply', (c) => {
    const scenario = mine(c, Number(c.req.param('id')));
    if (!scenario || scenario.isLive) return c.json({ error: 'What-if not found.' }, 404);
    const live = db
      .select()
      .from(plans)
      .where(and(eq(plans.userId, c.get('userId')), eq(plans.isLive, true)))
      .get();
    if (!live) return c.json({ error: 'Live plan not found.' }, 404);
    db.transaction((tx) => {
      tx.update(plans)
        .set({ data: scenario.data, version: live.version + 1, updatedAt: now() })
        .where(eq(plans.id, live.id))
        .run();
      tx.delete(plans).where(eq(plans.id, scenario.id)).run();
    });
    return c.json({ id: live.id });
  });

  api.delete('/plans/:id', (c) => {
    const row = mine(c, Number(c.req.param('id')));
    if (!row) return c.json({ error: 'Plan not found.' }, 404);
    if (row.isLive) return c.json({ error: 'The live plan cannot be deleted.' }, 400);
    db.delete(plans).where(eq(plans.id, row.id)).run();
    return c.json({ ok: true });
  });

  app.route('/api', api);
  return app;
}
