/**
 * What a what-if changes compared with the live plan. Pure functions: the
 * screens decide how to show the result.
 */
import { amountFor } from './core';
import { monthOf } from './dates';
import { activeBills, debtKind } from './ops';
import type { Bill, ISODate, ItemView, Plan, Timeline } from './types';

// ---------------------------------------------------------------- bills

export type BillField = 'name' | 'amount' | 'due' | 'balance' | 'rate' | 'other';

export interface BillChange {
  before: Bill;
  after: Bill;
  fields: BillField[];
  /** This month's full amount in each plan. */
  amountBefore: number;
  amountAfter: number;
}

export interface BillDiff {
  added: Bill[];
  removed: Bill[];
  changed: BillChange[];
}

const rest = (b: Bill): string =>
  JSON.stringify([b.repeat, b.cantPayAhead, b.partnerShare, b.split, b.parts, debtKind(b)]);

export function diffBills(live: Plan, whatIf: Plan, today: ISODate): BillDiff {
  const month = monthOf(today);
  const before = new Map(activeBills(live, today).map((b) => [b.id, b]));
  const after = new Map(activeBills(whatIf, today).map((b) => [b.id, b]));
  const changed: BillChange[] = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) continue;
    const amountBefore = amountFor(b, month);
    const amountAfter = amountFor(a, month);
    const fields: BillField[] = [];
    if (b.name !== a.name) fields.push('name');
    if (amountBefore !== amountAfter) fields.push('amount');
    if (b.dueDay !== a.dueDay) fields.push('due');
    if ((b.balance ?? null) !== (a.balance ?? null)) fields.push('balance');
    if ((b.apr ?? null) !== (a.apr ?? null)) fields.push('rate');
    if (rest(b) !== rest(a)) fields.push('other');
    if (fields.length) changed.push({ before: b, after: a, fields, amountBefore, amountAfter });
  }
  return {
    added: [...after.values()].filter((b) => !before.has(b.id)),
    removed: [...before.values()].filter((b) => !after.has(b.id)),
    changed,
  };
}

// ---------------------------------------------------------------- timeline

type Place = ISODate | 'tray';

/** Why an item on a paycheck (or in the tray) differs from the live plan. */
export type Mark =
  | { kind: 'added' }
  /** It sits somewhere else in the live plan. `from` is null when that place is not on screen. */
  | { kind: 'moved'; from: Place | null }
  | { kind: 'changed'; was: number };

/** An item the live plan has in this place and the what-if does not. */
export interface Gone {
  item: ItemView;
  /** Where the what-if has it now, or null when it is nowhere on screen. */
  to: Place | null;
  /** True when its bill no longer exists in the what-if. */
  removed: boolean;
}

export interface PlaceDiff {
  marks: Record<string, Mark>;
  gone: Gone[];
}

export interface TimelineDiff {
  checks: Record<ISODate, PlaceDiff>;
  tray: PlaceDiff;
  /** The live plan's amount for each split share, keyed by `${key}#${index}`. */
  liveShares: Record<string, number>;
}

function places(tl: Timeline): Map<Place, Map<string, ItemView>> {
  const out = new Map<Place, Map<string, ItemView>>();
  for (const c of tl.checks) {
    if (!c.frozen) out.set(c.date, new Map(c.items.map((i) => [i.key, i])));
  }
  out.set('tray', new Map(tl.tray.map((i) => [i.key, i])));
  return out;
}

/** Compare two timelines built for the same paydays. */
export function diffTimeline(live: Timeline, whatIf: Timeline, liveBills: Bill[], whatIfBills: Bill[]): TimelineDiff {
  const liveIds = new Set(liveBills.map((b) => b.id));
  const whatIfIds = new Set(whatIfBills.map((b) => b.id));
  const before = places(live);
  const after = places(whatIf);
  const whereIn = (all: Map<Place, Map<string, ItemView>>, key: string): Place | null => {
    for (const [place, items] of all) if (items.has(key)) return place;
    return null;
  };

  const result: TimelineDiff = { checks: {}, tray: { marks: {}, gone: [] }, liveShares: {} };
  for (const [place, items] of after) {
    const was = before.get(place) ?? new Map<string, ItemView>();
    const d: PlaceDiff = { marks: {}, gone: [] };
    for (const [key, item] of items) {
      const old = was.get(key);
      if (old) {
        if (old.amount !== item.amount) d.marks[key] = { kind: 'changed', was: old.amount };
      } else if (!liveIds.has(item.billId)) {
        d.marks[key] = { kind: 'added' };
      } else {
        d.marks[key] = { kind: 'moved', from: whereIn(before, key) };
      }
    }
    for (const [key, item] of was) {
      if (!items.has(key)) d.gone.push({ item, to: whereIn(after, key), removed: !whatIfIds.has(item.billId) });
    }
    if (place === 'tray') result.tray = d;
    else result.checks[place] = d;
  }
  for (const c of live.checks) {
    for (const s of c.shares) result.liveShares[`${s.key}#${s.index}`] = s.amount;
  }
  return result;
}

// ---------------------------------------------------------------- settings

export interface SettingChange {
  what: 'baseline' | 'schedule' | 'budgets';
  before: number;
  after: number;
}

export function diffSettings(live: Plan, whatIf: Plan): SettingChange[] {
  const out: SettingChange[] = [];
  const total = (p: Plan) => Math.round(p.budgets.reduce((t, b) => t + b.amount, 0) * 100) / 100;
  if (live.schedule.baseline !== whatIf.schedule.baseline) {
    out.push({ what: 'baseline', before: live.schedule.baseline, after: whatIf.schedule.baseline });
  }
  if (live.schedule.everyDays !== whatIf.schedule.everyDays || live.schedule.anchor !== whatIf.schedule.anchor) {
    out.push({ what: 'schedule', before: live.schedule.everyDays, after: whatIf.schedule.everyDays });
  }
  if (total(live) !== total(whatIf)) out.push({ what: 'budgets', before: total(live), after: total(whatIf) });
  return out;
}
