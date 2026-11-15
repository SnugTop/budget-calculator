import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { Button, Card, cx, Field, inputClass } from './ui';

export function Login({ onDone }: { onDone: (username: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [allowSignup, setAllowSignup] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.config().then((c) => setAllowSignup(c.allowSignup)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      onDone(res.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">Budget Calculator</h1>
        <span className="text-muted">Plan each paycheck: what it covers and what is left.</span>
      </div>
      <Card>
        {allowSignup && (
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-ground p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError('');
                }}
                className={cx('min-h-11 rounded-md text-sm font-medium', mode === m ? 'bg-card text-ink shadow-sm' : 'text-muted')}
              >
                {m === 'login' ? 'Sign in' : 'New profile'}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Username">
            {(id) => (
              <input id={id} className={inputClass} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
            )}
          </Field>
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
            {(id) => (
              <input
                id={id}
                type="password"
                className={inputClass}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-short">
              {error}
            </p>
          )}
          <Button kind="primary" type="submit" disabled={busy || !username || !password}>
            {mode === 'login' ? 'Sign in' : 'Create profile'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
