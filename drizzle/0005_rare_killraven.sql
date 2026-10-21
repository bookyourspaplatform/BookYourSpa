ALTER TABLE "therapists" ADD COLUMN "role" text DEFAULT 'therapist' NOT NULL;--> statement-breakpoint
ALTER TABLE "therapists" ADD COLUMN "salary_type" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "therapists" ADD COLUMN "salary_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "therapists" ADD COLUMN "incentive_type" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "therapists" ADD COLUMN "incentive_value" integer DEFAULT 0 NOT NULL;