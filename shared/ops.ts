/**
 * Every way a plan can change. Each function returns a new plan and leaves
 * the one it was given untouched.
 */
import { addMonths, monthOf } from './dates';
import { billIdOfKey, monthlyInterest, paydayOnOrBefore, round2 } from './core';
import type { Bill, Budget, ISODate, Month, Occ, Plan, Schedule, TabEntry, TabPayment } from './types';

const clone = <T>(x: T): T => structuredClone(x);

/** Works on plain http too, where crypto.randomUUID is not available. */
export const newId = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newPlan(today: ISODate): Plan {
  return {
    v: 1,
    ready: false,
    start: today,
    partnerName: 'Partner',
    schedule: { anchor: today, everyDays: 14, baseline: 0 },
    bills: [],
    occ: {},
    checks: {},
    budgets: [],
    tab: [],
  };
}

export function newBill(): Bill {
  return {
    id: newId(),
    name: '',
    amount: 0,
    dueDay: 1,
    repeat: { kind: 'monthly' },
    cantPayAhead: false,
    partnerShare: 0,
    balance: null,
    debt: null,
    split: 'none',
    parts: null,
    startMonth: null,
    endMonth: null,
    changes: [],
  };
}

/** Set fields on one month's record. A null or undefined value clears the field. */
export function patchOcc(plan: Plan, key: string, patch: { [K in keyof Occ]?: Occ[K] | null }): Plan {
  const next = clone(plan);
  const rec: Record<string, unknown> = { ...(next.occ[key] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) delete rec[k];
    else rec[k] = v;
  }
  if (Object.keys(rec).length) next.occ[key] = rec as Occ;
  else delete next.occ[key];
  return next;
}

/** Pin an item to a paycheck or the tray. Null puts it back where it lands by default. */
export const pinItem = (plan: Plan, key: string, pin: ISODate | 'tray' | null): Plan =>
  patchOcc(plan, key, { pin });

/**
 * Check an item off, or undo that. `amount` is what was actually paid for my part.
 * A bill with a balance moves with it: a month of interest is added when the
 * payment is first checked off, then the payment comes off. Unchecking puts
 * the balance back exactly where it was.
 */
export function setPaid(plan: Plan, key: string, paid: boolean, amount: number): Plan {
  const before = plan.occ[key] ?? {};
  const current = plan.bills.find((b) => b.id === billIdOfKey(key));
  const was = before.paid ? before.paidAmount ?? 0 : 0;
  const wasInterest = before.paid ? before.interest ?? 0 : 0;
  const now = paid ? amount : 0;
  // Interest is charged once per payment; changing the amount paid later does not charge it again.
  const interest = !paid ? 0 : before.paid ? wasInterest : current ? monthlyInterest(current) : 0;
  const next = patchOcc(plan, key, {
    paid: paid ? true : null,
    paidAmount: paid ? amount : null,
    interest: interest > 0 ? interest : null,
  });
  const bill = next.bills.find((b) => b.id === billIdOfKey(key));
  if (bill && bill.balance != null) bill.balance = round2(bill.balance + was - wasInterest - now + interest);
  return next;
}

export function setSharePaid(plan: Plan, key: string, index: 0 | 1, paid: boolean): Plan {
  const cur = plan.occ[key]?.sharePaid ?? [false, false];
  const sharePaid: [boolean, boolean] = [cur[0], cur[1]];
  sharePaid[index] = paid;
  return patchOcc(plan, key, { sharePaid: sharePaid[0] || sharePaid[1] ? sharePaid : null });
}

export function setActual(plan: Plan, payday: ISODate, actual: number | null): Plan {
  const next = clone(plan);
  const rec = { ...(next.checks[payday] ?? {}) };
  if (actual == null) delete rec.actual;
  else rec.actual = actual;
  if (Object.keys(rec).length) next.checks[payday] = rec;
  else delete next.checks[payday];
  return next;
}

/** Unlock a past paycheck for corrections, or lock it again. */
export function setReopened(plan: Plan, payday: ISODate, open: boolean): Plan {
  const next = clone(plan);
  const rec = { ...(next.checks[payday] ?? {}) };
  delete rec.frozen;
  if (open) rec.reopened = true;
  else delete rec.reopened;
  next.checks[payday] = rec;
  return next;
}

export function upsertBill(plan: Plan, bill: Bill): Plan {
  const next = clone(plan);
  const i = next.bills.findIndex((b) => b.id === bill.id);
  const saved = clone(bill);
  if (saved.split === 'fixed' && saved.parts) saved.amount = round2(saved.parts[0] + saved.parts[1]);
  if (i >= 0) next.bills[i] = saved;
  else next.bills.push(saved);
  return next;
}

/** Change a bill's amount from a month on. Earlier months keep what they had. */
export function changeAmountFrom(plan: Plan, billId: string, month: Month, amount: number): Plan {
  const next = clone(plan);
  const bill = next.bills.find((b) => b.id === billId);
  if (!bill) return next;
  bill.changes = bill.changes.filter((c) => c.from < month).concat({ from: month, amount });
  return next;
}

/**
 * Remove a bill from now on. Months already paid keep their record, so the
 * current paycheck's numbers do not jump.
 */
export function removeBill(plan: Plan, billId: string, today: ISODate): Plan {
  const next = clone(plan);
  const bill = next.bills.find((b) => b.id === billId);
  if (!bill) return next;
  const keys = Object.keys(next.occ).filter((k) => billIdOfKey(k) === billId);
  const hasHistory = keys.some((k) => next.occ[k].paid || next.occ[k].sharePaid);
  if (bill.repeat.kind === 'once' || !hasHistory) {
    next.bills = next.bills.filter((b) => b.id !== billId);
    for (const k of keys) delete next.occ[k];
    return next;
  }
  const thisMonth = monthOf(today);
  const paidThisMonth = keys.some((k) => k.endsWith('@' + thisMonth) && (next.occ[k].paid || next.occ[k].sharePaid));
  bill.endMonth = paidThisMonth ? thisMonth : addMonths(thisMonth, -1);
  return next;
}

/** Whether a bill is a credit card, a loan, or neither. Understands plans saved before loans existed. */
export const debtKind = (bill: Bill): 'credit' | 'loan' | null => bill.debt ?? (bill.credit ? 'credit' : null);

/** Bills that still apply this month or later. */
export const activeBills = (plan: Plan, today: ISODate): Bill[] =>
  plan.bills.filter((b) => !b.endMonth || b.endMonth >= monthOf(today));

export function setSchedule(plan: Plan, schedule: Schedule, today: ISODate): Plan {
  const next = clone(plan);
  next.schedule = schedule;
  if (!next.ready) {
    next.ready = true;
    next.start = paydayOnOrBefore(schedule, today);
  }
  return next;
}

export function setBudgets(plan: Plan, budgets: Budget[]): Plan {
  const next = clone(plan);
  next.budgets = budgets;
  return next;
}

export function setPartnerName(plan: Plan, name: string): Plan {
  const next = clone(plan);
  next.partnerName = name.trim() || 'Partner';
  return next;
}

export function upsertTabEntry(plan: Plan, entry: TabEntry): Plan {
  const next = clone(plan);
  const i = next.tab.findIndex((e) => e.id === entry.id);
  if (i >= 0) next.tab[i] = clone(entry);
  else next.tab.push(clone(entry));
  return next;
}

export function removeTabEntry(plan: Plan, entryId: string): Plan {
  const next = clone(plan);
  next.tab = next.tab.filter((e) => e.id !== entryId);
  return next;
}

export function addTabPayment(plan: Plan, entryId: string, payment: TabPayment): Plan {
  const next = clone(plan);
  next.tab.find((e) => e.id === entryId)?.payments.push(payment);
  return next;
}

export function removeTabPayment(plan: Plan, entryId: string, paymentId: string): Plan {
  const next = clone(plan);
  const entry = next.tab.find((e) => e.id === entryId);
  if (entry) entry.payments = entry.payments.filter((p) => p.id !== paymentId);
  return next;
}

/** A loose check that an imported file is a plan from this app. */
export function looksLikePlan(x: unknown): x is Plan {
  const p = x as Plan;
  return (
    !!p &&
    typeof p === 'object' &&
    p.v === 1 &&
    !!p.schedule &&
    typeof p.schedule.anchor === 'string' &&
    Array.isArray(p.bills) &&
    Array.isArray(p.budgets) &&
    Array.isArray(p.tab) &&
    typeof p.occ === 'object' &&
    typeof p.checks === 'object'
  );
}
