CREATE TABLE "activity" (
	"id" serial PRIMARY KEY,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"domain" text NOT NULL,
	"social_handle" text NOT NULL,
	"app_publisher" text NOT NULL,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" serial PRIMARY KEY,
	"scan_id" integer,
	"brand_id" integer,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" serial PRIMARY KEY,
	"brand_id" integer NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_domain" text,
	"candidate_handle" text,
	"candidate_platform" text,
	"candidate_app_publisher" text,
	"candidate_description" text,
	"risk_score" integer NOT NULL,
	"risk_level" text NOT NULL,
	"verdict" text NOT NULL,
	"signals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scans_brand_idx" ON "scans" ("brand_id");--> statement-breakpoint
CREATE INDEX "scans_created_idx" ON "scans" ("created_at");--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_scan_id_scans_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_brand_id_brands_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_brand_id_brands_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;