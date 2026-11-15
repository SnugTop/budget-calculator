import { useCallback, useEffect, useState } from 'react';
import { todayISO } from '../../shared/dates';
import type { ISODate, Plan } from '../../shared/types';
import { api } from './api';
import type { PlanMeta } from './api';
import { Bills } from './Bills';
import type { Ctx } from './ctx';
import { Login } from './Login';
import { ScheduleForm, Settings } from './Settings';
import { TabScreen } from './TabScreen';
import { Timeline } from './Timeline';
import { Button, cx } from './ui';
import { usePlan } from './usePlan';
import { WhatIfs } from './WhatIfs';

type Screen = 'timeline' | 'bills' | 'tab' | 'whatifs' | 'settings';
const SCREENS: { id: Screen; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'bills', label: 'Bills' },
  { id: 'tab', label: 'Tab' },
  { id: 'whatifs', label: 'What-ifs' },
  { id: 'settings', label: 'Settings' },
];

/** Today's date, kept fresh when the app is left open overnight. */
function useToday(): ISODate {
  const [today, setToday] = useState(todayISO());
  useEffect(() => {
    const check = () => setToday(todayISO());
    const t = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

export function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api
      .me()
      .then((u) => setUser(u.username))
      .catch(() => setUser(null));
  }, []);
  if (user === undefined) return <p className="p-6 text-muted">Loading…</p>;
  if (user === null) return <Login onDone={setUser} />;
  return (
    <Shell
      username={user}
      onSignOut={async () => {
        await api.logout().catch(() => {});
        setUser(null);
      }}
    />
  );
}

function Shell({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const today = useToday();
  const [screen, setScreen] = useState<Screen>('timeline');
  const [metas, setMetas] = useState<PlanMeta[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [liveData, setLiveData] = useState<Plan | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await api.plans();
    setMetas(list);
    return list;
  }, []);

  useEffect(() => {
    refresh()
      .then((list) => setActiveId(list.find((m) => m.isLive)?.id ?? null))
      .catch(() => {});
  }, [refresh]);

  const live = metas?.find((m) => m.isLive) ?? null;
  const active = metas?.find((m) => m.id === activeId) ?? null;
  const inWhatIf = !!active && !active.isLive;
  const store = usePlan(activeId, today);

  // While a what-if is open, keep the live plan at hand for side-by-side numbers.
  useEffect(() => {
    setLiveData(null);
    setConfirmDiscard(false);
    if (!inWhatIf || !live) return;
    let cancelled = false;
    api
      .plan(live.id)
      .then((row) => !cancelled && setLiveData(row.data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inWhatIf, live?.id, activeId]);

  if (!metas || !live || !store.plan || activeId == null) {
    return (
      <p className="p-6 text-muted">
        {store.status === 'offline' ? 'Could not reach the server. Check that it is running, then reload.' : 'Loading…'}
      </p>
    );
  }

  const ctx: Ctx = { plan: store.plan, update: store.update, today, live: inWhatIf ? liveData : null };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const createWhatIf = (name: string) =>
    act(async () => {
      const row = await api.copy(live.id, name);
      await refresh();
      setActiveId(row.id);
      setScreen('timeline');
    });
  const discard = (id: number) =>
    act(async () => {
      await api.remove(id);
      if (id === activeId) setActiveId(live.id);
      await refresh();
    });
  const apply = () =>
    act(async () => {
      await api.apply(activeId);
      setActiveId(live.id);
      await refresh();
    });

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 pb-16 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="font-display text-[22px] font-semibold">Paycheck plan</h1>
          <nav aria-label="Sections" className="flex flex-wrap gap-1">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={screen === s.id ? 'page' : undefined}
                onClick={() => setScreen(s.id)}
                className={cx(
                  'min-h-11 rounded-lg px-3.5 text-sm font-medium',
                  screen === s.id ? 'bg-accent text-white' : 'text-chip-ink hover:bg-chip',
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>
        <span role="status" className="text-[13px] text-muted">
          {store.status === 'saving' && 'Saving…'}
          {store.status === 'saved' && 'All changes saved'}
          {store.status === 'offline' && 'Not saved yet. Retrying…'}
          {store.status === 'conflict' && 'Out of date'}
        </span>
      </header>

      {store.status === 'conflict' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#e8c9a6] bg-warn px-4 py-3 text-warn-ink">
          <span>This plan was changed on another device. Reload to see the latest before you keep editing.</span>
          <Button onClick={store.reload}>Reload</Button>
        </div>
      )}

      {inWhatIf && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#b9cde8] bg-info px-4 py-3 text-info-ink">
          <div className="flex flex-col">
            <strong className="font-semibold">What-if: {active!.name}</strong>
            <span className="text-sm">Changes here do not touch your live plan until you apply them.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" disabled={busy || store.status !== 'saved'} onClick={apply}>
              Apply to live plan
            </Button>
            {confirmDiscard ? (
              <Button kind="danger" disabled={busy} onClick={() => discard(activeId)}>
                Yes, discard
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => setConfirmDiscard(true)}>
                Discard
              </Button>
            )}
            <Button disabled={busy} onClick={() => setActiveId(live.id)}>
              Back to live plan
            </Button>
          </div>
        </div>
      )}

      <main>
        {!store.plan.ready && screen !== 'settings' ? (
          <ScheduleForm ctx={ctx} firstRun />
        ) : (
          <>
            {screen === 'timeline' && <Timeline ctx={ctx} />}
            {screen === 'bills' && <Bills ctx={ctx} />}
            {screen === 'tab' && <TabScreen ctx={ctx} />}
            {screen === 'whatifs' && (
              <WhatIfs ctx={ctx} metas={metas} activeId={activeId} onOpen={setActiveId} onCreate={createWhatIf} onDelete={discard} />
            )}
            {screen === 'settings' && <Settings ctx={ctx} username={username} onSignOut={onSignOut} />}
          </>
        )}
      </main>
    </div>
  );
}
