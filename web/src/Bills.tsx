import { useState } from 'react';
import { amountFor, monthlyInterest, round2 } from '../../shared/core';
import { monthOf } from '../../shared/dates';
import { diffBills } from '../../shared/diff';
import { describeChange } from './changes';
import { activeBills, changeAmountFrom, debtKind, newBill, removeBill, upsertBill } from '../../shared/ops';
import type { Bill, SplitKind } from '../../shared/types';
import type { Ctx } from './ctx';
import { Badge, Button, Card, Check, cx, Dialog, Field, inputClass, money, MoneyInput, noFill } from './ui';

interface Group {
  title: string;
  hint: string;
  list: Bill[];
  stats?: { label: string; value: string; note?: string }[];
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export function Bills({ ctx }: { ctx: Ctx }) {
  const { plan, today } = ctx;
  const month = monthOf(today);
  const [editing, setEditing] = useState<{ bill: Bill; isNew: boolean } | null>(null);
  const bills = activeBills(plan, today).sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name));
  const mine = (b: Bill) => round2(amountFor(b, month) - (b.split === 'fixed' ? 0 : Math.min(b.partnerShare, amountFor(b, month))));

  // In a what-if: which bills were added, removed or changed against the live plan.
  const diff = ctx.live ? diffBills(ctx.live, plan, today) : null;
  const addedIds = new Set(diff?.added.map((b) => b.id));
  const changes = new Map(diff?.changed.map((c) => [c.after.id, c]));

  const plain = bills.filter((b) => b.split === 'none' && !debtKind(b));
  /** A credit or loan section, with what goes to it each month and what is still owed. */
  const debtGroup = (kind: 'credit' | 'loan', title: string, hint: string): Group => {
    const list = bills.filter((b) => b.split === 'none' && debtKind(b) === kind);
    const noBalance = list.filter((b) => b.balance == null).length;
    const interest = round2(list.reduce((t, b) => t + monthlyInterest(b), 0));
    return {
      title,
      hint,
      list,
      stats: [
        {
          label: 'Monthly payments',
          value: money(round2(list.filter((b) => b.repeat.kind === 'monthly').reduce((t, b) => t + mine(b), 0))),
        },
        {
          label: 'Balance left',
          value: money(round2(list.reduce((t, b) => t + (b.balance ?? 0), 0))),
          note: noBalance > 0 ? `${noBalance} with no balance entered` : undefined,
        },
        ...(interest > 0 ? [{ label: 'Interest a month', value: money(interest), note: 'Estimate at today\'s balances' }] : []),
      ],
    };
  };

  const groups: Group[] = [
    {
      title: 'Split across two paychecks',
      hint: 'Funded by the first two paychecks of a month.',
      list: bills.filter((b) => b.split !== 'none'),
    },
    debtGroup('credit', 'Credit cards', 'Cards and store credit.'),
    debtGroup('loan', 'Loans', 'Car, student and other loans.'),
    {
      title: 'Monthly',
      hint: 'Pinned to the paycheck that covers the due date.',
      list: plain.filter((b) => b.repeat.kind === 'monthly'),
    },
    {
      title: 'Every few months',
      hint: 'Start in the tray when they come due.',
      list: plain.filter((b) => b.repeat.kind === 'every'),
    },
    {
      title: 'One time',
      hint: 'Stay in the tray until you pin them.',
      list: plain.filter((b) => b.repeat.kind === 'once'),
    },
  ];
  const monthly = round2(
    bills.filter((b) => b.repeat.kind === 'monthly').reduce((t, b) => t + mine(b), 0),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="font-display text-xl font-semibold">Bills</h2>
          <span className="text-[13px] text-muted">Your part of everything monthly comes to {money(monthly)}.</span>
        </div>
        <Button kind="primary" onClick={() => setEditing({ bill: newBill(), isNew: true })}>
          Add a bill
        </Button>
      </div>

      {bills.length === 0 && (
        <Card>
          <span className="text-muted">No bills yet. Add your first one to see it land on a paycheck.</span>
        </Card>
      )}

      {groups
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <Card key={g.title}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col">
                <h3 className="font-semibold">{g.title}</h3>
                <span className="text-[13px] text-muted">{g.hint}</span>
              </div>
              {g.stats && (
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  {g.stats.map((s) => (
                    <div key={s.label} className="flex flex-col sm:items-end">
                      <span className="text-[13px] text-muted">{s.label}</span>
                      <span className="num text-lg font-semibold">{s.value}</span>
                      {s.note && <span className="text-xs text-muted">{s.note}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col">
              {g.list.map((b) => (
                <div
                  key={b.id}
                  className={cx(
                    'flex items-center gap-3 border-t border-rule py-2',
                    addedIds.has(b.id) && 'bg-tint px-2',
                    changes.has(b.id) && 'bg-info/60 px-2',
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">{b.name}</span>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {b.repeat.kind === 'once' ? (
                        <span>{b.repeat.date ? `Around ${b.repeat.date}` : 'No date'}</span>
                      ) : (
                        <span>Due the {ordinal(b.dueDay)}</span>
                      )}
                      {b.repeat.kind === 'every' && <Badge>Every {b.repeat.months} months</Badge>}
                      {b.split === 'even' && <Badge tone="good">Evens out paychecks</Badge>}
                      {b.split === 'fixed' && b.parts && (
                        <Badge tone="good">
                          {money(b.parts[0])} and {money(b.parts[1])}
                        </Badge>
                      )}
                      {b.cantPayAhead && <Badge tone="info">Can't pay ahead</Badge>}
                      {b.partnerShare > 0 && b.split !== 'fixed' && (
                        <Badge>
                          {plan.partnerName} covers {money(b.partnerShare)}
                        </Badge>
                      )}
                      {b.balance != null && <Badge>{money(b.balance)} left to pay</Badge>}
                      {!!b.apr && <Badge>{b.apr}% interest</Badge>}
                      {monthlyInterest(b) > 0 && mine(b) <= monthlyInterest(b) && (
                        <Badge tone="warn">Payment doesn't cover the interest</Badge>
                      )}
                      {addedIds.has(b.id) && <Badge tone="good">Added</Badge>}
                      {changes.has(b.id) &&
                        describeChange(changes.get(b.id)!).map((line) => (
                          <Badge key={line} tone="info">
                            {line}
                          </Badge>
                        ))}
                    </div>
                  </div>
                  <span className="num flex-none font-medium">{money(mine(b))}</span>
                  <Button small onClick={() => setEditing({ bill: b, isNew: false })}>
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ))}

      {diff && diff.removed.length > 0 && (
        <Card>
          <div className="flex flex-col">
            <h3 className="font-semibold">Removed in this what-if</h3>
            <span className="text-[13px] text-muted">Still on your live plan until you apply the what-if.</span>
          </div>
          <div className="flex flex-col">
            {diff.removed.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-t border-rule bg-warn/50 px-2 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium text-warn-ink line-through">{b.name}</span>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge tone="warn">Removed</Badge>
                  </div>
                </div>
                <span className="num flex-none font-medium text-warn-ink line-through">{money(amountFor(b, month))}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && <BillForm ctx={ctx} original={editing.bill} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BillForm(props: { ctx: Ctx; original: Bill; isNew: boolean; onClose: () => void }) {
  const { ctx, original, isNew } = props;
  const { plan, update, today } = ctx;
  const month = monthOf(today);
  const [b, setB] = useState<Bill>({ ...original, amount: amountFor(original, month) });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Bill>) => setB((cur) => ({ ...cur, ...patch }));
  const parts = b.parts ?? [0, 0];
  const recurring = b.repeat.kind !== 'once';
  const kind = debtKind(b);

  const save = () => {
    if (!b.name.trim()) return setError('Give the bill a name.');
    const amount = b.split === 'fixed' ? round2(parts[0] + parts[1]) : b.amount;
    if (!(amount > 0)) return setError('Enter an amount above zero.');
    const clean: Bill = {
      ...b,
      name: b.name.trim(),
      dueDay: Math.max(1, Math.min(31, Math.round(b.dueDay) || 1)),
      partnerShare: b.split === 'fixed' ? 0 : Math.max(0, b.partnerShare || 0),
      parts: b.split === 'fixed' ? parts : null,
      debt: b.split === 'none' ? kind : null,
      credit: false,
      apr: b.split === 'none' && kind && recurring ? b.apr || null : null,
      // Split bills are always monthly, never installments, and never tied to a draft date.
      ...(b.split !== 'none' ? { repeat: { kind: 'monthly' as const }, balance: null, cantPayAhead: false } : {}),
    };
    update((p) => {
      if (isNew || !recurring || b.split === 'fixed') return upsertBill(p, { ...clean, amount });
      // An amount change applies from this month on; earlier months keep what they had.
      const kept = upsertBill(p, { ...clean, amount: original.amount, changes: original.changes });
      return amount === amountFor(original, month) ? kept : changeAmountFrom(kept, clean.id, month, amount);
    });
    props.onClose();
  };

  return (
    <Dialog
      title={isNew ? 'Add a bill' : 'Edit bill'}
      onClose={props.onClose}
      footer={
        <>
          {!isNew &&
            (confirmRemove ? (
              <Button
                kind="danger"
                onClick={() => {
                  update((p) => removeBill(p, b.id, today));
                  props.onClose();
                }}
              >
                Yes, remove it
              </Button>
            ) : (
              <Button kind="danger" onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            ))}
          <Button onClick={props.onClose}>Cancel</Button>
          <Button kind="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(id) => <input id={id} {...noFill} className={inputClass} value={b.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>

      <Field label="How it is paid" hint={b.split === 'even' ? 'Use this for rent: the app suggests each paycheck\'s share so both end up with the same amount left.' : b.split === 'fixed' ? 'Use this for savings: two set amounts, with the larger one on the paycheck that has more room.' : undefined}>
        {(id) => (
          <select id={id} className={inputClass} value={b.split} onChange={(e) => set({ split: e.target.value as SplitKind, parts: e.target.value === 'fixed' ? b.parts ?? [0, 0] : b.parts })}>
            <option value="none">From one paycheck</option>
            <option value="even">Split across two paychecks, evened out</option>
            <option value="fixed">Split across two paychecks, set amounts</option>
          </select>
        )}
      </Field>

      {b.split === 'fixed' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First amount">
            {(id) => <MoneyInput id={id} className="w-full" value={parts[0] || null} onCommit={(v) => set({ parts: [v ?? 0, parts[1]] })} />}
          </Field>
          <Field label="Second amount">
            {(id) => <MoneyInput id={id} className="w-full" value={parts[1] || null} onCommit={(v) => set({ parts: [parts[0], v ?? 0] })} />}
          </Field>
        </div>
      ) : (
        <Field label="Amount" hint={!isNew && recurring ? 'A new amount applies from this month on.' : undefined}>
          {(id) => <MoneyInput id={id} className="w-full" value={b.amount || null} onCommit={(v) => set({ amount: v ?? 0 })} />}
        </Field>
      )}

      {b.split === 'none' && (
        <Field label="Repeats">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={b.repeat.kind}
              onChange={(e) => {
                const repeat = e.target.value;
                if (repeat === 'monthly') set({ repeat: { kind: 'monthly' } });
                if (repeat === 'every') set({ repeat: { kind: 'every', months: 3, start: month } });
                if (repeat === 'once') set({ repeat: { kind: 'once', date: null }, balance: null });
              }}
            >
              <option value="monthly">Every month</option>
              <option value="every">Every few months</option>
              <option value="once">One time</option>
            </select>
          )}
        </Field>
      )}

      {b.repeat.kind === 'every' && b.split === 'none' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat every" hint="In months.">
            {(id) => (
              <input
                id={id}
                type="number"
                min={2}
                max={24}
                {...noFill}
                className={inputClass}
                value={b.repeat.kind === 'every' ? b.repeat.months : 3}
                onChange={(e) => b.repeat.kind === 'every' && set({ repeat: { ...b.repeat, months: Math.max(2, Number(e.target.value) || 2) } })}
              />
            )}
          </Field>
          <Field label="Starting">
            {(id) => (
              <input
                id={id}
                type="month"
                {...noFill}
                className={inputClass}
                value={b.repeat.kind === 'every' ? b.repeat.start : month}
                onChange={(e) => b.repeat.kind === 'every' && e.target.value && set({ repeat: { ...b.repeat, start: e.target.value } })}
              />
            )}
          </Field>
        </div>
      )}

      {b.repeat.kind === 'once' && b.split === 'none' ? (
        <Field label="Rough date" hint="Optional. It sits in the tray until you pin it to a paycheck.">
          {(id) => (
            <input
              id={id}
              type="date"
              {...noFill}
              className={inputClass}
              value={b.repeat.kind === 'once' ? b.repeat.date ?? '' : ''}
              onChange={(e) => set({ repeat: { kind: 'once', date: e.target.value || null } })}
            />
          )}
        </Field>
      ) : (
        <Field
          label="Due day"
          hint={b.split !== 'none' ? 'A number from 1 to 31. Due on the 1st means the two paychecks of the month before pay for it.' : 'A number from 1 to 31.'}
        >
          {(id) => (
            <input
              id={id}
              type="text"
              inputMode="numeric"
              {...noFill}
              className={inputClass}
              value={b.dueDay || ''}
              onChange={(e) => set({ dueDay: Number(e.target.value.replace(/\D/g, '').slice(0, 2)) })}
            />
          )}
        </Field>
      )}

      {b.split !== 'fixed' && (
        <Field label={`${plan.partnerName} covers`} hint="Leave empty if the bill is all yours. Only your part counts against a paycheck.">
          {(id) => <MoneyInput id={id} className="w-full" value={b.partnerShare || null} onCommit={(v) => set({ partnerShare: v ?? 0 })} />}
        </Field>
      )}

      {b.split === 'none' && (
        <>
          <Check
            checked={b.cantPayAhead}
            onChange={(v) => set({ cantPayAhead: v })}
            label="Can't pay ahead (it drafts on its date, so the money has to stay in the account)"
          />
          <Field label="Listed under">
            {(id) => (
              <select
                id={id}
                className={inputClass}
                value={kind ?? ''}
                onChange={(e) => set({ debt: (e.target.value || null) as Bill['debt'], credit: false })}
              >
                <option value="">Bills</option>
                <option value="credit">Credit cards</option>
                <option value="loan">Loans</option>
              </select>
            )}
          </Field>
          {recurring && kind && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Balance left" hint="Optional. The bill ends when it reaches zero.">
                {(id) => <MoneyInput id={id} className="w-full" value={b.balance} onCommit={(v) => set({ balance: v })} />}
              </Field>
              <Field label="Interest rate" hint="Yearly rate as a percent, such as 24.99.">
                {(id) => <MoneyInput id={id} className="w-full" value={b.apr ?? null} onCommit={(v) => set({ apr: v })} />}
              </Field>
              <span className="col-span-2 text-xs text-muted">
                Checking off a payment adds one month of interest to the balance, then takes the payment off. It is an
                estimate, so correct the balance here when your statement differs or you add new charges.
              </span>
            </div>
          )}
          {recurring && !kind && (
            <>
              <Check
                checked={b.balance != null}
                onChange={(v) => set({ balance: v ? b.balance ?? 0 : null })}
                label="It's an installment with a balance to pay off"
              />
              {b.balance != null && (
                <Field label="Balance left" hint="Each payment you check off lowers it. The bill ends when it reaches zero.">
                  {(id) => <MoneyInput id={id} className="w-full" value={b.balance} onCommit={(v) => set({ balance: v ?? 0 })} />}
                </Field>
              )}
            </>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-short">
          {error}
        </p>
      )}
    </Dialog>
  );
}
