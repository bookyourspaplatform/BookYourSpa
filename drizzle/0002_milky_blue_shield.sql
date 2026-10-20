ALTER TABLE "branches" ADD COLUMN "google_maps_url" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "short_description" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "categories" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "spa_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "doorstep_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "facilities" text[] DEFAULT '{}'::text[] NOT NULL;