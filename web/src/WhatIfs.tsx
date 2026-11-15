import { useMemo, useState } from 'react';
import { amountFor, buildTimeline, round2, visiblePaydays } from '../../shared/core';
import { longDate, monthOf, shortDate } from '../../shared/dates';
import { diffBills, diffSettings, diffTimeline } from '../../shared/diff';
import { activeBills } from '../../shared/ops';
import { describeChange, describeSetting } from './changes';
import type { PlanMeta } from './api';
import type { Ctx } from './ctx';
import { Badge, Button, Card, cx, Field, inputClass, money, noFill } from './ui';

export function WhatIfs(props: {
  ctx: Ctx;
  metas: PlanMeta[];
  activeId: number;
  onOpen: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const { ctx, metas, activeId } = props;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const live = metas.find((m) => m.isLive)!;
  const scenarios = metas.filter((m) => !m.isLive);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col">
        <h2 className="font-display text-xl font-semibold">What-ifs</h2>
        <span className="text-[13px] text-muted">
          A what-if is a copy of your plan. Change anything in it, compare, then apply it or throw it away.
        </span>
      </div>

      <Card>
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Name the decision you are testing">
            {(id) => (
              <input id={id} {...noFill} className={inputClass} value={name} placeholder="New car payment" onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Button
            kind="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await props.onCreate(name.trim() || 'What-if').finally(() => setBusy(false));
              setName('');
            }}
          >
            Start a what-if
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold">Your plans</h3>
        <div className="flex flex-col">
          {[live, ...scenarios].map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-rule py-2">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{m.isLive ? 'Live plan' : m.name}</span>
                <span className="text-xs text-muted">{m.id === activeId ? 'Open now' : m.isLive ? 'Your real budget' : 'What-if'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.id !== activeId && (
                  <Button small onClick={() => props.onOpen(m.id)}>
                    Open
                  </Button>
                )}
                {!m.isLive &&
                  (confirmId === m.id ? (
                    <Button small kind="danger" onClick={() => props.onDelete(m.id)}>
                      Yes, discard
                    </Button>
                  ) : (
                    <Button small kind="danger" onClick={() => setConfirmId(m.id)}>
                      Discard
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {ctx.live && <Changes ctx={ctx} />}
      {ctx.live && <Compare ctx={ctx} />}
    </div>
  );
}

/** Everything this what-if adds, removes, changes or moves, in one list. */
function Changes({ ctx }: { ctx: Ctx }) {
  const { plan, today } = ctx;
  const live = ctx.live!;
  const month = monthOf(today);
  const lines = useMemo(() => {
    const bills = diffBills(live, plan, today);
    const paydays = visiblePaydays(plan, today, 8);
    const tl = diffTimeline(
      buildTimeline(live, today, paydays),
      buildTimeline(plan, today, paydays),
      activeBills(live, today),
      activeBills(plan, today),
    );
    const place = (p: string) => (p === 'tray' ? 'the tray' : shortDate(p));
    const names = new Map(plan.bills.map((b) => [b.id, b.name]));
    const moved: string[] = [];
    const note = (where: string, marks: Record<string, { kind: string; from?: string | null }>) => {
      for (const [key, m] of Object.entries(marks)) {
        if (m.kind !== 'moved') continue;
        const name = names.get(key.slice(0, key.lastIndexOf('@'))) ?? 'Item';
        moved.push(`${name}: moved to ${place(where)}${m.from ? ` from ${place(m.from)}` : ''}`);
      }
    };
    for (const [date, d] of Object.entries(tl.checks)) note(date, d.marks);
    note('tray', tl.tray.marks);
    return { bills, moved, settings: diffSettings(live, plan) };
  }, [live, plan, today]);

  const { bills, moved, settings } = lines;
  const nothing = !bills.added.length && !bills.removed.length && !bills.changed.length && !moved.length && !settings.length;

  return (
    <Card>
      <div className="flex flex-col">
        <h3 className="font-semibold">Changes in this what-if</h3>
        <span className="text-[13px] text-muted">
          {nothing ? 'None yet. This what-if matches your live plan.' : 'What is different from your live plan. The same marks appear on the Timeline and Bills screens.'}
        </span>
      </div>
      {!nothing && (
        <div className="flex flex-col">
          {bills.added.map((b) => (
            <ChangeRow key={`a${b.id}`} tone="good" label="Added" title={b.name} detail={`${money(amountFor(b, month))}${b.repeat.kind === 'monthly' ? ' a month' : ''}`} />
          ))}
          {bills.removed.map((b) => (
            <ChangeRow key={`r${b.id}`} tone="warn" label="Removed" title={b.name} detail={`${money(amountFor(b, month))}${b.repeat.kind === 'monthly' ? ' a month' : ''}`} struck />
          ))}
          {bills.changed.map((c) => (
            <ChangeRow key={`c${c.after.id}`} tone="info" label="Changed" title={c.after.name} detail={describeChange(c).join('. ')} />
          ))}
          {moved.map((line) => (
            <ChangeRow key={`m${line}`} tone="info" label="Moved" title={line.slice(0, line.indexOf(':'))} detail={line.slice(line.indexOf(':') + 2)} />
          ))}
          {settings.map((s) => (
            <ChangeRow key={`s${s.what}`} tone="info" label="Changed" title="Settings" detail={describeSetting(s)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ChangeRow(props: { tone: 'good' | 'warn' | 'info'; label: string; title: string; detail: string; struck?: boolean }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule px-2 py-2',
        props.tone === 'good' && 'bg-tint',
        props.tone === 'warn' && 'bg-warn/50',
        props.tone === 'info' && 'bg-info/60',
      )}
    >
      <span className="w-20 flex-none">
        <Badge tone={props.tone}>{props.label}</Badge>
      </span>
      <span className={cx('font-medium', props.struck && 'line-through')}>{props.title}</span>
      <span className="text-sm text-chip-ink">{props.detail}</span>
    </div>
  );
}

function Compare({ ctx }: { ctx: Ctx }) {
  const { plan, today } = ctx;
  const rows = useMemo(() => {
    const paydays = visiblePaydays(plan, today, 8);
    const a = buildTimeline(ctx.live!, today, paydays).checks;
    const b = buildTimeline(plan, today, paydays).checks;
    return paydays.map((d, i) => ({ d, live: a[i].leftover, whatIf: b[i].leftover, diff: round2(b[i].leftover - a[i].leftover) }));
  }, [plan, ctx.live, today]);
  const total = round2(rows.reduce((t, r) => t + r.diff, 0));

  return (
    <Card>
      <div className="flex flex-col">
        <h3 className="font-semibold">Left per paycheck: live plan against this what-if</h3>
        <span className="text-[13px] text-muted">
          Across these paychecks the what-if leaves you {total >= 0 ? `${money(total)} more` : `${money(-total)} less`}.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pr-3 font-semibold">Paycheck</th>
              <th className="py-2 pr-3 text-right font-semibold">Live plan</th>
              <th className="py-2 pr-3 text-right font-semibold">What-if</th>
              <th className="py-2 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.d} className="border-t border-rule">
                <td className="py-2 pr-3">{longDate(r.d)}</td>
                <td className="num py-2 pr-3 text-right">{money(r.live)}</td>
                <td className="num py-2 pr-3 text-right">{money(r.whatIf)}</td>
                <td className={cx('num py-2 text-right font-semibold', r.diff < 0 ? 'text-short' : r.diff > 0 ? 'text-accent' : 'text-muted')}>
                  {r.diff > 0 ? '+' : ''}
                  {money(r.diff)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
