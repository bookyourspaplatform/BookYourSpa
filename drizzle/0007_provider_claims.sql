CREATE TABLE "provider_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_claims" ADD CONSTRAINT "provider_claims_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_claims" ADD CONSTRAINT "provider_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_claims" ADD CONSTRAINT "provider_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_claims_provider_idx" ON "provider_claims" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "provider_claims_status_idx" ON "provider_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_claims_email_idx" ON "provider_claims" USING btree ("email");