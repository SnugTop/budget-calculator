/**
 * The budget math. Pure functions only: no database, no interface.
 * Everything the screens show about a paycheck comes from buildTimeline.
 */
import { addDays, addMonths, dateIn, fromDays, monthDiff, monthOf, monthsBetween, toDays } from './dates';
import type {
  Bill,
  CheckView,
  ISODate,
  ItemView,
  Month,
  Occ,
  Plan,
  Schedule,
  ShareView,
  TabLine,
  Timeline,
} from './types';

export const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const sum = <T>(list: T[], f: (x: T) => number): number => round2(list.reduce((t, x) => t + f(x), 0));

// ---------------------------------------------------------------- paydays

/** The payday on or before a date. A paycheck's window starts on its payday. */
export function paydayOnOrBefore(s: Schedule, date: ISODate): ISODate {
  const a = toDays(s.anchor);
  const k = Math.floor((toDays(date) - a) / s.everyDays);
  return fromDays(a + k * s.everyDays);
}

export function paydaysInMonth(s: Schedule, month: Month): ISODate[] {
  const first = dateIn(month, 1);
  const last = dateIn(month, 31);
  let p = paydayOnOrBefore(s, first);
  if (p < first) p = addDays(p, s.everyDays);
  const out: ISODate[] = [];
  while (p <= last) {
    out.push(p);
    p = addDays(p, s.everyDays);
  }
  return out;
}

/** The paychecks to show: `past` earlier ones, the current one, and later ones up to `future` in total. */
export function visiblePaydays(plan: Plan, today: ISODate, future: number, past = 0): ISODate[] {
  const cur = paydayOnOrBefore(plan.schedule, today);
  const out: ISODate[] = [];
  for (let i = -past; i < future; i++) {
    const p = addDays(cur, i * plan.schedule.everyDays);
    if (p >= plan.start) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- occurrences

/** A bill's interest per month as a fraction of its balance. Zero when it has no rate. */
export const monthlyRate = (bill: Bill): number => (bill.balance != null && bill.apr ? bill.apr / 1200 : 0);

/** An estimate of one month's interest on a bill's current balance. */
export const monthlyInterest = (bill: Bill): number => round2((bill.balance ?? 0) * monthlyRate(bill));

export const occKey = (billId: string, month: Month | null): string => `${billId}@${month ?? 'once'}`;
export const billIdOfKey = (key: string): string => key.slice(0, key.lastIndexOf('@'));
export const monthOfKey = (key: string): Month | null => {
  const m = key.slice(key.lastIndexOf('@') + 1);
  return m === 'once' ? null : m;
};

/** A bill's full amount in a month, honouring "from this month on" changes. */
export function amountFor(bill: Bill, month: Month | null): number {
  if (!month) return bill.amount;
  let amount = bill.amount;
  for (const c of [...bill.changes].sort((a, b) => a.from.localeCompare(b.from))) {
    if (c.from <= month) amount = c.amount;
  }
  return amount;
}

interface Raw {
  key: string;
  bill: Bill;
  month: Month | null;
  due: ISODate | null;
}

function occurrences(bill: Bill, from: Month, to: Month): Raw[] {
  if (bill.repeat.kind === 'once') {
    const due = bill.repeat.date;
    return [{ key: occKey(bill.id, null), bill, month: due ? monthOf(due) : null, due }];
  }
  const out: Raw[] = [];
  for (const m of monthsBetween(from, to)) {
    if (bill.startMonth && m < bill.startMonth) continue;
    if (bill.endMonth && m > bill.endMonth) continue;
    if (bill.repeat.kind === 'every') {
      const d = monthDiff(bill.repeat.start, m);
      if (d < 0 || d % Math.max(1, bill.repeat.months) !== 0) continue;
    }
    out.push({ key: occKey(bill.id, m), bill, month: m, due: dateIn(m, bill.dueDay) });
  }
  return out;
}

/** Every ordinary (non-split) bill item in a range of months, with overrides applied. */
function resolveItems(plan: Plan, today: ISODate, from: Month, to: Month): ItemView[] {
  const thisMonth = monthOf(today);
  const out: ItemView[] = [];
  for (const bill of plan.bills) {
    if (bill.split !== 'none') continue;
    let remaining = bill.balance;
    const rate = monthlyRate(bill);
    for (const raw of occurrences(bill, from, to)) {
      const rec: Occ = plan.occ[raw.key] ?? {};
      let full = rec.amount ?? amountFor(bill, raw.month);
      let balanceLeft: number | null = null;
      if (remaining != null) {
        // An installment stops once its balance is paid off, and its last payment is the remainder.
        const upcoming = !rec.paid && (raw.month == null || raw.month >= thisMonth);
        if (upcoming) {
          if (remaining <= 0) continue;
          // A month of interest is added before each payment comes off.
          const owed = round2(remaining + round2(remaining * rate));
          full = Math.min(full, owed);
          remaining = round2(owed - full);
        }
        balanceLeft = remaining;
      }
      const partner = clamp(bill.partnerShare, 0, full);
      const amount = round2(full - partner);
      const paid = !!rec.paid;
      const paidAmount = paid ? rec.paidAmount ?? amount : null;
      const defaultPin: ISODate | 'tray' =
        bill.repeat.kind === 'monthly' && raw.due ? paydayOnOrBefore(plan.schedule, raw.due) : 'tray';
      const pin = rec.pin ?? defaultPin;
      out.push({
        key: raw.key,
        billId: bill.id,
        name: bill.name,
        due: raw.due,
        full,
        partner,
        amount,
        paid,
        paidAmount,
        effective: paidAmount ?? amount,
        cantPayAhead: bill.cantPayAhead,
        partnerGot: !!rec.partnerGot,
        balanceLeft,
        repeat: bill.repeat.kind,
        pin,
        defaultPin,
        late: pin !== 'tray' && !!raw.due && raw.due < pin,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- timeline

const byDue = (a: { due: ISODate | null; name: string }, b: { due: ISODate | null; name: string }): number =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.name.localeCompare(b.name);

/**
 * Build the view of each requested paycheck, plus the tray of unpinned items.
 * `today` decides which installments are still upcoming and what the tray shows.
 */
export function buildTimeline(plan: Plan, today: ISODate, paydays: ISODate[]): Timeline {
  if (!paydays.length) return { checks: [], tray: [] };
  const s = plan.schedule;
  const sorted = [...paydays].sort();
  const last = sorted[sorted.length - 1];
  const from = addMonths(monthOf(sorted[0]), -2);
  const to = addMonths(monthOf(addDays(last, s.everyDays)), 2);

  const items = resolveItems(plan, today, from, to);
  const byPin = new Map<string, ItemView[]>();
  for (const it of items) {
    if (!byPin.has(it.pin)) byPin.set(it.pin, []);
    byPin.get(it.pin)!.push(it);
  }

  const tabByPin = new Map<string, TabLine[]>();
  for (const entry of plan.tab) {
    for (const p of entry.payments) {
      if (!p.pin) continue;
      if (!tabByPin.has(p.pin)) tabByPin.set(p.pin, []);
      tabByPin.get(p.pin)!.push({
        entryId: entry.id,
        paymentId: p.id,
        description: entry.description,
        amount: entry.direction === 'owedToMe' ? p.amount : -p.amount,
      });
    }
  }

  const frozenOf = (p: ISODate): CheckView | null => {
    const rec = plan.checks[p];
    return rec?.frozen && !rec.reopened ? rec.frozen : null;
  };
  const payOf = (p: ISODate): number => plan.checks[p]?.actual ?? s.baseline;
  /** What a paycheck has left before any split bill is taken out. */
  const roomOf = (p: ISODate): number =>
    payOf(p) - sum(byPin.get(p) ?? [], (i) => i.effective) + sum(tabByPin.get(p) ?? [], (t) => t.amount);

  // Split bills: grouped by the month whose first two paychecks fund them.
  const sharesByPay = new Map<string, ShareView[]>();
  const groups = new Map<Month, Raw[]>();
  for (const bill of plan.bills) {
    if (bill.split === 'none') continue;
    for (const raw of occurrences(bill, from, to)) {
      if (!raw.due) continue;
      // Due on the 1st means the month before pays for it.
      const fundMonth = monthOf(addDays(raw.due, -1));
      if (!groups.has(fundMonth)) groups.set(fundMonth, []);
      groups.get(fundMonth)!.push(raw);
    }
  }
  for (const [fundMonth, list] of groups) {
    const funding = paydaysInMonth(s, fundMonth).slice(0, 2);
    if (!funding.length) continue;
    const used = funding.map(() => 0);
    // Fixed parts are placed first; even-out bills then balance what is left.
    list.sort((a, b) => (a.bill.split === 'fixed' ? 0 : 1) - (b.bill.split === 'fixed' ? 0 : 1));
    for (const raw of list) {
      const bill = raw.bill;
      const rec: Occ = plan.occ[raw.key] ?? {};
      const full = rec.amount ?? amountFor(bill, raw.month);
      const partner = bill.split === 'even' ? clamp(bill.partnerShare, 0, full) : 0;
      let total = round2(full - partner);
      let shares: number[];
      let suggested: number[];
      let overridden = false;

      if (bill.split === 'fixed') {
        const half = round2(total / 2);
        const base = bill.parts ?? [half, round2(total - half)];
        if (funding.length === 1) {
          suggested = [round2(base[0] + base[1])];
          shares = suggested;
        } else {
          const hi = Math.max(base[0], base[1]);
          const lo = Math.min(base[0], base[1]);
          const rooms = funding.map((p, i) => roomOf(p) - used[i]);
          suggested = rooms[0] >= rooms[1] ? [hi, lo] : [lo, hi];
          shares = rec.parts ? [...rec.parts] : suggested;
          overridden = !!rec.parts;
        }
      } else if (funding.length === 1) {
        suggested = [total];
        shares = suggested;
      } else {
        const rooms = funding.map((p, i) => roomOf(p) - used[i]);
        const a = clamp(Math.round((total + rooms[0] - rooms[1]) / 2), 0, total);
        suggested = [a, round2(total - a)];
        if (rec.firstShare != null) {
          const f = clamp(rec.firstShare, 0, total);
          shares = [f, round2(total - f)];
          overridden = true;
        } else {
          shares = suggested;
        }
      }

      // A past paycheck keeps the share it was saved with; the other one takes the rest.
      funding.forEach((p, i) => {
        const saved = frozenOf(p)?.shares.find((x) => x.key === raw.key);
        if (!saved || shares.length < 2) return;
        shares[i] = saved.amount;
        if (bill.split === 'even') shares[1 - i] = round2(total - saved.amount);
        overridden = true;
      });
      if (bill.split === 'fixed') total = sum(shares, (x) => x);

      shares.forEach((amount, i) => {
        used[i] += amount;
        const p = funding[i];
        if (!sharesByPay.has(p)) sharesByPay.set(p, []);
        sharesByPay.get(p)!.push({
          key: raw.key,
          billId: bill.id,
          name: bill.name,
          kind: bill.split === 'fixed' ? 'fixed' : 'even',
          index: i as 0 | 1,
          amount,
          suggested: suggested[i],
          overridden,
          solo: shares.length < 2,
          paid: !!rec.sharePaid?.[i],
          total,
          partner,
          partnerGot: !!rec.partnerGot,
          due: raw.due,
        });
      });
    }
  }

  const weeks = s.everyDays / 7;
  const budgets = sum(plan.budgets, (b) => b.amount);
  const checks: CheckView[] = sorted.map((p) => {
    const saved = frozenOf(p);
    if (saved) return { ...saved, frozen: true };
    const its = [...(byPin.get(p) ?? [])].sort(byDue);
    const shares = [...(sharesByPay.get(p) ?? [])].sort(byDue);
    const tab = tabByPin.get(p) ?? [];
    const actual = plan.checks[p]?.actual ?? null;
    const pay = actual ?? s.baseline;
    const bills = sum(its, (i) => i.effective);
    const sharesTotal = sum(shares, (x) => x.amount);
    const tabNet = sum(tab, (t) => t.amount);
    const leftover = round2(pay - bills - sharesTotal + tabNet);
    const afterBudgets = round2(leftover - budgets);
    return {
      date: p,
      windowEnd: addDays(p, s.everyDays - 1),
      baseline: s.baseline,
      actual,
      pay,
      items: its,
      shares,
      tab,
      bills,
      sharesTotal,
      tabNet,
      leftover,
      perWeek: round2(leftover / weeks),
      budgets,
      afterBudgets,
      afterPerWeek: round2(afterBudgets / weeks),
      keepInAccount: sum(
        its.filter((i) => i.cantPayAhead && !i.paid),
        (i) => i.amount,
      ),
      waitingOnPartner: round2(
        sum(
          its.filter((i) => i.partner > 0 && !i.partnerGot),
          (i) => i.partner,
        ) +
          sum(
            shares.filter((x) => x.index === 0 && x.partner > 0 && !x.partnerGot),
            (x) => x.partner,
          ),
      ),
      frozen: false,
    };
  });

  const cur = paydayOnOrBefore(s, today);
  const trayFrom = addDays(cur, -31);
  const trayTo = addDays(last, s.everyDays + 31);
  const tray = items
    .filter((i) => i.pin === 'tray')
    .filter((i) => i.repeat === 'once' || (!!i.due && i.due >= trayFrom && i.due <= trayTo))
    .sort(byDue);

  return { checks, tray };
}

/**
 * Save a copy of every paycheck whose window has ended, so later edits to
 * bills never rewrite history. Returns the same object when nothing changed.
 */
export function freezePast(plan: Plan, today: ISODate): Plan {
  if (!plan.ready) return plan;
  const s = plan.schedule;
  const cur = paydayOnOrBefore(s, today);
  let next = plan;
  let p = plan.start;
  for (let guard = 0; p < cur && guard < 600; guard++) {
    const rec = next.checks[p];
    if (!rec?.frozen && !rec?.reopened) {
      const view = buildTimeline(next, today, [p]).checks[0];
      next = { ...next, checks: { ...next.checks, [p]: { ...rec, frozen: { ...view, frozen: true } } } };
    }
    p = addDays(p, s.everyDays);
  }
  return next;
}

/** What the tab comes to. Positive means the partner owes me overall. */
export function tabBalance(plan: Plan): { owedToMe: number; iOwe: number; net: number } {
  const left = (dir: 'owedToMe' | 'iOwe') =>
    sum(
      plan.tab.filter((e) => e.direction === dir),
      (e) => e.total - sum(e.payments, (p) => p.amount),
    );
  const owedToMe = left('owedToMe');
  const iOwe = left('iOwe');
  return { owedToMe, iOwe, net: round2(owedToMe - iOwe) };
}
