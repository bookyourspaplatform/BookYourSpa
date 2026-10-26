CREATE TABLE "provider_promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"promotion_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "discount_type" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "discount_value" integer;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "min_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "max_uses" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "treatment_ids" jsonb;--> statement-breakpoint
ALTER TABLE "provider_promotions" ADD CONSTRAINT "provider_promotions_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_promotions" ADD CONSTRAINT "provider_promotions_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_promotions_unique" ON "provider_promotions" USING btree ("provider_id","promotion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_code_unique" ON "promotions" USING btree ("code");