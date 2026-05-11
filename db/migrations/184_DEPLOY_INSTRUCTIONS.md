# Migration 184: Deploy Instructions

`184_additional_values_prorate_period.sql` adds optional `period_start` and
`period_end` columns to `additional_values`. The application code in this
branch (`feat/prorate-marketing-expenses`) reads those columns when computing
dashboard metrics. Deploying the code before the migration runs will surface
500s on every analytics endpoint that selects `period_start, period_end`.

## DEPLOY ORDER

1. Run `184_additional_values_prorate_period.sql` in the Supabase Dashboard
   SQL Editor (project: vgqecqqleuowvoimcoxg) BEFORE merging this branch
   to `main`. The migration is wrapped in a single `BEGIN ... COMMIT` and is
   idempotent (`ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`), so re-running is a no-op.
2. Confirm the migration succeeded. Expected effects:
   - `additional_values.period_start` (DATE, nullable) present
   - `additional_values.period_end` (DATE, nullable) present
   - `additional_values_period_both_or_neither` CHECK constraint present
   - `additional_values_period_end_after_start` CHECK constraint present
   - `idx_additional_values_period` partial index present
3. After the migration is green, merge this branch to `main`. Vercel will
   auto-deploy the frontend; Railway will auto-deploy the backend.
4. Smoke test in production:
   - Open `/additional-values`, create a new "Gasto" with category
     `Gasto Publicitario`, tick "Este gasto cubre un período", enter a
     range, save. The row should persist and the table column should show
     the `from -> to` span plus a per-day prorated breakdown.
   - Confirm `/analytics/chart` and `/analytics/overview` still return 200
     and `gasto_publicitario` looks consistent.

## ROLLBACK

The code change touches four commits on this branch (period columns added,
analytics fetches widened, scope validation, deploy note). Reverting the
merge commit on `main` returns the application to single-date behavior.

The migration itself does NOT need to be reverted:
- `period_start` / `period_end` stay on the table as NULL on every legacy
  row. Selecting them from the reverted code that does not include them in
  its column list is a no-op.
- The CHECK constraints only fire when one of the period columns is set,
  which only happens via the new POST/PUT path. After rollback, no new
  rows will populate those columns.
- The partial index `idx_additional_values_period` is small (only indexes
  rows where `period_start IS NOT NULL`) and harmless if left in place.

Zero data loss either way.

## WHY THIS NOTE EXISTS

Migrations and code ship from different surfaces (Supabase dashboard for SQL,
git push for the apps). Vercel and Railway both auto-deploy on push to
`main`, which means the safe order is: migration first, merge second.
Reversing this order produces a window where the backend runs queries that
reference columns the database does not yet have.
