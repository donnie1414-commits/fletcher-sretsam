# Monthly rent schedule — proposal

Status: **proposal, nothing built.** It adds a new record type, which needs your sign-off before any build.

## The problem it solves

Every lease carries one monthly rent and one Total Rent, typed by hand. Everything else is inferred: the hub works out a year's revenue as monthly × months. That breaks on the cases that matter:

- **Concessions and one-off credits.** The rent review in the hub's Exceptions found 172 leases in AY 26-27 whose Total Rent is exactly $600 below monthly × 12. That looks like a concession recorded only in the total. Nothing says which month it applies to.
- **Partial months.** A lease starting on the 5th or ending on the 25th has two partial months. Today they count as whole months.
- **Two-year leases.** Two in AY 27-28 carry only one year in Total Rent. Year two is assumed to repeat year one, with no room for an escalation.
- **Rent changes mid-term.** A transfer, a roommate added, a rent reduction partway through: none of these has a place to live.
- **Reconciliation.** There is nothing to compare a month's billing or collections against, because no record says what each month should be.

## The design

### One new record: Rent Schedule Line (`customrecord_ad_rent_line`)

A child of the Lease record, one line per lease per month per charge.

| Field | Type | Purpose |
|---|---|---|
| Lease | List/Record → Lease (parent; record is a child) | which contract |
| Period | Date (first of the month) | which month |
| Charge type | List: Rent, Proration, Concession, Fee, Credit, Adjustment | what the line is |
| Amount | Currency | positive charge, negative credit |
| Bedroom / unit | List/Record → Units/Bedrooms (optional) | for bedroom-level splits |
| Tenant | List/Record → Customer (optional) | only if rent is split per tenant |
| Status | List: Scheduled, Billed, Collected, Waived | where the month stands |
| Billed / Collected | Currency | filled by the reconciliation import |
| Source | List: Generated, Manual | generated lines can be regenerated; manual ones are kept |
| Locked | Check box | set once billed; regeneration never touches a locked line |
| Note | Free text | why a manual line exists |

### How lines are created

1. **Generated from the lease.** When a lease is saved, or its dates or rent change, a User Event script writes one Rent line per month from start to end at the monthly rent. A partial first or last month gets a Proration line instead. The convention is your choice, see below.
2. **Edited for the edge cases.** Agents add a Concession, Fee or Adjustment line, or change a month's amount, from the hub. That is a schedule grid in the lease dialog and in the unit's history panel. Manual and locked lines survive regeneration.
3. **Backfilled once.** A Map/Reduce script creates lines for every active lease in the current and next academic years. Where Total Rent disagrees with monthly × term, it adds one Adjustment line in the first month for the difference, marked for review, so nothing is lost.

### What changes in the reports

- **Total Rent becomes computed:** the sum of the lease's lines, written back by the same User Event. The "Total Rent does not equal monthly × term" check retires, because the two can no longer disagree.
- **Revenue per academic year** becomes the sum of lines whose period falls in that year. It replaces monthly × months, and two-year leases and escalations come out exactly.
- **Rent per bed and the KPI tables** use the scheduled monthly figure for the selected period, so a concession month shows as one.
- **Fallback:** a lease with no lines keeps today's monthly × months rule, so nothing breaks during the backfill.

### Monthly reconciliation

A new **Reconciliation** view under Reporting, one screen per month:

| Property · unit · lease | Scheduled | Billed | Collected | Difference | Status |
|---|---|---|---|---|---|

- **Billed and Collected** come from wherever rent is billed today. If that is RentRoom, a monthly CSV import matches rows to lines by RentRoom unit id (already on the unit record) and month. If it is NetSuite invoices, the hub reads them directly.
- **Exceptions** gain three checks: billed ≠ scheduled, collected < billed after the due date, and lines still Scheduled for a past month.
- **Roll-ups** by property, market and fund, with CSV export for the close.

## Size and limits

About 2,000 leases a year × 12 to 24 lines comes to 30,000 to 45,000 lines a year. SuiteQL handles that comfortably. The User Event regenerates one lease's lines per save, roughly 30 to 50 governance units. The backfill runs as Map/Reduce, out of any user's request.

## Decisions I need from you

1. **Approve the new record type.** It is outside the record types the hub writes to today.
2. **Proration convention** for partial months: days in that month (rent ÷ days in month × days occupied), or a 30-day month, or none (whole months only).
3. **Concessions:** should the $600 pattern become a Concession line in a specific month? If so, which month by default, the first or the last?
4. **Where rent is billed and collected:** RentRoom, NetSuite invoices, or both. That decides the reconciliation source.
5. **Per lease or per tenant:** is one schedule per lease enough, or do you need each tenant's share (split rent, co-signers)?

## Phasing

1. Record, generator, backfill, computed Total Rent, reports on the schedule (with fallback).
2. Schedule editor in the hub; schedule-based exceptions.
3. Reconciliation import and monthly view.

Each phase ships on its own and is useful without the next.
