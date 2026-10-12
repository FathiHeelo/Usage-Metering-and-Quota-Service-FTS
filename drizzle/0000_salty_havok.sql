CREATE TYPE "public"."quota_scope" AS ENUM('ACCOUNT', 'USER');--> statement-breakpoint
CREATE TYPE "public"."rejection_rule" AS ENUM('MONTHLY_ALLOWANCE', 'MAX_UNITS_PER_REQUEST');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "account_monthly_usage" (
	"account_id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_monthly_usage_account_id_month_start_pk" PRIMARY KEY("account_id","month_start"),
	CONSTRAINT "account_monthly_usage_used_units_nonnegative" CHECK ("account_monthly_usage"."used_units" >= 0),
	CONSTRAINT "account_monthly_usage_month_start_first_day" CHECK (extract(day from "account_monthly_usage"."month_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"current_plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"key_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" uuid,
	"name" text NOT NULL,
	"scope" "quota_scope" NOT NULL,
	"monthly_allowance" bigint NOT NULL,
	"max_units_per_request" bigint NOT NULL,
	"is_predefined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_monthly_allowance_nonnegative" CHECK ("plans"."monthly_allowance" >= 0),
	CONSTRAINT "plans_max_units_per_request_nonnegative" CHECK ("plans"."max_units_per_request" >= 0),
	CONSTRAINT "plans_owner_matches_type" CHECK (("plans"."is_predefined" AND "plans"."owner_account_id" IS NULL) OR (NOT "plans"."is_predefined" AND "plans"."owner_account_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "usage_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"units" bigint NOT NULL,
	"status" "usage_status" NOT NULL,
	"rejection_scope" "quota_scope",
	"rejection_rule" "rejection_rule",
	"month_start" date NOT NULL,
	"account_plan_id" uuid NOT NULL,
	"user_plan_id" uuid NOT NULL,
	"account_monthly_limit" bigint NOT NULL,
	"account_request_limit" bigint NOT NULL,
	"user_monthly_limit" bigint NOT NULL,
	"user_request_limit" bigint NOT NULL,
	"account_used_after" bigint NOT NULL,
	"account_remaining_after" bigint NOT NULL,
	"user_used_after" bigint NOT NULL,
	"user_remaining_after" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_requests_account_request_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "usage_requests_units_positive" CHECK ("usage_requests"."units" > 0),
	CONSTRAINT "usage_requests_snapshots_nonnegative" CHECK ("usage_requests"."account_monthly_limit" >= 0 AND "usage_requests"."account_request_limit" >= 0 AND "usage_requests"."user_monthly_limit" >= 0 AND "usage_requests"."user_request_limit" >= 0 AND "usage_requests"."account_used_after" >= 0 AND "usage_requests"."account_remaining_after" >= 0 AND "usage_requests"."user_used_after" >= 0 AND "usage_requests"."user_remaining_after" >= 0),
	CONSTRAINT "usage_requests_rejection_consistency" CHECK (("usage_requests"."status" = 'ACCEPTED' AND "usage_requests"."rejection_scope" IS NULL AND "usage_requests"."rejection_rule" IS NULL) OR ("usage_requests"."status" = 'REJECTED' AND "usage_requests"."rejection_scope" IS NOT NULL AND "usage_requests"."rejection_rule" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_monthly_usage" (
	"user_id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_monthly_usage_user_id_month_start_pk" PRIMARY KEY("user_id","month_start"),
	CONSTRAINT "user_monthly_usage_used_units_nonnegative" CHECK ("user_monthly_usage"."used_units" >= 0),
	CONSTRAINT "user_monthly_usage_month_start_first_day" CHECK (extract(day from "user_monthly_usage"."month_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_user_id" text NOT NULL,
	"current_plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_external_user_unique" UNIQUE("account_id","external_user_id"),
	CONSTRAINT "users_account_id_id_unique" UNIQUE("account_id","id")
);
--> statement-breakpoint
ALTER TABLE "account_monthly_usage" ADD CONSTRAINT "account_monthly_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_current_plan_id_plans_id_fk" FOREIGN KEY ("current_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_account_plan_id_plans_id_fk" FOREIGN KEY ("account_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_user_plan_id_plans_id_fk" FOREIGN KEY ("user_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_account_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_monthly_usage" ADD CONSTRAINT "user_monthly_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_current_plan_id_plans_id_fk" FOREIGN KEY ("current_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_account_id_idx" ON "api_keys" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_predefined_name_scope_unique" ON "plans" USING btree ("name","scope") WHERE "plans"."is_predefined" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_custom_owner_name_scope_unique" ON "plans" USING btree ("owner_account_id","name","scope") WHERE "plans"."is_predefined" = false;--> statement-breakpoint
CREATE INDEX "usage_requests_account_created_at_idx" ON "usage_requests" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_requests_user_created_at_idx" ON "usage_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_requests_account_month_start_idx" ON "usage_requests" USING btree ("account_id","month_start");