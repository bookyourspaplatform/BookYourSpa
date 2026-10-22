-- Therapists now earn a fixed monthly salary; any per-job salary share belongs
-- in the job-fee (incentive) percent so total pay per job is unchanged.
UPDATE "therapists"
SET "incentive_value" = LEAST(10000, "incentive_value" + "salary_value"),
    "salary_type" = 'fixed',
    "salary_value" = 0
WHERE "role" = 'therapist'
  AND "salary_type" = 'percent'
  AND "incentive_type" = 'percent';--> statement-breakpoint
-- Fallback: a therapist whose job fee was a fixed bonus can't hold a percent
-- share — convert the incentive to percent carrying the old salary share.
UPDATE "therapists"
SET "incentive_type" = 'percent',
    "incentive_value" = "salary_value",
    "salary_type" = 'fixed',
    "salary_value" = 0
WHERE "role" = 'therapist'
  AND "salary_type" = 'percent';
