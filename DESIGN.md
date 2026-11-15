# Budget Calculator: Design

Status: phase 1 built (2026-11-14). Hosting on Kubernetes comes later.
Examples use made-up numbers. Real budget data stays out of the repo.

## Goal

Replace the paycheck-planning spreadsheet with a self-hosted web app that is
faster to use on a laptop or phone, does the same job, and never loses data.

The job: for each upcoming paycheck, see which bills it has to cover, how much
of the rent it should carry, and how much is left for the two weeks and for
each week. Then move things around to forecast and make decisions.

## Concepts

**Profile.** One person's budget, behind its own login. Everything below belongs
to a profile. A second person can create their own profile; profiles do not
share data in this version.

**Pay schedule.** A repeating payday (for example every other Friday) and a
baseline pay amount. The app generates the paycheck timeline from it.

**Paycheck.** One payday. Has an expected amount (the baseline) and, once the
check lands, an actual amount that replaces it. Its *window* runs from its
payday to the day before the next payday. Each paycheck stands alone: leftover
or shortfall does not carry into the next one.

**Bill.** Name, amount, due day of month, and options:
- *Can't pay ahead*: drafts on a fixed date, so the money has to sit in the
  account until then.
- *Shared*: the partner covers a fixed part; only my part counts in my budget.
  The partner's part has its own check-off for when it has been received, and
  each paycheck shows how much is still awaited.
- *Balance*: an installment with a remaining balance. Each payment reduces it
  and the bill ends when it reaches zero.
- *Credit card or loan*: a bill can be listed under Credit cards or under
  Loans. Each of those sections of the Bills screen shows its monthly
  payments, its total balance left, and an estimate of a month's interest.
- *Interest rate*: a yearly rate on a credit card or loan with a balance.
  Checking off a payment adds one month of interest (balance x rate / 12),
  then takes the payment off. Planned future payments are worked out the
  same way. It is an estimate; the balance can be corrected by hand.
- *Split across checks*: funded by two paychecks a month instead of one. There
  are two kinds, *even out* (rent) and *fixed parts* (savings), described under
  "Split bills" below.
- *Repeat*: monthly by default, every N months, or one time.

**Item on a check.** Each month a bill produces one item. Every item is either
*pinned* to a paycheck, where it counts, or sitting *unpinned* in a tray, where
it does not.
- Monthly bills are pinned automatically to the paycheck whose window contains
  the due date.
- One-time and every-N-months items start in the tray with a suggested date.
- Any item can be dragged to another paycheck or back to the tray.
- An item pinned to a paycheck that lands after its due date shows a "late" badge.

**Check-off.** Marking an item paid records the amount actually paid, which
defaults to the planned amount and can be more or less. The paycheck's numbers
use the actual amount once it exists.

**Category budgets.** Food, gas, fun, household, and any others, each with an
amount per paycheck. Savings is not a category; it is a split bill.

**Tab.** A running list of amounts between me and my partner. Each entry has a
description, a direction (they owe me or I owe them), a total, payments made,
and a remaining amount. The tab shows one net balance. A tab payment can be
pinned to a paycheck, where it counts as money out or money in.

**Scenario.** A named copy of the plan from today forward. Change anything in
it, compare it to the live plan, then apply it or discard it.

## Numbers on each paycheck

| Number | How it is calculated |
| --- | --- |
| Pay | Actual amount if entered, otherwise baseline |
| Bills | Sum of my part of every pinned item (actual paid amount once checked off) |
| Split shares | This paycheck's part of each split bill (rent, savings) |
| Leftover | Pay - Bills - Split shares |
| Leftover per week | Leftover / 2 |
| After budgets | Leftover - category budgets, also shown per week |
| Keep in account | Sum of unpaid can't-pay-ahead items on this paycheck |

### Split bills

A split bill is funded by the first two paychecks of a calendar month. Rent due
on the 1st is funded by the two paychecks of the month before. In a month with
three paychecks, the third carries no split shares.

**Fixed parts (savings).** The bill has two set amounts, for example 100 and
150. The app puts the larger part on whichever paycheck has more leftover
before split bills. The parts can be swapped, and either amount can be changed
for a single month.

**Even out (rent).** Worked out after the fixed parts are placed. With my part
of the bill R, and each paycheck's leftover before this bill La and Lb:

    A's share = (R + La - Lb) / 2, limited to between 0 and R, rounded to whole dollars
    B's share = R - A's share

This evens out the leftover of the two paychecks.

**Overrides.** Typing a share overrides the suggestion and the other share
updates to match. A reset button returns to the suggestion. Suggestions update
as bills move, unless overridden.

## Screens

1. **Timeline (home).** The current and next paycheck as two cards side by side
   (stacked on a phone), with later paychecks below. Each card shows its items,
   the numbers above, and a field for actual pay. Items drag between cards and
   the tray.
2. **Bills.** The full list grouped by due day. Add, edit, remove. Editing asks
   whether the change applies to this paycheck only or from this paycheck on.
3. **Tray.** Unpinned items with their suggested dates and a total.
4. **Tab.** Entries in both directions, payments, remaining, and the net balance.
5. **Scenarios.** List, create from live plan, and a comparison of leftover per
   paycheck, live versus scenario.
6. **Settings.** Pay schedule, baseline pay, category budgets, profile, backup
   export and import.

## Data rules

- Past paychecks are kept as history and do not change when a bill is edited later.
- All data is in one database on a persistent volume and survives restarts.
- A full export and import exists for backup and for moving hosts.

## Phases

1. **Plan.** Everything above.
2. **Tracking.** A separate spending log per paycheck. It reads the plan and
   shows planned versus actual leftover. Turning it on or off never changes the plan.
3. **Later.** Linking items between two profiles. Hosting on Kubernetes (minikube).

## Stack

One TypeScript app, one container, one database file.

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, front and back | The budget math is written once and used on both sides |
| Interface | React with Vite | Widely used; works on laptop and phone as a responsive site |
| Drag and drop | dnd-kit | Handles touch, so pinning works on a phone |
| Styling | Tailwind CSS | One layout for both screen sizes |
| Server | Hono on Node | Small API server that also serves the built interface |
| Database | SQLite through Drizzle | The whole budget is one file on a persistent volume |
| Login | Username and password per profile, session cookie | Enough for home-network use |
| Tests | Vitest | Checks the split and leftover math against known cases |
| Packaging | One Docker image | `docker compose up` now; the same image on minikube later |

The budget math (pay windows, pinning, split bills, leftover) lives in one
module with no dependency on the interface or the database.

SQLite means the app runs as a single copy. On Kubernetes that is one
deployment with one replica and one persistent volume claim.

Access is home network only for now. Access on the go comes later.

## As built

Decisions made while building phase 1 that this document did not spell out.

- **A plan is one document.** Each plan (the live one, and each what-if) is
  stored as a single JSON document in SQLite. The browser holds the plan,
  applies changes with the shared budget math, and saves the whole document.
  A what-if is a copy of the document, and a backup file is the document.
- **Two devices.** Every save carries a version number. If the phone and the
  laptop both edit, the second save is refused and that device is asked to
  reload, so nothing is overwritten unseen.
- **History.** When a paycheck's window ends, a copy of its numbers is saved
  with the plan. Later edits never change it. A past paycheck can be reopened
  to correct it, then locked again.
- **Which paychecks fund a split bill.** The first two paychecks of the month
  that holds the day before the due date. So rent due on the 1st is funded by
  the month before, and savings due late in a month by that same month.
- **Paying a different amount.** Checking off a bill records the planned
  amount; the item's options let you change what was actually paid. For rent,
  typing a share is the override, and the other paycheck takes the rest.
- **Tray.** Shows one-time items until they are pinned, and other unpinned
  items due from a month back to a month past the last paycheck shown.
- **Removing a bill.** A bill with no paid months is deleted. One with paid
  months ends after the current month so past numbers stay put.
- **Backups.** The server writes a dated copy of the database once a day and
  keeps seven. Settings has a download and restore for a file of your own.
- **What-if marks.** While a what-if is open, everything that differs from the
  live plan is marked: added items in green, removed or moved-away items in
  orange and struck through, and moved-here or changed items in blue, each
  with a label. The marks show on the Timeline and Bills screens, and the
  What-ifs screen lists every change in one place.
- **Paychecks shown.** The timeline shows four paychecks to start. "Show more"
  and "Show fewer" change that, and the count is remembered on each device.
- **Sign-in.** Passwords are stored as salted scrypt hashes. The session
  cookie is not marked Secure because the app is served over plain http at
  home; that changes when access on the go is added.

## Assumptions to confirm

1. Can't-pay-ahead items can still be moved between paychecks. The flag only
   feeds the "keep in account" number.
2. Category budgets are set per paycheck, not per month, so months with three
   paychecks need no special handling.
3. Checking off a split-bill share means the money is set aside, not that the
   landlord has been paid.
4. A scenario copies bills, pay, pins, and rent shares. It does not copy
   check-offs or tracking.

## Open questions

None right now.
