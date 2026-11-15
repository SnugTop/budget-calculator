import type { BillChange, SettingChange } from '../../shared/diff';
import { money } from './ui';

const amountOrNone = (n: number | null | undefined): string => (n == null ? 'none' : money(n));

/** Plain-language lines for what changed on a bill between the live plan and a what-if. */
export function describeChange(c: BillChange): string[] {
  const out: string[] = [];
  if (c.fields.includes('name')) out.push(`Renamed from ${c.before.name}`);
  if (c.fields.includes('amount')) out.push(`Amount was ${money(c.amountBefore)}, now ${money(c.amountAfter)}`);
  if (c.fields.includes('due')) out.push(`Due day was ${c.before.dueDay}, now ${c.after.dueDay}`);
  if (c.fields.includes('balance')) {
    out.push(`Balance was ${amountOrNone(c.before.balance)}, now ${amountOrNone(c.after.balance)}`);
  }
  if (c.fields.includes('rate')) out.push(`Interest was ${c.before.apr ?? 0}%, now ${c.after.apr ?? 0}%`);
  if (c.fields.includes('other')) out.push('Other details changed');
  return out;
}

export function describeSetting(s: SettingChange): string {
  if (s.what === 'baseline') return `Baseline pay was ${money(s.before)}, now ${money(s.after)}`;
  if (s.what === 'budgets') return `Budgets per paycheck were ${money(s.before)}, now ${money(s.after)}`;
  return 'Pay schedule changed';
}
