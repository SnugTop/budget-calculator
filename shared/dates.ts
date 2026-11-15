import type { ISODate, Month } from './types';

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export const toDays = (iso: ISODate): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};

export const fromDays = (n: number): ISODate => new Date(n * DAY).toISOString().slice(0, 10);

export const addDays = (iso: ISODate, n: number): ISODate => fromDays(toDays(iso) + n);

export const monthOf = (iso: ISODate): Month => iso.slice(0, 7);

const monthIndex = (m: Month): number => {
  const [y, mm] = m.split('-').map(Number);
  return y * 12 + (mm - 1);
};

const monthFromIndex = (i: number): Month => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;

export const addMonths = (m: Month, n: number): Month => monthFromIndex(monthIndex(m) + n);

/** Whole months from a to b. Positive when b is later. */
export const monthDiff = (a: Month, b: Month): number => monthIndex(b) - monthIndex(a);

export const daysInMonth = (m: Month): number => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm, 0)).getUTCDate();
};

/** The given day in a month, clamped so day 31 works in short months. */
export const dateIn = (m: Month, day: number): ISODate =>
  `${m}-${pad(Math.max(1, Math.min(day, daysInMonth(m))))}`;

export const monthsBetween = (from: Month, to: Month): Month[] => {
  const out: Month[] = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(monthFromIndex(i));
  return out;
};

/** Today's date on the user's own clock. */
export const todayISO = (): ISODate => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Dec 4" */
export const shortDate = (iso: ISODate): string => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/** "Fri, Dec 4" */
export const longDate = (iso: ISODate): string => {
  const wd = new Date(toDays(iso) * DAY).getUTCDay();
  return `${WEEKDAYS[wd]}, ${shortDate(iso)}`;
};

/** "December 2026" style label for a month. */
export const monthLabel = (m: Month): string => {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTHS[mm - 1]} ${y}`;
};
