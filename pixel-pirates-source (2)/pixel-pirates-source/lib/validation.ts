import { z } from "zod";
import { HANDLE_RE, isValidDomain, normalizeDomain, normalizeHandle } from "./normalize.js";

const trimmed = (label: string, max = 120) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const domainField = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform(normalizeDomain)
    .refine((d) => d.length > 0, `${label} is required`)
    .refine(isValidDomain, "Enter a valid domain, e.g. example.com");

const handleField = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform(normalizeHandle)
    .refine((h) => h.length > 0, `${label} is required`)
    .refine((h) => HANDLE_RE.test(h), "Handles may contain letters, numbers, dots, dashes and underscores");

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v ?? undefined), schema.optional());

export const brandInput = z.object({
  name: trimmed("Brand name", 80),
  domain: domainField("Official domain"),
  socialHandle: handleField("Official social handle"),
  appPublisher: trimmed("Official app publisher", 120),
  contactEmail: optional(z.string().trim().email("Enter a valid email address").max(160)),
});

export const PLATFORMS = ["instagram", "x", "facebook", "linkedin", "tiktok", "youtube", "telegram", "app_store", "play_store", "website", "other"] as const;

export const scanInput = z
  .object({
    brandId: z.coerce.number({ error: "Select a brand" }).int().positive("Select a brand"),
    candidateName: trimmed("Candidate name", 160),
    candidateDomain: optional(domainField("Domain")),
    candidateHandle: optional(handleField("Handle")),
    candidatePlatform: optional(z.enum(PLATFORMS)),
    candidateAppPublisher: optional(z.string().trim().max(160)),
    candidateDescription: optional(z.string().trim().max(2000)),
  });

export const INVESTIGATION_STATUSES = ["open", "in_progress", "takedown_requested", "resolved", "dismissed"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const investigationCreate = z.object({
  scanId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  title: optional(z.string().trim().min(3).max(200)),
  priority: optional(z.enum(PRIORITIES)),
  notes: optional(z.string().trim().max(5000)),
});

export const investigationUpdate = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    status: z.enum(INVESTIGATION_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    notes: z.string().trim().max(5000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
