import { ZodError, type z } from "zod";
import { db } from "../db/index.js";
import { activity } from "../db/schema.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

export async function logActivity(userId: number, type: string, message: string) {
  await db.insert(activity).values({ userId, type, message });
}

/** Wraps a handler so validation and HTTP errors become clean JSON responses. */
export function handle<C>(fn: (req: Request, context: C) => Promise<Response>) {
  return async (req: Request, context: C) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof ZodError) {
        const fields: Record<string, string> = {};
        for (const issue of err.issues) fields[issue.path.join(".") || "body"] ??= issue.message;
        return json({ error: "Validation failed", fields }, 422);
      }
      if (err instanceof HttpError) return json({ error: err.message, details: err.details }, err.status);
      console.error(err);
      return json({ error: "Internal server error" }, 500);
    }
  };
}
