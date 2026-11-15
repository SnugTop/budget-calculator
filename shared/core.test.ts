import { describe, expect, it } from 'vitest';
import { amountFor, buildTimeline, freezePast, occKey, paydayOnOrBefore, paydaysInMonth, tabBalance } from './core';
import {
  addTabPayment,
  changeAmountFrom,
  debtKind,
  newBill,
  newPlan,
  patchOcc,
  pinItem,
  removeBill,
  setActual,
  setPaid,
  setReopened,
  setSchedule,
  upsertBill,
  upsertTabEntry,
} from './ops';
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

/** The same made-up budget as the design mockup. */
function mockPlan(): Plan {
  let plan = setSchedule(newPlan(TODAY), { anchor: A, everyDays: 14, baseline: 2500 }, TODAY);
  const bills: Bill[] = [
    bill('phone', 'Phone', 5, 85),
    bill('gym', 'Gym', 6, 40),
    bill('car', 'Car insurance', 8, 140, { partnerShare: 60 }),
    bill('net', 'Internet', 10, 60),
    bill('tv', 'Streaming', 12, 16, { cantPayAhead: true }),
    bill('sofa', 'Furniture plan', 15, 120, { balance: 480 }),
    bill('cloud', 'Cloud storage', 16, 3, { cantPayAhead: true }),
    bill('power', 'Electric', 20, 90),
    bill('pet', 'Pet insurance', 22, 45, { cantPayAhead: true }),
    bill('music', 'Music', 24, 11, { cantPayAhead: true }),
    bill('card', 'Credit card', 26, 150),
    bill('unit', 'Storage unit', 28, 95),
    bill('park', 'Parking', 30, 120, { cantPayAhead: true }),
    bill('rent', 'Rent', 1, 2000, { partnerShare: 600, split: 'even' }),
    bill('save', 'Savings', 28, 250, { split: 'fixed', parts: [100, 150] }),
    bill('reg', 'Car registration', 15, 200, { repeat: { kind: 'once', date: '2026-12-15' } }),
    bill('dog', 'Dog food', 20, 60, { repeat: { kind: 'every', months: 3, start: '2026-12' } }),
  ];
  for (const b of bills) plan = upsertBill(plan, b);
  return plan;
}

const two = (plan: Plan, today = TODAY) => buildTimeline(plan, today, [A, B]);

describe('paydays', () => {
  const s = { anchor: A, everyDays: 14, baseline: 2500 };

  it('finds the payday on or before a date, in both directions from the anchor', () => {
    expect(paydayOnOrBefore(s, '2026-12-04')).toBe('2026-12-04');
    expect(paydayOnOrBefore(s, '2026-12-17')).toBe('2026-12-04');
    expect(paydayOnOrBefore(s, '2026-12-18')).toBe('2026-12-18');
    expect(paydayOnOrBefore(s, '2026-12-03')).toBe('2026-11-20');
  });

  it('lists three paydays in a three-paycheck month', () => {
    expect(paydaysInMonth(s, '2026-12')).toEqual(['2026-12-04', '2026-12-18']);
    expect(paydaysInMonth(s, '2027-01')).toEqual(['2027-01-01', '2027-01-15', '2027-01-29']);
  });
});

describe('pinning', () => {
  it('puts a monthly bill on the paycheck whose window holds its due date', () => {
    const { checks } = two(mockPlan());
    expect(checks[0].items.map((i) => i.billId)).toEqual(['phone', 'gym', 'car', 'net', 'tv', 'sofa', 'cloud']);
    expect(checks[1].items.map((i) => i.billId)).toEqual(['power', 'pet', 'music', 'card', 'unit', 'park']);
  });

  it('starts one-time and every-few-months items in the tray, where they do not count', () => {
    const { checks, tray } = two(mockPlan());
    expect(tray.map((i) => i.billId)).toEqual(['reg', 'dog']);
    expect(checks[0].bills).toBe(404);
  });

  it('counts an item once it is pinned, and flags it when the payday is after its due date', () => {
    const plan = pinItem(mockPlan(), occKey('reg', null), B);
    const { checks, tray } = two(plan);
    const reg = checks[1].items.find((i) => i.billId === 'reg')!;
    expect(reg.late).toBe(true);
    expect(checks[1].bills).toBe(711);
    expect(tray.map((i) => i.billId)).toEqual(['dog']);
  });

  it('lets a monthly bill move to an earlier paycheck or out to the tray', () => {
    let plan = pinItem(mockPlan(), occKey('power', '2026-12'), A);
    let t = two(plan);
    expect(t.checks[0].bills).toBe(494);
    expect(t.checks[1].bills).toBe(421);
    expect(t.checks[0].items.find((i) => i.billId === 'power')!.late).toBe(false);

    plan = pinItem(plan, occKey('power', '2026-12'), 'tray');
    t = two(plan);
    expect(t.checks[0].bills).toBe(404);
    expect(t.tray.some((i) => i.billId === 'power')).toBe(true);

    plan = pinItem(plan, occKey('power', '2026-12'), null);
    expect(two(plan).checks[1].bills).toBe(511);
  });

  it('repeats an every-few-months item only in its months', () => {
    const plan = mockPlan();
    const later = buildTimeline(plan, '2027-03-01', ['2027-02-26', '2027-03-12']);
    expect(later.tray.filter((i) => i.billId === 'dog').map((i) => i.due)).toEqual(['2027-03-20']);
  });
});

describe('paycheck numbers', () => {
  it('matches the mockup: bills, splits, leftover, per week', () => {
    const [a, b] = two(mockPlan()).checks;
    expect(a.bills).toBe(404);
    expect(b.bills).toBe(511);
    expect(a.shares.map((s) => [s.billId, s.amount])).toEqual([
      ['save', 150],
      ['rent', 729],
    ]);
    expect(b.shares.map((s) => [s.billId, s.amount])).toEqual([
      ['save', 100],
      ['rent', 671],
    ]);
    expect(a.leftover).toBe(1217);
    expect(b.leftover).toBe(1218);
    expect(a.perWeek).toBe(608.5);
  });

  it('uses actual pay once entered', () => {
    const plan = setActual(mockPlan(), A, 2700);
    const [a, b] = two(plan).checks;
    expect(a.pay).toBe(2700);
    // The extra 200 is shared out by the rent split.
    expect(a.leftover + b.leftover).toBe(1217 + 1218 + 200);
    expect(Math.abs(a.leftover - b.leftover)).toBeLessThanOrEqual(1);
  });

  it('counts only my part of a shared bill and tracks what the partner still owes', () => {
    let plan = mockPlan();
    let a = two(plan).checks[0];
    const car = a.items.find((i) => i.billId === 'car')!;
    expect([car.full, car.partner, car.amount]).toEqual([140, 60, 80]);
    // 60 for car insurance plus 600 of rent, which sits on its first funding paycheck.
    expect(a.waitingOnPartner).toBe(660);

    plan = patchOcc(plan, occKey('car', '2026-12'), { partnerGot: true });
    plan = patchOcc(plan, occKey('rent', '2027-01'), { partnerGot: true });
    a = two(plan).checks[0];
    expect(a.waitingOnPartner).toBe(0);
  });

  it('uses the amount actually paid, and drops paid bills from keep-in-account', () => {
    let plan = mockPlan();
    expect(two(plan).checks[0].keepInAccount).toBe(19);
    plan = setPaid(plan, occKey('tv', '2026-12'), true, 16);
    plan = setPaid(plan, occKey('phone', '2026-12'), true, 91.5);
    const a = two(plan).checks[0];
    expect(a.keepInAccount).toBe(3);
    expect(a.bills).toBe(410.5);
    expect(a.items.find((i) => i.billId === 'phone')!.paidAmount).toBe(91.5);
  });

  it('shows leftover before and after the category budgets', () => {
    const plan = mockPlan();
    plan.budgets = [
      { id: 'f', name: 'Food', amount: 200 },
      { id: 'g', name: 'Gas', amount: 50 },
      { id: 'u', name: 'Fun', amount: 150 },
      { id: 'h', name: 'Household', amount: 50 },
    ];
    const a = two(plan).checks[0];
    expect(a.leftover).toBe(1217);
    expect(a.afterBudgets).toBe(767);
    expect(a.afterPerWeek).toBe(383.5);
  });

  it('adds a pinned tab payment as money in or money out', () => {
    let plan = upsertTabEntry(mockPlan(), {
      id: 't1',
      description: 'Concert tickets',
      direction: 'owedToMe',
      total: 190,
      payments: [],
    });
    plan = upsertTabEntry(plan, { id: 't2', description: 'Vet bill', direction: 'iOwe', total: 70, payments: [] });
    plan = addTabPayment(plan, 't1', { id: 'p1', amount: 90, date: A, pin: null });
    plan = addTabPayment(plan, 't2', { id: 'p2', amount: 70, date: B, pin: B });
    expect(tabBalance(plan)).toEqual({ owedToMe: 100, iOwe: 0, net: 100 });
    const [a, b] = two(plan).checks;
    expect(a.tabNet).toBe(0);
    expect(b.tabNet).toBe(-70);
    // The rent split still evens the two paychecks out.
    expect(a.leftover + b.leftover).toBe(1217 + 1218 - 70);
  });
});

describe('split bills', () => {
  it('evens out the two paychecks as bills move', () => {
    const plan = pinItem(mockPlan(), occKey('card', '2026-12'), A);
    const [a, b] = two(plan).checks;
    expect(Math.abs(a.leftover - b.leftover)).toBeLessThanOrEqual(1);
    expect(a.shares.find((s) => s.billId === 'rent')!.amount + b.shares.find((s) => s.billId === 'rent')!.amount).toBe(
      1400,
    );
  });

  it('puts the larger fixed part on the paycheck with more room', () => {
    // Move enough onto the first paycheck that the second has more room.
    let plan = pinItem(mockPlan(), occKey('card', '2026-12'), A);
    plan = pinItem(plan, occKey('unit', '2026-12'), A);
    const [a, b] = two(plan).checks;
    expect(a.shares.find((s) => s.billId === 'save')!.amount).toBe(100);
    expect(b.shares.find((s) => s.billId === 'save')!.amount).toBe(150);
  });

  it('honours an override on rent and gives the other paycheck the rest', () => {
    const plan = patchOcc(mockPlan(), occKey('rent', '2027-01'), { firstShare: 1000 });
    const [a, b] = two(plan).checks;
    const ra = a.shares.find((s) => s.billId === 'rent')!;
    const rb = b.shares.find((s) => s.billId === 'rent')!;
    expect([ra.amount, rb.amount]).toEqual([1000, 400]);
    expect(ra.overridden).toBe(true);
    expect(ra.suggested).toBe(729);
  });

  it('honours swapped or changed savings parts for one month', () => {
    const plan = patchOcc(mockPlan(), occKey('save', '2026-12'), { parts: [50, 200] });
    const [a, b] = two(plan).checks;
    expect(a.shares.find((s) => s.billId === 'save')!.amount).toBe(50);
    expect(b.shares.find((s) => s.billId === 'save')!.amount).toBe(200);
  });

  it('puts no split shares on a third paycheck', () => {
    const jan = buildTimeline(mockPlan(), '2027-01-02', ['2027-01-01', '2027-01-15', '2027-01-29']).checks;
    expect(jan[0].shares.map((s) => s.billId).sort()).toEqual(['rent', 'save']);
    expect(jan[1].shares.map((s) => s.billId).sort()).toEqual(['rent', 'save']);
    expect(jan[2].shares).toEqual([]);
    // January's first two paychecks fund the rent due February 1.
    expect(jan[0].shares.find((s) => s.billId === 'rent')!.due).toBe('2027-02-01');
  });
});

describe('installments', () => {
  it('counts down the balance and stops when it is paid off', () => {
    const plan = mockPlan();
    const paydays = ['2026-12-04', '2027-01-15', '2027-02-12', '2027-03-12', '2027-04-09'];
    const sofa = buildTimeline(plan, TODAY, paydays)
      .checks.flatMap((c) => c.items)
      .filter((i) => i.billId === 'sofa');
    expect(sofa.map((i) => [i.due, i.amount, i.balanceLeft])).toEqual([
      ['2026-12-15', 120, 360],
      ['2027-01-15', 120, 240],
      ['2027-02-15', 120, 120],
      ['2027-03-15', 120, 0],
    ]);
  });

  it('moves the balance when a payment is checked off, including a larger one', () => {
    let plan = setPaid(mockPlan(), occKey('sofa', '2026-12'), true, 200);
    expect(plan.bills.find((b) => b.id === 'sofa')!.balance).toBe(280);
    plan = setPaid(plan, occKey('sofa', '2026-12'), false, 0);
    expect(plan.bills.find((b) => b.id === 'sofa')!.balance).toBe(480);
  });
});

describe('interest', () => {
  // 12% a year is 1% a month.
  const withLoan = () => upsertBill(mockPlan(), bill('loan', 'Car loan', 9, 100, { debt: 'loan', balance: 1000, apr: 12 }));

  it('adds a month of interest before each planned payment', () => {
    const paydays = ['2026-12-04', '2027-01-01', '2027-01-29'];
    const loan = buildTimeline(withLoan(), TODAY, paydays)
      .checks.flatMap((c) => c.items)
      .filter((i) => i.billId === 'loan');
    expect(loan.map((i) => [i.due, i.amount, i.balanceLeft])).toEqual([
      ['2026-12-09', 100, 910],
      ['2027-01-09', 100, 819.1],
      ['2027-02-09', 100, 727.29],
    ]);
  });

  it('makes the last payment the remainder, interest included', () => {
    const plan = upsertBill(mockPlan(), bill('loan', 'Car loan', 9, 100, { debt: 'loan', balance: 150, apr: 12 }));
    const loan = buildTimeline(plan, TODAY, ['2026-12-04', '2027-01-01', '2027-02-12'])
      .checks.flatMap((c) => c.items)
      .filter((i) => i.billId === 'loan');
    expect(loan.map((i) => [i.due, i.amount, i.balanceLeft])).toEqual([
      ['2026-12-09', 100, 51.5],
      ['2027-01-09', 52.02, 0],
    ]);
  });

  it('charges interest once when a payment is checked off, and undoes it exactly', () => {
    const key = occKey('loan', '2026-12');
    const balance = (p: Plan) => p.bills.find((b) => b.id === 'loan')!.balance;

    let plan = setPaid(withLoan(), key, true, 100);
    expect(balance(plan)).toBe(910);
    expect(plan.occ[key].interest).toBe(10);

    // Changing what was paid does not charge interest a second time.
    plan = setPaid(plan, key, true, 150);
    expect(balance(plan)).toBe(860);

    plan = setPaid(plan, key, false, 0);
    expect(balance(plan)).toBe(1000);
    expect(plan.occ[key]).toBeUndefined();
  });

  it('leaves a bill with no rate counting straight down', () => {
    const plan = setPaid(mockPlan(), occKey('sofa', '2026-12'), true, 120);
    expect(plan.bills.find((b) => b.id === 'sofa')!.balance).toBe(360);
    expect(plan.occ[occKey('sofa', '2026-12')].interest).toBeUndefined();
  });
});

describe('editing bills', () => {
  it('changes one month only, or from a month on', () => {
    let plan = patchOcc(mockPlan(), occKey('power', '2026-12'), { amount: 130 });
    expect(two(plan).checks[1].items.find((i) => i.billId === 'power')!.amount).toBe(130);

    plan = changeAmountFrom(mockPlan(), 'power', '2027-01', 110);
    const b = plan.bills.find((x) => x.id === 'power')!;
    expect(amountFor(b, '2026-12')).toBe(90);
    expect(amountFor(b, '2027-01')).toBe(110);
    expect(amountFor(b, '2027-06')).toBe(110);
  });

  it('removes an unpaid bill outright, and ends a paid one after this month', () => {
    let plan = removeBill(mockPlan(), 'gym', TODAY);
    expect(plan.bills.some((b) => b.id === 'gym')).toBe(false);

    plan = setPaid(mockPlan(), occKey('gym', '2026-12'), true, 40);
    plan = removeBill(plan, 'gym', TODAY);
    expect(two(plan).checks[0].items.some((i) => i.billId === 'gym')).toBe(true);
    const jan = buildTimeline(plan, TODAY, ['2027-01-01']).checks[0];
    expect(jan.items.some((i) => i.billId === 'gym')).toBe(false);
  });
});

describe('credit cards and loans', () => {
  it('reads the kind, including plans saved when credit was a plain flag', () => {
    expect(debtKind(bill('a', 'Phone', 5, 85))).toBe(null);
    expect(debtKind(bill('b', 'Store card', 3, 75, { debt: 'credit' }))).toBe('credit');
    expect(debtKind(bill('c', 'Car loan', 9, 300, { debt: 'loan' }))).toBe('loan');
    expect(debtKind(bill('d', 'Old card', 3, 75, { credit: true }))).toBe('credit');
    expect(debtKind(bill('e', 'Moved to loans', 3, 75, { credit: true, debt: 'loan' }))).toBe('loan');
  });
});

describe('history', () => {
  it('freezes a finished paycheck so later edits do not change it', () => {
    const later = '2026-12-20';
    let plan = freezePast(mockPlan(), later);
    expect(plan.checks[A].frozen).toBeTruthy();
    expect(plan.checks[B]?.frozen).toBeFalsy();

    plan = changeAmountFrom(plan, 'phone', '2026-01', 500);
    plan = removeBill(plan, 'gym', later);
    const [a, b] = two(plan, later).checks;
    expect(a.frozen).toBe(true);
    expect(a.bills).toBe(404);
    expect(a.leftover).toBe(1217);
    // The open paycheck keeps the rent share that pairs with the frozen one.
    expect(b.shares.find((s) => s.billId === 'rent')!.amount).toBe(671);
  });

  it('does nothing when there is nothing to freeze', () => {
    const plan = mockPlan();
    expect(freezePast(plan, TODAY)).toBe(plan);
  });

  it('lets a past paycheck be reopened and locked again', () => {
    const later = '2026-12-20';
    let plan = freezePast(mockPlan(), later);
    plan = setReopened(plan, A, true);
    plan = setPaid(plan, occKey('phone', '2026-12'), true, 90);
    plan = freezePast(plan, later);
    expect(two(plan, later).checks[0].frozen).toBe(false);
    expect(two(plan, later).checks[0].bills).toBe(409);

    plan = freezePast(setReopened(plan, A, false), later);
    const a = two(plan, later).checks[0];
    expect(a.frozen).toBe(true);
    expect(a.bills).toBe(409);
  });
});
