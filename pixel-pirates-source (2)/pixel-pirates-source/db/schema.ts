import { pgTable, serial, text, timestamp, integer, jsonb, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial().primaryKey(),
  fullName: text("full_name").notNull(),
  email: text().notNull().unique(),
  backupEmail: text("backup_email"),
  backupEmailVerifiedAt: timestamp("backup_email_verified_at", { withTimezone: true }),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailUpdates: boolean("email_updates").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const authCodes = pgTable("auth_codes", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text().notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer().notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("auth_codes_user_purpose_idx").on(t.userId, t.purpose, t.createdAt)]);

export const passwordResetGrants = pgTable("password_reset_grants", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text().primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer().notNull().default(0),
});

export const brands = pgTable("brands", {
  id: serial().primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text().notNull(),
  domain: text().notNull(),
  socialHandle: text("social_handle").notNull(),
  appPublisher: text("app_publisher").notNull(),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("brands_user_name_idx").on(t.userId, sql`lower(${t.name})`),
  uniqueIndex("brands_user_domain_idx").on(t.userId, t.domain),
]);

export const scans = pgTable(
  "scans",
  {
    id: serial().primaryKey(),
    brandId: integer("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    candidateName: text("candidate_name").notNull(),
    candidateDomain: text("candidate_domain"),
    candidateHandle: text("candidate_handle"),
    candidatePlatform: text("candidate_platform"),
    candidateAppPublisher: text("candidate_app_publisher"),
    candidateDescription: text("candidate_description"),
    riskScore: integer("risk_score").notNull(),
    riskLevel: text("risk_level").notNull(),
    verdict: text().notNull(),
    signals: jsonb().notNull().$type<{ label: string; detail: string; weight: number; category: string }[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("scans_brand_idx").on(t.brandId), index("scans_created_idx").on(t.createdAt)],
);

export const investigations = pgTable("investigations", {
  id: serial().primaryKey(),
  scanId: integer("scan_id").references(() => scans.id, { onDelete: "set null" }),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  title: text().notNull(),
  status: text().notNull().default("open"),
  priority: text().notNull().default("medium"),
  notes: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const activity = pgTable("activity", {
  id: serial().primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text().notNull(),
  message: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
