import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const quotaScope = pgEnum("quota_scope", ["ACCOUNT", "USER"]);
export const usageStatus = pgEnum("usage_status", ["ACCEPTED", "REJECTED"]);
export const rejectionRule = pgEnum("rejection_rule", [
  "MONTHLY_ALLOWANCE",
  "MAX_UNITS_PER_REQUEST",
]);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerAccountId: uuid("owner_account_id").references(
      (): AnyPgColumn => accounts.id,
    ),
    name: text("name").notNull(),
    scope: quotaScope("scope").notNull(),
    monthlyAllowance: bigint("monthly_allowance", { mode: "bigint" }).notNull(),
    maxUnitsPerRequest: bigint("max_units_per_request", {
      mode: "bigint",
    }).notNull(),
    isPredefined: boolean("is_predefined").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("plans_monthly_allowance_nonnegative", sql`${table.monthlyAllowance} >= 0`),
    check(
      "plans_max_units_per_request_nonnegative",
      sql`${table.maxUnitsPerRequest} >= 0`,
    ),
    check(
      "plans_owner_matches_type",
      sql`(${table.isPredefined} AND ${table.ownerAccountId} IS NULL) OR (NOT ${table.isPredefined} AND ${table.ownerAccountId} IS NOT NULL)`,
    ),
    uniqueIndex("plans_predefined_name_scope_unique")
      .on(table.name, table.scope)
      .where(sql`${table.isPredefined} = true`),
    uniqueIndex("plans_custom_owner_name_scope_unique")
      .on(table.ownerAccountId, table.name, table.scope)
      .where(sql`${table.isPredefined} = false`),
  ],
);

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  currentPlanId: uuid("current_plan_id")
    .notNull()
    .references(() => plans.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    keyHash: char("key_hash", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_account_id_idx").on(table.accountId),
    index("api_keys_key_prefix_idx").on(table.keyPrefix),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    externalUserId: text("external_user_id").notNull(),
    currentPlanId: uuid("current_plan_id")
      .notNull()
      .references(() => plans.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("users_account_external_user_unique").on(
      table.accountId,
      table.externalUserId,
    ),
    unique("users_account_id_id_unique").on(table.accountId, table.id),
  ],
);

export const accountMonthlyUsage = pgTable(
  "account_monthly_usage",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    monthStart: date("month_start", { mode: "string" }).notNull(),
    usedUnits: bigint("used_units", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.monthStart] }),
    check("account_monthly_usage_used_units_nonnegative", sql`${table.usedUnits} >= 0`),
    check(
      "account_monthly_usage_month_start_first_day",
      sql`extract(day from ${table.monthStart}) = 1`,
    ),
  ],
);

export const userMonthlyUsage = pgTable(
  "user_monthly_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    monthStart: date("month_start", { mode: "string" }).notNull(),
    usedUnits: bigint("used_units", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.monthStart] }),
    check("user_monthly_usage_used_units_nonnegative", sql`${table.usedUnits} >= 0`),
    check(
      "user_monthly_usage_month_start_first_day",
      sql`extract(day from ${table.monthStart}) = 1`,
    ),
  ],
);

export const usageRequests = pgTable(
  "usage_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    userId: uuid("user_id").notNull(),
    requestId: text("request_id").notNull(),
    units: bigint("units", { mode: "bigint" }).notNull(),
    status: usageStatus("status").notNull(),
    rejectionScope: quotaScope("rejection_scope"),
    rejectionRule: rejectionRule("rejection_rule"),
    monthStart: date("month_start", { mode: "string" }).notNull(),
    accountPlanId: uuid("account_plan_id")
      .notNull()
      .references(() => plans.id),
    userPlanId: uuid("user_plan_id")
      .notNull()
      .references(() => plans.id),
    accountMonthlyLimit: bigint("account_monthly_limit", { mode: "bigint" }).notNull(),
    accountRequestLimit: bigint("account_request_limit", { mode: "bigint" }).notNull(),
    userMonthlyLimit: bigint("user_monthly_limit", { mode: "bigint" }).notNull(),
    userRequestLimit: bigint("user_request_limit", { mode: "bigint" }).notNull(),
    accountUsedAfter: bigint("account_used_after", { mode: "bigint" }).notNull(),
    accountRemainingAfter: bigint("account_remaining_after", { mode: "bigint" }).notNull(),
    userUsedAfter: bigint("user_used_after", { mode: "bigint" }).notNull(),
    userRemainingAfter: bigint("user_remaining_after", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("usage_requests_account_request_unique").on(
      table.accountId,
      table.requestId,
    ),
    foreignKey({
      columns: [table.accountId, table.userId],
      foreignColumns: [users.accountId, users.id],
      name: "usage_requests_account_user_fk",
    }),
    check("usage_requests_units_positive", sql`${table.units} > 0`),
    check(
      "usage_requests_snapshots_nonnegative",
      sql`${table.accountMonthlyLimit} >= 0 AND ${table.accountRequestLimit} >= 0 AND ${table.userMonthlyLimit} >= 0 AND ${table.userRequestLimit} >= 0 AND ${table.accountUsedAfter} >= 0 AND ${table.accountRemainingAfter} >= 0 AND ${table.userUsedAfter} >= 0 AND ${table.userRemainingAfter} >= 0`,
    ),
    check(
      "usage_requests_rejection_consistency",
      sql`(${table.status} = 'ACCEPTED' AND ${table.rejectionScope} IS NULL AND ${table.rejectionRule} IS NULL) OR (${table.status} = 'REJECTED' AND ${table.rejectionScope} IS NOT NULL AND ${table.rejectionRule} IS NOT NULL)`,
    ),
    index("usage_requests_account_created_at_idx").on(
      table.accountId,
      table.createdAt,
    ),
    index("usage_requests_user_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("usage_requests_account_month_start_idx").on(
      table.accountId,
      table.monthStart,
    ),
  ],
);
