import type { Config } from "@netlify/functions";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { activity, brands, investigations, scans } from "../../db/schema.js";
import { handle, json } from "../../lib/http.js";
import { requireUser } from "../../lib/auth.js";

export default handle(async (req: Request) => {
  const user = await requireUser(req);
  const ownedBrandIds = db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id));
  const url = new URL(req.url);

  if (url.pathname.endsWith("/activity")) {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
    return json(await db.select().from(activity).where(eq(activity.userId, user.id)).orderBy(desc(activity.createdAt)).limit(limit));
  }

  const [[brandCount], [scanTotals], [openInv], distribution, recentScans, recentActivity, daily, topBrands] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(brands).where(eq(brands.userId, user.id)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        suspicious: sql<number>`count(*) filter (where ${scans.riskLevel} <> 'low')::int`,
        highRisk: sql<number>`count(*) filter (where ${scans.riskLevel} in ('high','critical'))::int`,
        avgScore: sql<number>`coalesce(round(avg(${scans.riskScore})), 0)::int`,
      })
      .from(scans)
      .where(inArray(scans.brandId, ownedBrandIds)),
    db.select({ n: sql<number>`count(*)::int` }).from(investigations)
      .where(and(inArray(investigations.brandId, ownedBrandIds), sql`${investigations.status} in ('open','in_progress','takedown_requested')`)),
    db.select({ level: scans.riskLevel, n: sql<number>`count(*)::int` }).from(scans)
      .where(inArray(scans.brandId, ownedBrandIds)).groupBy(scans.riskLevel),
    db
      .select({
        id: scans.id,
        brandName: brands.name,
        candidateName: scans.candidateName,
        candidateDomain: scans.candidateDomain,
        candidateHandle: scans.candidateHandle,
        candidatePlatform: scans.candidatePlatform,
        riskScore: scans.riskScore,
        riskLevel: scans.riskLevel,
        createdAt: scans.createdAt,
        investigationStatus: investigations.status,
      })
      .from(scans)
      .innerJoin(brands, eq(scans.brandId, brands.id))
      .leftJoin(investigations, eq(investigations.scanId, scans.id))
      .where(eq(brands.userId, user.id))
      .orderBy(desc(scans.createdAt))
      .limit(8),
    db.select().from(activity).where(eq(activity.userId, user.id)).orderBy(desc(activity.createdAt)).limit(8),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${scans.createdAt}), 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
        threats: sql<number>`count(*) filter (where ${scans.riskLevel} in ('high','critical'))::int`,
      })
      .from(scans)
      .where(and(inArray(scans.brandId, ownedBrandIds), sql`${scans.createdAt} >= now() - interval '13 days'`))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        name: brands.name,
        threats: sql<number>`count(${scans.id}) filter (where ${scans.riskLevel} in ('high','critical'))::int`,
        total: sql<number>`count(${scans.id})::int`,
      })
      .from(brands)
      .leftJoin(scans, eq(scans.brandId, brands.id))
      .where(eq(brands.userId, user.id))
      .groupBy(brands.id)
      .orderBy(sql`2 desc`, sql`3 desc`)
      .limit(5),
  ]);

  const dist = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
  for (const d of distribution) dist[d.level] = d.n;

  return json({
    totals: {
      brands: brandCount.n,
      scans: scanTotals.total,
      suspicious: scanTotals.suspicious,
      highRisk: scanTotals.highRisk,
      openInvestigations: openInv.n,
      avgScore: scanTotals.avgScore,
    },
    distribution: dist,
    daily,
    topBrands,
    recentScans,
    recentActivity,
  });
});

export const config: Config = { path: ["/api/stats", "/api/activity"] };
