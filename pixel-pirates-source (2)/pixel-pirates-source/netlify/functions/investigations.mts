import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { brands, investigations, scans } from "../../db/schema.js";
import { HttpError, handle, json, logActivity, parseBody, parseId } from "../../lib/http.js";
import { investigationCreate, investigationUpdate } from "../../lib/validation.js";
import { requireUser } from "../../lib/auth.js";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  takedown_requested: "Takedown requested",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const columns = {
  id: investigations.id,
  scanId: investigations.scanId,
  brandId: investigations.brandId,
  brandName: brands.name,
  title: investigations.title,
  status: investigations.status,
  priority: investigations.priority,
  notes: investigations.notes,
  createdAt: investigations.createdAt,
  updatedAt: investigations.updatedAt,
  candidateName: scans.candidateName,
  candidateDomain: scans.candidateDomain,
  candidateHandle: scans.candidateHandle,
  riskScore: scans.riskScore,
  riskLevel: scans.riskLevel,
  verdict: scans.verdict,
};

const priorityFor = (level?: string) => (level === "critical" ? "critical" : level === "high" ? "high" : level === "medium" ? "medium" : "low");

export default handle(async (req: Request, context: Context) => {
  const user = await requireUser(req);
  const ownedBrandIds = db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id));
  const id = context.params.id ? parseId(context.params.id) : undefined;

  if (req.method === "GET") {
    const query = db
      .select(columns)
      .from(investigations)
      .leftJoin(brands, eq(investigations.brandId, brands.id))
      .leftJoin(scans, eq(investigations.scanId, scans.id));
    if (id) {
      const [row] = await query.where(and(eq(investigations.id, id), inArray(investigations.brandId, ownedBrandIds)));
      if (!row) throw new HttpError(404, "Investigation not found");
      return json(row);
    }
    return json(await query.where(inArray(investigations.brandId, ownedBrandIds)).orderBy(desc(investigations.updatedAt)));
  }

  if (req.method === "POST" && !id) {
    const input = await parseBody(req, investigationCreate);
    let brandId = input.brandId;
    let title = input.title;
    let priority = input.priority;

    if (input.scanId) {
      const [scan] = await db.select().from(scans).where(and(eq(scans.id, input.scanId), inArray(scans.brandId, ownedBrandIds)));
      if (!scan) throw new HttpError(404, "Scan not found");
      const [existing] = await db.select({ id: investigations.id }).from(investigations)
        .where(and(eq(investigations.scanId, input.scanId), inArray(investigations.brandId, ownedBrandIds)));
      if (existing) throw new HttpError(409, "An investigation is already open for this scan", { investigationId: existing.id });
      brandId = scan.brandId;
      title ??= `Impersonation review: ${scan.candidateName}`;
      priority ??= priorityFor(scan.riskLevel);
    }
    if (!brandId) throw new HttpError(422, "Select a brand or scan to investigate", { fields: { brandId: "Select a brand" } });
    const [brand] = await db.select({ id: brands.id }).from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)));
    if (!brand) throw new HttpError(404, "Brand not found");
    if (!title) throw new HttpError(422, "Title is required", { fields: { title: "Title is required" } });

    const [row] = await db
      .insert(investigations)
      .values({ scanId: input.scanId ?? null, brandId, title, priority: priority ?? "medium", notes: input.notes ?? "" })
      .returning();
    await logActivity(user.id, "investigation_opened", `Opened investigation #${row.id}: ${row.title}`);
    return json(row, 201);
  }

  if (req.method === "PATCH" && id) {
    const input = await parseBody(req, investigationUpdate);
    const [before] = await db.select().from(investigations)
      .where(and(eq(investigations.id, id), inArray(investigations.brandId, ownedBrandIds)));
    if (!before) throw new HttpError(404, "Investigation not found");
    const [row] = await db.update(investigations).set({ ...input, updatedAt: new Date() })
      .where(and(eq(investigations.id, id), inArray(investigations.brandId, ownedBrandIds))).returning();
    if (input.status && input.status !== before.status) {
      await logActivity(
        user.id,
        input.status === "resolved" || input.status === "dismissed" ? "investigation_closed" : "investigation_updated",
        `Investigation #${id} moved to ${STATUS_LABEL[input.status]}`,
      );
    } else {
      await logActivity(user.id, "investigation_updated", `Updated investigation #${id}`);
    }
    return json(row);
  }

  if (req.method === "DELETE" && id) {
    const [row] = await db.delete(investigations)
      .where(and(eq(investigations.id, id), inArray(investigations.brandId, ownedBrandIds))).returning();
    if (!row) throw new HttpError(404, "Investigation not found");
    await logActivity(user.id, "investigation_deleted", `Deleted investigation #${id}`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
});

export const config: Config = { path: ["/api/investigations", "/api/investigations/:id"] };
