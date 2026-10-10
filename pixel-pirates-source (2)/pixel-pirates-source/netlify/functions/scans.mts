import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { brands, investigations, scans } from "../../db/schema.js";
import { HttpError, handle, json, logActivity, parseBody, parseId } from "../../lib/http.js";
import { assessRisk } from "../../lib/risk.js";
import { scanInput } from "../../lib/validation.js";
import { requireUser } from "../../lib/auth.js";

const LEVELS = ["low", "medium", "high", "critical"];

const scanColumns = {
  id: scans.id,
  brandId: scans.brandId,
  brandName: brands.name,
  candidateName: scans.candidateName,
  candidateDomain: scans.candidateDomain,
  candidateHandle: scans.candidateHandle,
  candidatePlatform: scans.candidatePlatform,
  candidateAppPublisher: scans.candidateAppPublisher,
  candidateDescription: scans.candidateDescription,
  riskScore: scans.riskScore,
  riskLevel: scans.riskLevel,
  verdict: scans.verdict,
  signals: scans.signals,
  createdAt: scans.createdAt,
  investigationId: investigations.id,
  investigationStatus: investigations.status,
};

const baseQuery = () =>
  db.select(scanColumns).from(scans).innerJoin(brands, eq(scans.brandId, brands.id)).leftJoin(investigations, eq(investigations.scanId, scans.id));

export default handle(async (req: Request, context: Context) => {
  const user = await requireUser(req);
  const id = context.params.id ? parseId(context.params.id) : undefined;

  if (req.method === "GET") {
    if (id) {
      const [scan] = await baseQuery().where(and(eq(scans.id, id), eq(brands.userId, user.id)));
      if (!scan) throw new HttpError(404, "Scan not found");
      return json(scan);
    }
    const params = new URL(req.url).searchParams;
    const q = params.get("q")?.trim();
    const brandId = Number(params.get("brandId")) || undefined;
    const levels = (params.get("level") ?? "").split(",").filter((l) => LEVELS.includes(l));
    const limit = Math.min(Number(params.get("limit")) || 100, 500);
    const rows = await baseQuery()
      .where(
        and(
          eq(brands.userId, user.id),
          brandId ? eq(scans.brandId, brandId) : undefined,
          levels.length ? inArray(scans.riskLevel, levels) : undefined,
          q ? or(ilike(scans.candidateName, `%${q}%`), ilike(scans.candidateDomain, `%${q}%`), ilike(scans.candidateHandle, `%${q}%`), ilike(brands.name, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(desc(scans.createdAt))
      .limit(limit);
    return json(rows);
  }

  if (req.method === "POST" && !id) {
    const input = await parseBody(req, scanInput);
    if (!input.candidateDomain && !input.candidateHandle && !input.candidateAppPublisher && !input.candidateDescription) {
      throw new HttpError(422, "Add at least one of: domain, social handle, app publisher or description", {
        fields: { candidateHandle: "Provide a domain, handle, app publisher or description to analyse" },
      });
    }
    const [brand] = await db.select().from(brands).where(and(eq(brands.id, input.brandId), eq(brands.userId, user.id)));
    if (!brand) throw new HttpError(404, "Selected brand no longer exists", { fields: { brandId: "Select a registered brand" } });

    const result = assessRisk(brand, input);
    const [scan] = await db
      .insert(scans)
      .values({
        brandId: brand.id,
        candidateName: input.candidateName,
        candidateDomain: input.candidateDomain ?? null,
        candidateHandle: input.candidateHandle ?? null,
        candidatePlatform: input.candidatePlatform ?? null,
        candidateAppPublisher: input.candidateAppPublisher ?? null,
        candidateDescription: input.candidateDescription ?? null,
        ...result,
      })
      .returning();
    await logActivity(
      user.id,
      result.riskLevel === "high" || result.riskLevel === "critical" ? "threat_detected" : "scan_completed",
      `Scanned "${scan.candidateName}" for ${brand.name} — ${result.riskLevel.toUpperCase()} risk (${result.riskScore}/100)`,
    );
    return json({ ...scan, brandName: brand.name, investigationId: null, investigationStatus: null }, 201);
  }

  if (req.method === "DELETE" && id) {
    const ownedBrandIds = db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id));
    const [scan] = await db.delete(scans).where(and(eq(scans.id, id), inArray(scans.brandId, ownedBrandIds))).returning();
    if (!scan) throw new HttpError(404, "Scan not found");
    await logActivity(user.id, "scan_deleted", `Deleted scan of "${scan.candidateName}"`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
});

export const config: Config = { path: ["/api/scans", "/api/scans/:id"] };
