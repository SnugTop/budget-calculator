import type { ISODate, Plan } from '../../shared/types';

/** What every screen needs: the plan being edited and how to change it. */
export interface Ctx {
  plan: Plan;
  update: (fn: (p: Plan) => Plan) => void;
  today: ISODate;
  /** The live plan, present only while a what-if is open, for side-by-side numbers. */
  live: Plan | null;
}
