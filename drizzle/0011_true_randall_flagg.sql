-- Backfill a code for any pre-existing display-only promotion: every promotion
-- now requires a promo code. Derived from the (unique) slug, falling back to a
-- hash when the slug yields nothing usable.
UPDATE "promotions"
SET "code" = coalesce(
  nullif(upper(left(regexp_replace(coalesce("slug", ''), '[^a-zA-Z0-9]', '', 'g'), 20)), ''),
  'PROMO' || upper(substr(md5("id"), 1, 10))
)
WHERE "code" IS NULL OR btrim("code") = '';--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "applies_to" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "valid_from_hour" smallint;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "valid_until_hour" smallint;--> statement-breakpoint
ALTER TABLE "provider_promotions" ADD COLUMN "treatment_ids" jsonb;