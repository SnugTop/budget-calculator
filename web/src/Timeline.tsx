import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildTimeline, freezePast, monthOfKey, paydayOnOrBefore, round2, visiblePaydays } from '../../shared/core';
import { longDate, monthLabel, shortDate } from '../../shared/dates';
import { diffTimeline } from '../../shared/diff';
import type { Gone, Mark, PlaceDiff } from '../../shared/diff';
import { activeBills, changeAmountFrom, patchOcc, pinItem, setActual, setPaid, setReopened, setSharePaid, upsertBill } from '../../shared/ops';
import type { CheckView, ISODate, ItemView, ShareView } from '../../shared/types';
import type { Ctx } from './ctx';
import { Badge, Button, Check, cx, Dialog, Field, GripIcon, inputClass, money, MoneyInput, MoreIcon } from './ui';

const REPEAT_LABEL = { monthly: 'Monthly', every: 'Every few months', once: 'One time' } as const;

const SHOWN_KEY = 'budget.paychecksShown';
const MIN_SHOWN = 2;

/** How many paychecks to show, remembered on this device. */
function readShown(): number {
  try {
    const n = Number(localStorage.getItem(SHOWN_KEY));
    return Number.isInteger(n) && n >= MIN_SHOWN && n <= 52 ? n : 4;
  } catch {
    return 4;
  }
}

export function Timeline({ ctx }: { ctx: Ctx }) {
  const { plan, update, today } = ctx;
  const [future, setFutureState] = useState(readShown);
  const [past, setPast] = useState(0);
  const setFuture = (n: number) => {
    const next = Math.max(MIN_SHOWN, n);
    setFutureState(next);
    try {
      localStorage.setItem(SHOWN_KEY, String(next));
    } catch {
      // Remembering the count is a convenience; the timeline works without it.
    }
  };
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const paydays = useMemo(() => visiblePaydays(plan, today, future, past), [plan, today, future, past]);
  const tl = useMemo(() => buildTimeline(plan, today, paydays), [plan, today, paydays]);
  const liveTl = useMemo(() => (ctx.live ? buildTimeline(ctx.live, today, paydays) : null), [ctx.live, today, paydays]);
  // In a what-if: what differs from the live plan, so it can be marked on screen.
  const diff = useMemo(
    () => (ctx.live && liveTl ? diffTimeline(liveTl, tl, activeBills(ctx.live, today), activeBills(plan, today)) : null),
    [ctx.live, liveTl, tl, plan, today],
  );

  const current = paydayOnOrBefore(plan.schedule, today);
  const targets = tl.checks.filter((c) => !c.frozen).map((c) => c.date);
  const all = [...tl.checks.flatMap((c) => (c.frozen ? [] : c.items)), ...tl.tray];
  const openItem = all.find((i) => i.key === openKey) ?? null;
  const dragItem = all.find((i) => i.key === dragKey) ?? null;
  const hasEarlier = paydays.length > 0 && plan.start < paydays[0];

  const move = (item: ItemView, pin: ISODate | 'tray') =>
    update((p) => pinItem(p, item.key, pin === item.defaultPin ? null : pin));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragKey(String(e.active.id))}
      onDragCancel={() => setDragKey(null)}
      onDragEnd={(e) => {
        setDragKey(null);
        const item = all.find((i) => i.key === String(e.active.id));
        if (item && e.over && String(e.over.id) !== item.pin) move(item, String(e.over.id));
      }}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
          {(hasEarlier || past > 0) && (
            <div className="flex flex-wrap gap-2">
              {hasEarlier && <Button onClick={() => setPast((n) => n + 2)}>Show earlier paychecks</Button>}
              {past > 0 && <Button onClick={() => setPast(0)}>Hide earlier paychecks</Button>}
            </div>
          )}
          {diff && (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span>Compared with your live plan:</span>
              <Badge tone="good">Added</Badge>
              <Badge tone="warn">Removed or moved away</Badge>
              <Badge tone="info">Moved here or changed</Badge>
            </div>
          )}
          <div className="grid items-start gap-5 md:grid-cols-2">
            {tl.checks.map((c, i) => (
              <CheckCard
                key={c.date}
                ctx={ctx}
                check={c}
                isCurrent={c.date === current}
                liveLeftover={liveTl ? liveTl.checks[i]?.leftover ?? null : null}
                diff={diff?.checks[c.date] ?? null}
                liveShares={diff?.liveShares ?? null}
                onOpen={setOpenKey}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setFuture(future + 2)}>Show more paychecks</Button>
            {future > MIN_SHOWN && <Button onClick={() => setFuture(future - 2)}>Show fewer paychecks</Button>}
          </div>
        </div>
        <Tray ctx={ctx} items={tl.tray} diff={diff?.tray ?? null} onOpen={setOpenKey} />
      </div>

      <DragOverlay>
        {dragItem && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-accent bg-card px-3 py-2 shadow-lg">
            <span className="font-medium">{dragItem.name}</span>
            <span className="num font-medium">{money(dragItem.effective)}</span>
          </div>
        )}
      </DragOverlay>

      {openItem && <ItemDialog ctx={ctx} item={openItem} targets={targets} onMove={move} onClose={() => setOpenKey(null)} />}
    </DndContext>
  );
}

// ---------------------------------------------------------------- paycheck card

function CheckCard(props: {
  ctx: Ctx;
  check: CheckView;
  isCurrent: boolean;
  liveLeftover: number | null;
  diff: PlaceDiff | null;
  liveShares: Record<string, number> | null;
  onOpen: (key: string) => void;
}) {
  const { ctx, check: c } = props;
  const { plan, update, today } = ctx;
  const { setNodeRef, isOver } = useDroppable({ id: c.date, disabled: c.frozen });
  const reopened = !!plan.checks[c.date]?.reopened;
  const locked = c.frozen;
  const short = c.leftover < 0;
  const delta = props.liveLeftover == null ? null : round2(c.leftover - props.liveLeftover);

  /** The live plan's amount for a share, when this what-if has a different one. */
  const wasShare = (s: ShareView): number | null => {
    const was = props.liveShares?.[`${s.key}#${s.index}`];
    return was != null && was !== s.amount ? was : null;
  };
  const setShare = (s: ShareView, v: number | null) =>
    update((p) => {
      const other = round2(s.total - s.amount);
      if (s.kind === 'even') return patchOcc(p, s.key, { firstShare: v == null ? null : s.index === 0 ? v : round2(s.total - v) });
      return patchOcc(p, s.key, { parts: v == null ? null : s.index === 0 ? [v, other] : [other, v] });
    });
  const swap = (s: ShareView) =>
    update((p) => {
      const other = round2(s.total - s.amount);
      return patchOcc(p, s.key, { parts: s.index === 0 ? [other, s.amount] : [s.amount, other] });
    });
  const useSuggested = (s: ShareView) =>
    update((p) => patchOcc(p, s.key, s.kind === 'even' ? { firstShare: null } : { parts: null }));

  return (
    <section
      ref={setNodeRef}
      aria-label={`Paycheck ${longDate(c.date)}`}
      className={cx(
        'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5',
        isOver ? 'border-accent ring-2 ring-accent/30' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-xl font-semibold">{longDate(c.date)}</h2>
          <span className="text-[13px] text-muted">
            Covers {shortDate(c.date)} to {shortDate(c.windowEnd)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.isCurrent && <Badge tone="good">Current</Badge>}
          {locked && <Badge>Past</Badge>}
          {reopened && <Badge tone="warn">Reopened</Badge>}
          {locked && (
            <Button small onClick={() => update((p) => setReopened(p, c.date, true))}>
              Reopen to correct
            </Button>
          )}
          {reopened && (
            <Button small onClick={() => update((p) => freezePast(setReopened(p, c.date, false), today))}>
              Lock again
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3 rounded-[10px] bg-ground p-4">
          <Stat label="Left for this paycheck" value={money(c.leftover)} big short={short} />
          <Stat label="Per week" value={money(c.perWeek)} big short={short} light />
          <Stat label="After budgets" value={money(c.afterBudgets)} short={c.afterBudgets < 0} />
          <Stat label="Per week" value={money(c.afterPerWeek)} short={c.afterBudgets < 0} light />
        </div>
        {short && <span className="text-[13px] font-medium text-short">This paycheck is short by {money(-c.leftover)}.</span>}
        {delta != null && (
          <span className="text-[13px] font-semibold text-info-ink">
            Compared with live plan: {delta >= 0 ? '+' : '-'}
            {money(Math.abs(delta))} left
          </span>
        )}
      </div>

      <div className="flex flex-col">
        <Row
          label="Actual pay"
          hint={`Uses the ${money(c.baseline)} baseline until entered`}
          control={(id) => (
            <MoneyInput
              id={id}
              disabled={locked}
              value={c.actual}
              placeholder={money(c.baseline).slice(1)}
              onCommit={(v) => update((p) => setActual(p, c.date, v))}
            />
          )}
        />
        <Row label="Bills on this paycheck" value={money(-c.bills)} />
        {c.shares.map((s) => (
          <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-rule py-1.5">
            <div className="flex min-w-0 flex-col">
              <span>{s.kind === 'even' ? `${s.name} share` : s.name}</span>
              <span className="text-xs text-muted">
                {s.solo
                  ? 'Only one paycheck funds this'
                  : s.kind === 'even'
                    ? `Suggested ${money(s.suggested)} to even out`
                    : `Suggested ${money(s.suggested)}`}
              </span>
              {wasShare(s) != null && (
                <span className="mt-0.5 self-start">
                  <Badge tone="info">Was {money(wasShare(s)!)}</Badge>
                </span>
              )}
              <Check
                small
                disabled={locked}
                checked={s.paid}
                onChange={(v) => update((p) => setSharePaid(p, s.key, s.index, v))}
                label="Set aside"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              {!locked && !s.solo && s.overridden && (
                <Button small aria-label={`Use the suggested ${s.name} amount`} onClick={() => useSuggested(s)}>
                  Reset
                </Button>
              )}
              {!locked && !s.solo && s.kind === 'fixed' && (
                <Button small aria-label={`Swap ${s.name} amounts between the two paychecks`} onClick={() => swap(s)}>
                  Swap
                </Button>
              )}
              {s.solo || locked ? (
                <span className="num">{money(-s.amount)}</span>
              ) : (
                <MoneyInput aria-label={`${s.name} on this paycheck`} className="w-24" value={s.amount} onCommit={(v) => setShare(s, v)} />
              )}
            </div>
          </div>
        ))}
        {c.tab.map((t) => (
          <Row key={t.paymentId} label={`Tab: ${t.description}`} value={`${t.amount >= 0 ? '+' : ''}${money(t.amount)}`} />
        ))}
        <Row label="Keep in account" hint="Unpaid bills that can't be paid ahead" value={money(c.keepInAccount)} />
        {c.waitingOnPartner > 0 && <Row label={`Waiting on ${plan.partnerName}`} value={money(c.waitingOnPartner)} />}
      </div>

      <div className="flex flex-col">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Pinned to this paycheck</h3>
        {c.items.length === 0 && <span className="border-t border-rule py-2.5 text-sm text-muted">Nothing pinned to this paycheck.</span>}
        {c.items.map((it) => (
          <ItemRow key={it.key} ctx={ctx} item={it} locked={locked} mark={props.diff?.marks[it.key]} onOpen={props.onOpen} />
        ))}
        {props.diff && <GoneRows gone={props.diff.gone} />}
      </div>
    </section>
  );
}

function Stat(props: { label: string; value: string; big?: boolean; short?: boolean; light?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] text-muted">{props.label}</span>
      <span
        className={cx(
          'num',
          props.big ? 'font-display text-[28px] leading-tight' : 'text-lg',
          props.light ? 'font-medium' : 'font-semibold',
          props.short ? 'text-short' : 'text-ink',
        )}
      >
        {props.value}
      </span>
    </div>
  );
}

function Row(props: { label: string; hint?: string; value?: string; control?: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-rule py-1.5">
      <label htmlFor={props.control ? id : undefined} className="flex min-w-0 flex-col">
        <span>{props.label}</span>
        {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
      </label>
      {props.control ? props.control(id) : <span className="num">{props.value}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- items

const placeName = (p: ISODate | 'tray'): string => (p === 'tray' ? 'the tray' : shortDate(p));

/** The label on an item that differs from the live plan. */
function MarkBadge({ mark }: { mark: Mark }) {
  if (mark.kind === 'added') return <Badge tone="good">Added</Badge>;
  if (mark.kind === 'changed') return <Badge tone="info">Was {money(mark.was)}</Badge>;
  return <Badge tone="info">{mark.from ? `Moved here from ${placeName(mark.from)}` : 'Moved here'}</Badge>;
}

/** Items the live plan has in this place and the what-if does not. */
function GoneRows({ gone }: { gone: Gone[] }) {
  return (
    <>
      {gone.map((g) => (
        <div key={g.item.key} className="flex items-center gap-2 border-t border-rule bg-warn/50 px-2 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-medium text-warn-ink line-through">{g.item.name}</span>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-warn-ink">
              <Badge tone="warn">{g.removed ? 'Removed' : g.to ? `Moved to ${placeName(g.to)}` : 'Moved away'}</Badge>
              <span>Counts on your live plan</span>
            </div>
          </div>
          <span className="num flex-none font-medium text-warn-ink line-through">{money(g.item.effective)}</span>
        </div>
      ))}
    </>
  );
}

function ItemRow(props: { ctx: Ctx; item: ItemView; locked: boolean; mark?: Mark; onOpen: (key: string) => void }) {
  const { ctx, item: it, locked, mark } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: it.key, disabled: locked });
  const inTray = it.pin === 'tray';
  return (
    <div
      ref={setNodeRef}
      className={cx(
        'flex items-center gap-2 border-t border-rule py-1.5',
        isDragging && 'opacity-40',
        mark?.kind === 'added' && 'bg-tint px-2',
        mark && mark.kind !== 'added' && 'bg-info/60 px-2',
      )}
    >
      {!locked && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${it.name} to another paycheck`}
          className="flex h-11 w-7 flex-none touch-none items-center justify-center rounded text-muted hover:bg-chip"
        >
          <GripIcon />
        </button>
      )}
      {!inTray && (
        <input
          type="checkbox"
          aria-label={`Paid: ${it.name}`}
          disabled={locked}
          checked={it.paid}
          onChange={(e) => ctx.update((p) => setPaid(p, it.key, e.target.checked, it.amount))}
          className="m-0 size-5 flex-none accent-accent"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cx('font-medium', it.paid && 'line-through decoration-muted')}>{it.name}</span>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{it.due ? `${inTray ? 'Suggested' : 'Due'} ${shortDate(it.due)}` : 'No date'}</span>
          {inTray && <Badge>{REPEAT_LABEL[it.repeat]}</Badge>}
          {it.cantPayAhead && <Badge tone="info">Can't pay ahead</Badge>}
          {it.late && <Badge tone="warn">Due before this payday</Badge>}
          {it.balanceLeft != null && <Badge>{money(it.balanceLeft)} left after this</Badge>}
          {it.paid && it.paidAmount !== it.amount && <Badge>Planned {money(it.amount)}</Badge>}
          {mark && <MarkBadge mark={mark} />}
        </div>
        {it.partner > 0 && !inTray && (
          <Check
            small
            disabled={locked}
            checked={it.partnerGot}
            onChange={(v) => ctx.update((p) => patchOcc(p, it.key, { partnerGot: v ? true : null }))}
            label={`${ctx.plan.partnerName}'s ${money(it.partner)} received`}
          />
        )}
      </div>
      <span className="num flex-none font-medium">{money(it.effective)}</span>
      {!locked && (
        <button
          type="button"
          aria-label={`Options for ${it.name}`}
          onClick={() => props.onOpen(it.key)}
          className="flex size-11 flex-none items-center justify-center rounded-lg border border-edge bg-card text-ink hover:bg-ground"
        >
          <MoreIcon />
        </button>
      )}
    </div>
  );
}

function Tray(props: { ctx: Ctx; items: ItemView[]; diff: PlaceDiff | null; onOpen: (key: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' });
  const total = props.items.reduce((t, i) => t + i.amount, 0);
  return (
    <section
      ref={setNodeRef}
      aria-label="Tray"
      className={cx(
        'order-1 flex min-w-0 flex-col gap-4 rounded-xl border border-dashed bg-card p-4 sm:p-5 lg:sticky lg:top-4 lg:order-2',
        isOver ? 'border-accent ring-2 ring-accent/30' : 'border-[#aeb8b0]',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-xl font-semibold">Tray</h2>
        <span className="text-[13px] text-muted">Not pinned to a paycheck. These don't count until you pin them.</span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[10px] bg-ground px-4 py-3">
        <span className="text-[13px] text-muted">Total in tray</span>
        <span className="num text-lg font-semibold">{money(total)}</span>
      </div>
      <div className="flex flex-col">
        {props.items.length === 0 && <span className="border-t border-rule py-2.5 text-sm text-muted">The tray is empty.</span>}
        {props.items.map((it) => (
          <ItemRow key={it.key} ctx={props.ctx} item={it} locked={false} mark={props.diff?.marks[it.key]} onOpen={props.onOpen} />
        ))}
        {props.diff && <GoneRows gone={props.diff.gone} />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- item options

function ItemDialog(props: {
  ctx: Ctx;
  item: ItemView;
  targets: ISODate[];
  onMove: (item: ItemView, pin: ISODate | 'tray') => void;
  onClose: () => void;
}) {
  const { ctx, item } = props;
  const { plan, update } = ctx;
  const bill = plan.bills.find((b) => b.id === item.billId);
  const month = monthOfKey(item.key);
  const inTray = item.pin === 'tray';
  const hasOverride = plan.occ[item.key]?.amount != null;
  const [amount, setAmount] = useState<number | null>(item.full);
  const options = props.targets.includes(item.pin) || inTray ? props.targets : [item.pin, ...props.targets];

  return (
    <Dialog title={item.name} onClose={props.onClose} footer={<Button kind="primary" onClick={props.onClose}>Done</Button>}>
      <Field label="Pinned to" hint={item.late ? 'This payday is after the due date.' : undefined}>
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={item.pin}
            onChange={(e) => props.onMove(item, e.target.value)}
          >
            {options.map((d) => (
              <option key={d} value={d}>
                {longDate(d)}
                {d === item.defaultPin ? ' (usual)' : ''}
              </option>
            ))}
            <option value="tray">Tray (not counted)</option>
          </select>
        )}
      </Field>

      {!inTray && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-rule pt-3">
          <Check
            checked={item.paid}
            onChange={(v) => update((p) => setPaid(p, item.key, v, item.amount))}
            label="Paid"
          />
          <Field label="Amount paid" className="w-36">
            {(id) => (
              <MoneyInput
                id={id}
                className="w-full"
                disabled={!item.paid}
                value={item.paidAmount}
                placeholder={String(item.amount)}
                onCommit={(v) => update((p) => setPaid(p, item.key, true, v ?? item.amount))}
              />
            )}
          </Field>
        </div>
      )}

      {item.partner > 0 && !inTray && (
        <div className="border-t border-rule pt-1">
          <Check
            checked={item.partnerGot}
            onChange={(v) => update((p) => patchOcc(p, item.key, { partnerGot: v ? true : null }))}
            label={`${plan.partnerName}'s ${money(item.partner)} received`}
          />
        </div>
      )}

      {bill && !item.paid && (
        <div className="flex flex-col gap-3 border-t border-rule pt-3">
          <Field
            label="Bill amount"
            hint={item.partner > 0 ? `The full bill. ${plan.partnerName} covers ${money(item.partner)} of it.` : undefined}
          >
            {(id) => <MoneyInput id={id} className="w-full" value={amount} onCommit={setAmount} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            {month ? (
              <>
                <Button
                  disabled={amount == null || amount === item.full}
                  onClick={() => update((p) => patchOcc(p, item.key, { amount }))}
                >
                  Change {monthLabel(month)} only
                </Button>
                <Button
                  disabled={amount == null || amount === item.full}
                  onClick={() => update((p) => patchOcc(changeAmountFrom(p, bill.id, month, amount!), item.key, { amount: null }))}
                >
                  Change from {monthLabel(month)} on
                </Button>
                {hasOverride && (
                  <Button kind="quiet" onClick={() => update((p) => patchOcc(p, item.key, { amount: null }))}>
                    Back to the usual amount
                  </Button>
                )}
              </>
            ) : (
              <Button
                disabled={amount == null || amount === item.full}
                onClick={() => update((p) => upsertBill(p, { ...bill, amount: amount! }))}
              >
                Save amount
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
