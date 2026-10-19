CREATE TABLE "agent_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"treatment_id" text NOT NULL,
	"net_price" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_name" text NOT NULL,
	"slug" text NOT NULL,
	"agent_type" text DEFAULT 'travel_agent' NOT NULL,
	"country" text DEFAULT 'ID' NOT NULL,
	"website" text,
	"phone" text,
	"commission_bps" integer DEFAULT 1000 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"referral_code" text NOT NULL,
	"payout_details" jsonb DEFAULT '{}'::jsonb,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "agents_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agents_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"provider_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"treatment_id" text NOT NULL,
	"therapist_id" text,
	"customer_id" text,
	"agent_id" text,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"guest_phone" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Asia/Makassar' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"channel" text DEFAULT 'direct' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"list_price" integer DEFAULT 0 NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"platform_fee" integer DEFAULT 0 NOT NULL,
	"agent_commission" integer DEFAULT 0 NOT NULL,
	"provider_earning" integer DEFAULT 0 NOT NULL,
	"coupon_code" text,
	"expires_at" timestamp with time zone,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "branch_treatments" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"treatment_id" text NOT NULL,
	"price" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"region" text,
	"country" text DEFAULT 'ID' NOT NULL,
	"timezone" text DEFAULT 'Asia/Makassar' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"phone" text,
	"email" text,
	"lat" text,
	"lng" text,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_time_minutes" integer DEFAULT 60 NOT NULL,
	"max_advance_days" integer DEFAULT 90 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"slot_interval_minutes" integer DEFAULT 30 NOT NULL,
	"online_payment_enabled" boolean DEFAULT true NOT NULL,
	"payment_methods" text[] DEFAULT '{stripe,paypal,razorpay,venue}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"party" text NOT NULL,
	"provider_id" text,
	"agent_id" text,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'global' NOT NULL,
	"provider_id" text,
	"branch_id" text,
	"treatment_id" text,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_value" integer NOT NULL,
	"currency" text,
	"min_amount" integer DEFAULT 0 NOT NULL,
	"max_uses" integer DEFAULT 0,
	"used_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"template" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"booking_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"gateway" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"external_id" text,
	"client_secret" text,
	"payer_email" text,
	"gateway_data" jsonb DEFAULT '{}'::jsonb,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"party" text NOT NULL,
	"provider_id" text,
	"agent_id" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"notes" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"image_url" text,
	"link_url" text,
	"position" text DEFAULT 'banner' NOT NULL,
	"provider_id" text,
	"branch_id" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tagline" text,
	"description" text,
	"logo_url" text,
	"cover_url" text,
	"website" text,
	"phone" text,
	"email" text,
	"country" text DEFAULT 'ID' NOT NULL,
	"base_currency" text DEFAULT 'IDR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"commission_bps" integer,
	"featured" boolean DEFAULT false NOT NULL,
	"featured_until" timestamp with time zone,
	"payout_method" text,
	"payout_details" jsonb DEFAULT '{}'::jsonb,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"therapist_id" text,
	"branch_id" text NOT NULL,
	"date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"kind" text DEFAULT 'closed' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "therapist_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"therapist_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "therapists" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"avatar_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text DEFAULT 'massage' NOT NULL,
	"description" text,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"list_price" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"image_url" text,
	"benefits" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"requires_therapist" boolean DEFAULT true NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"agent_approved" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'customer' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"locale" text DEFAULT 'en',
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_rates" ADD CONSTRAINT "agent_rates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_rates" ADD CONSTRAINT "agent_rates_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_therapist_id_therapists_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."therapists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_treatments" ADD CONSTRAINT "branch_treatments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_treatments" ADD CONSTRAINT "branch_treatments_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_therapist_id_therapists_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."therapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapist_schedules" ADD CONSTRAINT "therapist_schedules_therapist_id_therapists_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."therapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapists" ADD CONSTRAINT "therapists_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_rates_uq" ON "agent_rates" USING btree ("agent_id","treatment_id");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "bookings_branch_start_idx" ON "bookings" USING btree ("branch_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_provider_start_idx" ON "bookings" USING btree ("provider_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bookings_agent_idx" ON "bookings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_email_idx" ON "bookings" USING btree ("guest_email");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_therapist_slot_uq" ON "bookings" USING btree ("therapist_id","start_at") WHERE therapist_id IS NOT NULL AND status IN ('pending','confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "branch_treatments_uq" ON "branch_treatments" USING btree ("branch_id","treatment_id");--> statement-breakpoint
CREATE INDEX "branch_treatments_treatment_idx" ON "branch_treatments" USING btree ("treatment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_provider_slug_uq" ON "branches" USING btree ("provider_id","slug");--> statement-breakpoint
CREATE INDEX "branches_city_idx" ON "branches" USING btree ("city");--> statement-breakpoint
CREATE INDEX "branches_status_idx" ON "branches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commissions_booking_idx" ON "commissions" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "commissions_agent_idx" ON "commissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "commissions_provider_idx" ON "commissions" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "commissions_status_idx" ON "commissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "coupons_active_idx" ON "coupons" USING btree ("active");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external_uq" ON "payments" USING btree ("gateway","external_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_party_idx" ON "payouts" USING btree ("party","provider_id","agent_id");--> statement-breakpoint
CREATE INDEX "promotions_position_idx" ON "promotions" USING btree ("position","active");--> statement-breakpoint
CREATE INDEX "providers_status_idx" ON "providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "exceptions_branch_date_idx" ON "schedule_exceptions" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "exceptions_therapist_date_idx" ON "schedule_exceptions" USING btree ("therapist_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_uq" ON "therapist_schedules" USING btree ("therapist_id","weekday","start_time");--> statement-breakpoint
CREATE INDEX "schedules_therapist_idx" ON "therapist_schedules" USING btree ("therapist_id");--> statement-breakpoint
CREATE INDEX "therapists_branch_idx" ON "therapists" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "treatments_provider_idx" ON "treatments" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "treatments_category_idx" ON "treatments" USING btree ("category");--> statement-breakpoint
CREATE INDEX "treatments_status_idx" ON "treatments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");