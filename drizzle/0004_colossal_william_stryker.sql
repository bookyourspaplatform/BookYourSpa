ALTER TABLE "branches" ADD COLUMN "show_therapist_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "agent_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "genre" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "delivery_type" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "price_options" jsonb DEFAULT '[]'::jsonb;