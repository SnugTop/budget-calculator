import { describe, expect, it } from 'vitest';
import { buildTimeline, occKey } from './core';
import { diffBills, diffSettings, diffTimeline } from './diff';
import { activeBills, changeAmountFrom, newBill, newPlan, patchOcc, pinItem, removeBill, setBudgets, setSchedule, upsertBill } from './ops';
import type { Bill, Plan } from './types';

const A = '2026-12-04';
const B = '2026-12-18';
const TODAY = '2026-12-05';
const bill = (id: string, name: string, dueDay: number, amount: number, extra: Partial<Bill> = {}): Bill => ({
  ...newBill(),
  id,
  name,
  dueDay,
  amount,
  ...extra,
});

function livePlan(): Plan {
  let plan = setSchedule(newPlan(TODAY), { anchor: A, everyDays: 14, baseline: 2500 }, TODAY);
  for (const b of [
    bill('phone', 'Phone', 5, 85),
    bill('gym', 'Gym', 6, 40),
    bill('power', 'Electric', 20, 90),
    bill('card', 'Store card', 26, 150, { debt: 'credit', balance: 900 }),
    bill('rent', 'Rent', 1, 1400, { split: 'even' }),
    bill('reg', 'Car registration', 15, 200, { repeat: { kind: 'once', date: '2026-12-15' } }),
  ]) {
    plan = upsertBill(plan, b);
  }
  return plan;
}

const compare = (live: Plan, whatIf: Plan) =>
  diffTimeline(
    buildTimeline(live, TODAY, [A, B]),
    buildTimeline(whatIf, TODAY, [A, B]),
    activeBills(live, TODAY),
    activeBills(whatIf, TODAY),
  );

describe('what-if differences: bills', () => {
  it('finds nothing in an untouched copy', () => {
    const live = livePlan();
    expect(diffBills(live, structuredClone(live), TODAY)).toEqual({ added: [], removed: [], changed: [] });
    const d = compare(live, structuredClone(live));
    expect(Object.values(d.checks).every((c) => !Object.keys(c.marks).length && !c.gone.length)).toBe(true);
    expect(diffSettings(live, structuredClone(live))).toEqual([]);
  });

  it('lists added, removed and changed bills', () => {
    const live = livePlan();
    let whatIf = upsertBill(live, bill('car', 'Car payment', 25, 300, { debt: 'loan' }));
    whatIf = removeBill(whatIf, 'gym', TODAY);
    whatIf = changeAmountFrom(whatIf, 'power', '2026-12', 110);
    whatIf = upsertBill(whatIf, { ...whatIf.bills.find((b) => b.id === 'phone')!, dueDay: 12, name: 'Mobile' });
    whatIf = upsertBill(whatIf, { ...whatIf.bills.find((b) => b.id === 'card')!, balance: 0, apr: 20 });

    const d = diffBills(live, whatIf, TODAY);
    expect(d.added.map((b) => b.id)).toEqual(['car']);
    expect(d.removed.map((b) => b.id)).toEqual(['gym']);
    expect(Object.fromEntries(d.changed.map((c) => [c.after.id, c.fields]))).toEqual({
      phone: ['name', 'due'],
      power: ['amount'],
      card: ['balance', 'rate'],
    });
    const power = d.changed.find((c) => c.after.id === 'power')!;
    expect([power.amountBefore, power.amountAfter]).toEqual([90, 110]);
  });
});

describe('what-if differences: timeline', () => {
  it('marks a new bill as added on the paycheck it lands on', () => {
    const live = livePlan();
    const d = compare(live, upsertBill(live, bill('car', 'Car payment', 25, 300)));
    expect(d.checks[B].marks).toEqual({ [occKey('car', '2026-12')]: { kind: 'added' } });
    expect(d.checks[A].marks).toEqual({});
  });

  it('notes a removed bill where it used to be', () => {
    const live = livePlan();
    const d = compare(live, removeBill(live, 'gym', TODAY));
    expect(d.checks[A].gone.map((g) => [g.item.billId, g.to, g.removed])).toEqual([['gym', null, true]]);
  });

  it('shows both ends of a move', () => {
    const live = livePlan();
    const key = occKey('power', '2026-12');
    const d = compare(live, pinItem(live, key, A));
    expect(d.checks[A].marks[key]).toEqual({ kind: 'moved', from: B });
    expect(d.checks[B].gone.map((g) => [g.item.billId, g.to, g.removed])).toEqual([['power', A, false]]);
  });

  it('shows an item pinned out of the tray, and one sent to it', () => {
    const live = livePlan();
    const reg = occKey('reg', null);
    const phone = occKey('phone', '2026-12');
    const d = compare(live, pinItem(pinItem(live, reg, B), phone, 'tray'));
    expect(d.checks[B].marks[reg]).toEqual({ kind: 'moved', from: 'tray' });
    expect(d.tray.gone.map((g) => [g.item.billId, g.to])).toEqual([['reg', B]]);
    expect(d.tray.marks[phone]).toEqual({ kind: 'moved', from: A });
    expect(d.checks[A].gone.map((g) => [g.item.billId, g.to])).toEqual([['phone', 'tray']]);
  });

  it('marks a changed amount with what it was', () => {
    const live = livePlan();
    const key = occKey('power', '2026-12');
    const d = compare(live, patchOcc(live, key, { amount: 130 }));
    expect(d.checks[B].marks[key]).toEqual({ kind: 'changed', was: 90 });
  });

  it('keeps the live rent shares for comparison', () => {
    const live = livePlan();
    const d = compare(live, upsertBill(live, bill('car', 'Car payment', 25, 300)));
    const rent = occKey('rent', '2027-01');
    const shares = buildTimeline(live, TODAY, [A, B]).checks.map((c) => c.shares[0].amount);
    expect([d.liveShares[`${rent}#0`], d.liveShares[`${rent}#1`]]).toEqual(shares);
  });
});

describe('what-if differences: settings', () => {
  it('notes a change of pay or budgets', () => {
    const live = livePlan();
    let whatIf = setSchedule(live, { ...live.schedule, baseline: 3000 }, TODAY);
    whatIf = setBudgets(whatIf, [{ id: 'f', name: 'Food', amount: 200 }]);
    expect(diffSettings(live, whatIf)).toEqual([
      { what: 'baseline', before: 2500, after: 3000 },
      { what: 'budgets', before: 0, after: 200 },
    ]);
  });
});
