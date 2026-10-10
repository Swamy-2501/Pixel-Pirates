import type { Config } from "@netlify/functions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { brands, investigations, scans } from "../../db/schema.js";
import { handle, json, logActivity } from "../../lib/http.js";
import { assessRisk, type Candidate } from "../../lib/risk.js";
import { requireUser } from "../../lib/auth.js";

// Fictional brands and candidates so a fresh install can be demonstrated in one click.
const DEMO_BRANDS = [
  { name: "PayNova", domain: "paynova.com", socialHandle: "paynova", appPublisher: "PayNova Technologies Pvt Ltd", contactEmail: "security@paynova.com" },
  { name: "SkyCart", domain: "skycart.in", socialHandle: "skycart_in", appPublisher: "SkyCart Retail Ltd", contactEmail: "trust@skycart.in" },
  { name: "Orbit Bank", domain: "orbitbank.co.in", socialHandle: "orbitbank", appPublisher: "Orbit Bank Limited", contactEmail: null },
];

const DEMO_CANDIDATES: Record<string, (Candidate & { investigate?: boolean })[]> = {
  PayNova: [
    { candidateName: "PayNova Support", candidateDomain: "paynova-support-login.xyz", candidateHandle: "paynova_support_official", candidatePlatform: "instagram", candidateDescription: "Your account is suspended! DM us on WhatsApp with your OTP within 24 hours to restore access.", investigate: true },
    { candidateName: "PayN0va Wallet", candidatePlatform: "play_store", candidateAppPublisher: "PayNova Tech Labs", candidateDescription: "Download the APK here for instant cashback." },
    { candidateName: "PayNova", candidateDomain: "paynova.com", candidateHandle: "paynova", candidatePlatform: "website" },
    { candidateName: "Paynuva", candidateDomain: "paynuva.com", candidatePlatform: "website" },
  ],
  SkyCart: [
    { candidateName: "SkyCart Mega Giveaway", candidateHandle: "skycart.giveaway2026", candidatePlatform: "facebook", candidateDescription: "Win a free iPhone! Pay ₹99 via UPI to claim your prize. Limited time — act now: https://bit.ly/sky-win", investigate: true },
    { candidateName: "Skycart India", candidateDomain: "skycart.shop", candidateHandle: "skycartindia", candidatePlatform: "website" },
    { candidateName: "Sky Kart Deals", candidateHandle: "skykartdeals", candidatePlatform: "telegram", candidateDescription: "Daily deals channel. Join for coupons." },
  ],
  "Orbit Bank": [
    { candidateName: "Orbit Bank Customer Care", candidateDomain: "orbitbank.co.in.secure-verify.top", candidateHandle: "orbitbank_care", candidatePlatform: "x", candidateDescription: "Toll-free helpline for refunds. Confirm your details and share your card CVV to process.", investigate: true },
    { candidateName: "0rbit Bank", candidateDomain: "0rbitbank.com", candidatePlatform: "website" },
    { candidateName: "Orbit Fitness Studio", candidateHandle: "orbitfitness", candidatePlatform: "instagram", candidateDescription: "Yoga and strength classes in Pune." },
  ],
};

export default handle(async (req: Request) => {
  const user = await requireUser(req);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const existing = await db.select({ name: brands.name }).from(brands)
    .where(and(eq(brands.userId, user.id), inArray(sql`lower(${brands.name})`, DEMO_BRANDS.map((b) => b.name.toLowerCase()))));
  const taken = new Set(existing.map((e) => e.name.toLowerCase()));
  const toInsert = DEMO_BRANDS.filter((b) => !taken.has(b.name.toLowerCase()));
  if (!toInsert.length) return json({ created: 0, message: "Demo data is already loaded" });

  const inserted = await db.insert(brands).values(toInsert.map((brand) => ({ ...brand, userId: user.id }))).returning();
  let scanCount = 0;
  for (const brand of inserted) {
    for (const { investigate, ...candidate } of DEMO_CANDIDATES[brand.name] ?? []) {
      const result = assessRisk(brand, candidate);
      const [scan] = await db
        .insert(scans)
        .values({
          brandId: brand.id,
          candidateName: candidate.candidateName,
          candidateDomain: candidate.candidateDomain ?? null,
          candidateHandle: candidate.candidateHandle ?? null,
          candidatePlatform: candidate.candidatePlatform ?? null,
          candidateAppPublisher: candidate.candidateAppPublisher ?? null,
          candidateDescription: candidate.candidateDescription ?? null,
          ...result,
        })
        .returning();
      scanCount++;
      if (investigate) {
        await db.insert(investigations).values({
          scanId: scan.id,
          brandId: brand.id,
          title: `Impersonation review: ${scan.candidateName}`,
          priority: result.riskLevel === "critical" ? "critical" : "high",
          notes: "Auto-opened from demo dataset. Collect screenshots, then file a platform takedown request.",
        });
      }
    }
  }
  await logActivity(user.id, "demo_loaded", `Loaded demo dataset: ${inserted.length} brands, ${scanCount} scans`);
  return json({ created: inserted.length, scans: scanCount }, 201);
});

export const config: Config = { path: "/api/demo" };
