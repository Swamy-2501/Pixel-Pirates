import { z } from "zod";

const email = (label: string) => z.string({ error: `${label} is required` }).trim().email("Enter a valid email address").max(254).transform((value) => value.toLowerCase());
const password = z.string().min(12, "Use at least 12 characters").max(128, "Password must be 128 characters or fewer");
const optionalEmail = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), email("Backup email").optional());

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your full name").max(120, "Name must be 120 characters or fewer"),
  email: email("Email"),
  backupEmail: optionalEmail,
  password,
  confirmPassword: z.string(),
  emailUpdates: z.boolean().default(false),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
  .refine((value) => !value.backupEmail || value.backupEmail !== value.email, { path: ["backupEmail"], message: "Use a different email address" });

export const signInSchema = z.object({
  email: email("Email"),
  password: z.string().min(1, "Enter your password").max(128),
});

export const emailSchema = z.object({ email: email("Email") });

export const codeSchema = z.object({
  email: email("Email"),
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code"),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(32),
  password,
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });
