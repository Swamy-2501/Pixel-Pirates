import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { brands, scans } from "../../db/schema.js";
import { HttpError, handle, json, logActivity, parseBody, parseId } from "../../lib/http.js";
import { brandInput } from "../../lib/validation.js";
import { requireUser } from "../../lib/auth.js";

const withStats = {
  id: brands.id,
  name: brands.name,
  domain: brands.domain,
  socialHandle: brands.socialHandle,
  appPublisher: brands.appPublisher,
  contactEmail: brands.contactEmail,
  createdAt: brands.createdAt,
  updatedAt: brands.updatedAt,
  scanCount: sql<number>`(select count(*)::int from ${scans} where ${scans.brandId} = ${brands.id})`,
  threatCount: sql<number>`(select count(*)::int from ${scans} where ${scans.brandId} = ${brands.id} and ${scans.riskLevel} in ('high','critical'))`,
};

async function assertUnique(userId: number, name: string, domain: string, exceptId?: number) {
  const conflict = await db
    .select({ id: brands.id, name: brands.name, domain: brands.domain })
    .from(brands)
    .where(and(eq(brands.userId, userId), or(sql`lower(${brands.name}) = lower(${name})`, eq(brands.domain, domain)), exceptId ? ne(brands.id, exceptId) : undefined))
    .limit(1);
  if (conflict.length) {
    const c = conflict[0];
    const field = c.name.toLowerCase() === name.toLowerCase() ? "name" : "domain";
    throw new HttpError(409, field === "name" ? `A brand named "${c.name}" is already registered` : `${domain} is already registered to ${c.name}`, {
      fields: { [field]: field === "name" ? "This brand is already registered" : "This domain is already registered" },
    });
  }
}

export default handle(async (req: Request, context: Context) => {
  const user = await requireUser(req);
  const id = context.params.id ? parseId(context.params.id) : undefined;

  if (req.method === "GET") {
    if (id) {
      const [brand] = await db.select(withStats).from(brands).where(and(eq(brands.id, id), eq(brands.userId, user.id)));
      if (!brand) throw new HttpError(404, "Brand not found");
      return json(brand);
    }
    const q = new URL(req.url).searchParams.get("q")?.trim();
    const filter = q
      ? or(ilike(brands.name, `%${q}%`), ilike(brands.domain, `%${q}%`), ilike(brands.socialHandle, `%${q}%`), ilike(brands.appPublisher, `%${q}%`))
      : undefined;
    return json(await db.select(withStats).from(brands).where(and(eq(brands.userId, user.id), filter)).orderBy(desc(brands.createdAt)));
  }

  if (req.method === "POST" && !id) {
    const input = await parseBody(req, brandInput);
    await assertUnique(user.id, input.name, input.domain);
    const [brand] = await db.insert(brands).values({ ...input, userId: user.id, contactEmail: input.contactEmail ?? null }).returning();
    await logActivity(user.id, "brand_created", `Registered brand ${brand.name} (${brand.domain})`);
    return json(brand, 201);
  }

  if (req.method === "PUT" && id) {
    const input = await parseBody(req, brandInput);
    await assertUnique(user.id, input.name, input.domain, id);
    const [brand] = await db
      .update(brands)
      .set({ ...input, contactEmail: input.contactEmail ?? null, updatedAt: new Date() })
      .where(and(eq(brands.id, id), eq(brands.userId, user.id)))
      .returning();
    if (!brand) throw new HttpError(404, "Brand not found");
    await logActivity(user.id, "brand_updated", `Updated brand ${brand.name}`);
    return json(brand);
  }

  if (req.method === "DELETE" && id) {
    const [brand] = await db.delete(brands).where(and(eq(brands.id, id), eq(brands.userId, user.id))).returning();
    if (!brand) throw new HttpError(404, "Brand not found");
    await logActivity(user.id, "brand_deleted", `Deleted brand ${brand.name} and its scan history`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
});

export const config: Config = { path: ["/api/brands", "/api/brands/:id"] };
