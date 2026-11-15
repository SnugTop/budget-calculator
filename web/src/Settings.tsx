import { useRef, useState } from 'react';
import { looksLikePlan, newId, setBudgets, setPartnerName, setSchedule } from '../../shared/ops';
import type { Plan, Schedule } from '../../shared/types';
import { api, ApiError } from './api';
import type { Ctx } from './ctx';
import { Button, Card, Field, inputClass, money, MoneyInput, noFill } from './ui';

/** Pay schedule fields. Also used as the first-run setup. */
export function ScheduleForm({ ctx, firstRun }: { ctx: Ctx; firstRun?: boolean }) {
  const { plan, update, today } = ctx;
  const [s, setS] = useState<Schedule>(firstRun ? { anchor: today, everyDays: 14, baseline: 0 } : plan.schedule);
  const changed = firstRun || JSON.stringify(s) !== JSON.stringify(plan.schedule);
  return (
    <Card>
      <div className="flex flex-col">
        <h3 className="font-display text-lg font-semibold">{firstRun ? 'Set up your paychecks' : 'Pay schedule'}</h3>
        <span className="text-[13px] text-muted">
          {firstRun
            ? 'Three things and your timeline is ready. You can change them later in Settings.'
            : 'Every paycheck on the timeline is worked out from these.'}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="A payday" hint="Your last or next one. Either works.">
          {(id) => <input id={id} type="date" {...noFill} className={inputClass} value={s.anchor} onChange={(e) => e.target.value && setS({ ...s, anchor: e.target.value })} />}
        </Field>
        <Field label="Paid">
          {(id) => (
            <select id={id} className={inputClass} value={s.everyDays} onChange={(e) => setS({ ...s, everyDays: Number(e.target.value) })}>
              <option value={14}>Every two weeks</option>
              <option value={7}>Every week</option>
            </select>
          )}
        </Field>
        <Field label="Baseline pay" hint="Used until you enter a paycheck's real amount.">
          {(id) => <MoneyInput id={id} className="w-full" value={s.baseline || null} onCommit={(v) => setS({ ...s, baseline: v ?? 0 })} />}
        </Field>
      </div>
      <Button kind="primary" className="self-start" disabled={!changed || !(s.baseline > 0)} onClick={() => update((p) => setSchedule(p, s, today))}>
        {firstRun ? 'Start my timeline' : 'Save pay schedule'}
      </Button>
    </Card>
  );
}

export function Settings({ ctx, username, onSignOut }: { ctx: Ctx; username: string; onSignOut: () => void }) {
  const { plan, update } = ctx;
  const total = plan.budgets.reduce((t, b) => t + b.amount, 0);
  const patchBudget = (id: string, patch: { name?: string; amount?: number }) =>
    update((p) => setBudgets(p, p.budgets.map((b) => (b.id === id ? { ...b, ...patch } : b))));

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-display text-xl font-semibold">Settings</h2>
      <ScheduleForm ctx={ctx} />

      <Card>
        <div className="flex flex-col">
          <h3 className="font-display text-lg font-semibold">Budgets per paycheck</h3>
          <span className="text-[13px] text-muted">
            Food, gas, fun and the like. Each paycheck shows what is left before and after these. They come to {money(total)} per paycheck.
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {plan.budgets.map((b) => (
            <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
              <input aria-label="Budget name" {...noFill} className={inputClass} value={b.name} onChange={(e) => patchBudget(b.id, { name: e.target.value })} />
              <MoneyInput aria-label={`${b.name || 'Budget'} amount`} className="w-full" value={b.amount || null} onCommit={(v) => patchBudget(b.id, { amount: v ?? 0 })} />
              <Button small kind="quiet" onClick={() => update((p) => setBudgets(p, p.budgets.filter((x) => x.id !== b.id)))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button className="self-start" onClick={() => update((p) => setBudgets(p, [...p.budgets, { id: newId(), name: '', amount: 0 }]))}>
          Add a budget
        </Button>
      </Card>

      <Card>
        <div className="flex flex-col">
          <h3 className="font-display text-lg font-semibold">Partner</h3>
          <span className="text-[13px] text-muted">The name used on shared bills and the tab.</span>
        </div>
        <Field label="Name" className="max-w-xs">
          {(id) => <input id={id} {...noFill} className={inputClass} defaultValue={plan.partnerName} onBlur={(e) => update((p) => setPartnerName(p, e.target.value))} />}
        </Field>
      </Card>

      <Backup ctx={ctx} />
      <Account username={username} onSignOut={onSignOut} />
    </div>
  );
}

function Backup({ ctx }: { ctx: Ctx }) {
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Plan | null>(null);
  const [message, setMessage] = useState('');

  const download = () => {
    const blob = new Blob([JSON.stringify(ctx.plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `budget-backup-${ctx.today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const read = async (f: File | undefined) => {
    setMessage('');
    setPending(null);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (looksLikePlan(parsed)) setPending(parsed);
      else setMessage('That file is not a backup from this app.');
    } catch {
      setMessage('That file could not be read.');
    }
    if (file.current) file.current.value = '';
  };

  return (
    <Card>
      <div className="flex flex-col">
        <h3 className="font-display text-lg font-semibold">Backup</h3>
        <span className="text-[13px] text-muted">
          The server keeps your data on disk and makes a dated copy every day. A file of your own is an extra safety net, and the way to move to another machine.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download}>Download a backup file</Button>
        <Button onClick={() => file.current?.click()}>Restore from a backup file</Button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
      </div>
      {pending && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-warn p-3 text-sm text-warn-ink">
          <span>
            This replaces the plan you have open with the file's {pending.bills.length} bills. It cannot be undone.
          </span>
          <Button
            kind="danger"
            onClick={() => {
              ctx.update(() => pending);
              setPending(null);
              setMessage('Restored from the backup file.');
            }}
          >
            Yes, replace it
          </Button>
          <Button onClick={() => setPending(null)}>Cancel</Button>
        </div>
      )}
      {message && <span role="status" className="text-sm text-muted">{message}</span>}
    </Card>
  );
}

function Account({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState('');
  const change = async () => {
    try {
      await api.password(current, next);
      setCurrent('');
      setNext('');
      setMessage('Password changed.');
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };
  return (
    <Card>
      <div className="flex flex-col">
        <h3 className="font-display text-lg font-semibold">Profile</h3>
        <span className="text-[13px] text-muted">Signed in as {username}.</span>
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="Current password">
          {(id) => <input id={id} type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="New password">
          {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Button disabled={!current || next.length < 8} onClick={change}>
          Change password
        </Button>
      </div>
      {message && <span role="status" className="text-sm text-muted">{message}</span>}
      <Button className="self-start" onClick={onSignOut}>
        Sign out
      </Button>
    </Card>
  );
}
