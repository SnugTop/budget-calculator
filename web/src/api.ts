import type { Plan } from '../../shared/types';

export interface PlanMeta {
  id: number;
  name: string;
  isLive: boolean;
  version: number;
  updatedAt: string;
}
export interface PlanRow extends PlanMeta {
  data: Plan;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'Something went wrong.');
  return json as T;
}

export const api = {
  config: () => call<{ allowSignup: boolean }>('GET', '/config'),
  me: () => call<{ username: string }>('GET', '/me'),
  register: (username: string, password: string) => call<{ username: string }>('POST', '/register', { username, password }),
  login: (username: string, password: string) => call<{ username: string }>('POST', '/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/logout'),
  password: (current: string, next: string) => call<{ ok: true }>('POST', '/password', { current, next }),
  plans: () => call<PlanMeta[]>('GET', '/plans'),
  plan: (id: number) => call<PlanRow>('GET', `/plans/${id}`),
  save: (id: number, data: Plan, version: number) => call<{ version: number }>('PUT', `/plans/${id}`, { data, version }),
  copy: (fromId: number, name: string) => call<PlanRow>('POST', '/plans', { fromId, name }),
  apply: (id: number) => call<{ id: number }>('POST', `/plans/${id}/apply`),
  remove: (id: number) => call<{ ok: true }>('DELETE', `/plans/${id}`),
};
