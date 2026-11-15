/** Dates are plain strings so they survive JSON and never shift with time zones. */
export type ISODate = string; // YYYY-MM-DD
export type Month = string; // YYYY-MM

export interface Schedule {
  /** Any real payday. Every other payday is a whole number of periods away from it. */
  anchor: ISODate;
  /** Days between paydays: 14 for every other week, 7 for weekly. */
  everyDays: number;
  /** Expected pay, used until the actual amount is entered on a paycheck. */
  baseline: number;
}

export type Repeat =
  | { kind: 'monthly' }
  | { kind: 'every'; months: number; start: Month }
  | { kind: 'once'; date: ISODate | null };

export type SplitKind = 'none' | 'even' | 'fixed';

export interface Bill {
  id: string;
  name: string;
  /** Full amount of the bill, before the partner's part is taken off. */
  amount: number;
  /** Day of the month it is due. Clamped to the month's length. */
  dueDay: number;
  repeat: Repeat;
  cantPayAhead: boolean;
  /** Fixed amount the partner covers. 0 means the bill is not shared. */
  partnerShare: number;
  /** Remaining balance for an installment or a card, or null for an ordinary bill. */
  balance: number | null;
  /** Yearly interest rate as a percent, for example 24.99. Applies to the balance. */
  apr?: number | null;
  /** A credit card or a loan payment. Each kind is listed in its own section. */
  debt?: 'credit' | 'loan' | null;
  /** Older plans marked credit this way. Read through debtKind, never written. */
  credit?: boolean;
  /** 'even' and 'fixed' bills are funded by the first two paychecks of a month. */
  split: SplitKind;
  /** The two set amounts of a 'fixed' split bill. */
  parts: [number, number] | null;
  startMonth: Month | null;
  endMonth: Month | null;
  /** Amount changes that apply from a month on. */
  changes: { from: Month; amount: number }[];
}

/** Overrides and records for one bill in one month. Keyed by `${billId}@${month}`. */
export interface Occ {
  /** Paycheck this item is pinned to, or 'tray'. Absent means the default. */
  pin?: ISODate | 'tray';
  /** Full amount for this month only. */
  amount?: number;
  paid?: boolean;
  /** What was actually paid for my part, when it differs from the plan. */
  paidAmount?: number;
  partnerGot?: boolean;
  /** Interest added to the bill's balance when this payment was checked off. */
  interest?: number;
  /** Even-out split: my override for the first funding paycheck's share. */
  firstShare?: number;
  /** Fixed split: my override for the two parts, in paycheck order. */
  parts?: [number, number];
  sharePaid?: [boolean, boolean];
}

export interface ItemView {
  key: string;
  billId: string;
  name: string;
  due: ISODate | null;
  /** Full bill amount for this month. */
  full: number;
  /** Partner's part. */
  partner: number;
  /** My planned part. */
  amount: number;
  paid: boolean;
  paidAmount: number | null;
  /** What counts against the paycheck: the paid amount once paid, else the plan. */
  effective: number;
  cantPayAhead: boolean;
  partnerGot: boolean;
  balanceLeft: number | null;
  repeat: Repeat['kind'];
  pin: ISODate | 'tray';
  defaultPin: ISODate | 'tray';
  /** Pinned to a paycheck that lands after the due date. */
  late: boolean;
}

export interface ShareView {
  key: string;
  billId: string;
  name: string;
  kind: 'even' | 'fixed';
  /** 0 for the first funding paycheck, 1 for the second. */
  index: 0 | 1;
  amount: number;
  suggested: number;
  overridden: boolean;
  /** True when only one paycheck funds the bill, so there is nothing to split. */
  solo: boolean;
  paid: boolean;
  /** My part of the whole bill this month. */
  total: number;
  partner: number;
  partnerGot: boolean;
  due: ISODate | null;
}

export interface TabLine {
  entryId: string;
  paymentId: string;
  description: string;
  /** Positive is money in, negative is money out. */
  amount: number;
}

export interface CheckView {
  date: ISODate;
  windowEnd: ISODate;
  baseline: number;
  actual: number | null;
  pay: number;
  items: ItemView[];
  shares: ShareView[];
  tab: TabLine[];
  bills: number;
  sharesTotal: number;
  tabNet: number;
  leftover: number;
  perWeek: number;
  budgets: number;
  afterBudgets: number;
  afterPerWeek: number;
  keepInAccount: number;
  waitingOnPartner: number;
  frozen: boolean;
}

export interface CheckRec {
  actual?: number | null;
  /** Saved copy of a past paycheck. Later edits to bills never change it. */
  frozen?: CheckView;
  /** A past paycheck the user unlocked for corrections. */
  reopened?: boolean;
}

export interface Budget {
  id: string;
  name: string;
  /** Amount per paycheck. */
  amount: number;
}

export interface TabPayment {
  id: string;
  amount: number;
  date: ISODate;
  /** Paycheck this payment counts on, if any. */
  pin: ISODate | null;
}

export interface TabEntry {
  id: string;
  description: string;
  direction: 'owedToMe' | 'iOwe';
  total: number;
  payments: TabPayment[];
}

export interface Plan {
  v: 1;
  /** False until the pay schedule has been set. */
  ready: boolean;
  /** First paycheck this plan covers. Nothing earlier is shown or frozen. */
  start: ISODate;
  partnerName: string;
  schedule: Schedule;
  bills: Bill[];
  occ: Record<string, Occ>;
  checks: Record<ISODate, CheckRec>;
  budgets: Budget[];
  tab: TabEntry[];
}

export interface Timeline {
  checks: CheckView[];
  tray: ItemView[];
}
