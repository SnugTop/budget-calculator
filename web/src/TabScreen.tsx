import { useState } from 'react';
import { round2, tabBalance, visiblePaydays } from '../../shared/core';
import { longDate, shortDate } from '../../shared/dates';
import { addTabPayment, newId, removeTabEntry, removeTabPayment, upsertTabEntry } from '../../shared/ops';
import type { TabEntry } from '../../shared/types';
import type { Ctx } from './ctx';
import { Badge, Button, Card, Field, inputClass, money, MoneyInput, noFill } from './ui';

export function TabScreen({ ctx }: { ctx: Ctx }) {
  const { plan, update } = ctx;
  const who = plan.partnerName;
  const bal = tabBalance(plan);
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState<number | null>(null);
  const [direction, setDirection] = useState<TabEntry['direction']>('owedToMe');

  const add = () => {
    if (!description.trim() || !total) return;
    update((p) => upsertTabEntry(p, { id: newId(), description: description.trim(), direction, total, payments: [] }));
    setDescription('');
    setTotal(null);
  };

  const headline =
    bal.net > 0 ? `${who} owes you ${money(bal.net)}` : bal.net < 0 ? `You owe ${who} ${money(-bal.net)}` : 'You are all square';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col">
        <h2 className="font-display text-xl font-semibold">Tab with {who}</h2>
        <span className="text-[13px] text-muted">A running list of what you owe each other.</span>
      </div>

      <Card>
        <div className="grid gap-3 rounded-[10px] bg-ground p-4 sm:grid-cols-3">
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">Overall</span>
            <span className="font-display text-2xl font-semibold">{headline}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">{who} owes you</span>
            <span className="num text-lg font-semibold">{money(bal.owedToMe)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">You owe {who}</span>
            <span className="num text-lg font-semibold">{money(bal.iOwe)}</span>
          </div>
        </div>

        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_8rem_auto]">
          <Field label="What is it for">
            {(id) => <input id={id} {...noFill} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <Field label="Who owes">
            {(id) => (
              <select id={id} className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as TabEntry['direction'])}>
                <option value="owedToMe">{who} owes me</option>
                <option value="iOwe">I owe {who}</option>
              </select>
            )}
          </Field>
          <Field label="Amount">{(id) => <MoneyInput id={id} className="w-full" value={total} onCommit={setTotal} />}</Field>
          <Button kind="primary" disabled={!description.trim() || !total} onClick={add}>
            Add to tab
          </Button>
        </div>
      </Card>

      {plan.tab.length === 0 && (
        <Card>
          <span className="text-muted">Nothing on the tab yet.</span>
        </Card>
      )}
      {plan.tab.map((e) => (
        <EntryCard key={e.id} ctx={ctx} entry={e} />
      ))}
    </div>
  );
}

function EntryCard({ ctx, entry }: { ctx: Ctx; entry: TabEntry }) {
  const { plan, update, today } = ctx;
  const who = plan.partnerName;
  const paid = round2(entry.payments.reduce((t, p) => t + p.amount, 0));
  const left = round2(entry.total - paid);
  const [amount, setAmount] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState(false);
  const paydays = visiblePaydays(plan, today, 6);
  const mine = entry.direction === 'owedToMe';

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold">{entry.description}</span>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Badge tone={mine ? 'good' : 'info'}>{mine ? `${who} owes me` : `I owe ${who}`}</Badge>
            <span>
              {money(entry.total)} total, {money(paid)} paid
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[13px] text-muted">Remaining</span>
          <span className="num text-lg font-semibold">{money(left)}</span>
        </div>
      </div>

      {entry.payments.length > 0 && (
        <div className="flex flex-col">
          {entry.payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border-t border-rule py-1.5 text-sm">
              <span>
                Paid {shortDate(p.date)}
                {p.pin ? `, counted on the ${shortDate(p.pin)} paycheck` : ''}
              </span>
              <div className="flex items-center gap-2">
                <span className="num font-medium">{money(p.amount)}</span>
                <Button small kind="quiet" onClick={() => update((pl) => removeTabPayment(pl, entry.id, p.id))}>
                  Undo
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid items-end gap-3 border-t border-rule pt-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto]">
        <Field label="Payment">{(id) => <MoneyInput id={id} className="w-full" value={amount} onCommit={setAmount} placeholder={String(left)} />}</Field>
        <Field label="Count it on a paycheck">
          {(id) => (
            <select id={id} className={inputClass} value={pin} onChange={(e) => setPin(e.target.value)}>
              <option value="">Don't count it</option>
              {paydays.map((d) => (
                <option key={d} value={d}>
                  {longDate(d)} ({mine ? 'money in' : 'money out'})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          disabled={!amount}
          onClick={() => {
            update((pl) => addTabPayment(pl, entry.id, { id: newId(), amount: amount!, date: today, pin: pin || null }));
            setAmount(null);
            setPin('');
          }}
        >
          Record payment
        </Button>
        {confirm ? (
          <Button kind="danger" onClick={() => update((pl) => removeTabEntry(pl, entry.id))}>
            Yes, remove
          </Button>
        ) : (
          <Button kind="danger" onClick={() => setConfirm(true)}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}
