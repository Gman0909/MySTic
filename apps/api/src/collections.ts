import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getUser, requireUser, type AuthUser } from "./auth.js";
import { schema, type Db } from "./db/index.js";

const { collections, collectionNodes } = schema;

type CollectionRow = typeof collections.$inferSelect;

const createSchema = z.object({ name: z.string().min(1).max(120) });
const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(["unlisted", "public", "private"]).optional(),
});
const addNodeSchema = z.object({
  kind: z.enum(["part", "page", "section"]),
  siteId: z.string().optional(),
  pageSlug: z.string().optional(),
  anchor: z.string().nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  parentId: z.string().nullable().optional(),
});
const nodePatchSchema = z.object({ title: z.string().max(300).nullable().optional() });
const treeSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), parentId: z.string().nullable(), position: z.number().int().min(0) })),
});

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "collection";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

async function loadNodes(db: Db, collectionId: string) {
  return db
    .select()
    .from(collectionNodes)
    .where(eq(collectionNodes.collectionId, collectionId))
    .orderBy(asc(collectionNodes.position), asc(collectionNodes.createdAt));
}

/** Owners, admins, and anyone for pre-account (ownerless) collections. */
function canEdit(coll: CollectionRow, user: AuthUser | null): boolean {
  if (!user) return false;
  return user.isAdmin || coll.ownerId === null || coll.ownerId === user.id;
}

function canView(coll: CollectionRow, user: AuthUser | null): boolean {
  if (coll.visibility !== "private") return true; // public + unlisted are link-accessible
  return canEdit(coll, user);
}

export function registerCollectionRoutes(app: FastifyInstance, db: Db): void {
  /** Signed in: your collections (+ legacy ownerless). Signed out: public ones. */
  app.get("/api/collections", async (req) => {
    const user = await getUser(db, req);
    const rows = user
      ? await db
          .select()
          .from(collections)
          .where(user.isAdmin ? undefined : or(eq(collections.ownerId, user.id), isNull(collections.ownerId)))
          .orderBy(desc(collections.updatedAt))
      : await db.select().from(collections).where(eq(collections.visibility, "public")).orderBy(desc(collections.updatedAt));
    return rows;
  });

  app.get("/api/collections/public", async () => {
    return db.select().from(collections).where(eq(collections.visibility, "public")).orderBy(desc(collections.updatedAt));
  });

  app.post("/api/collections", async (req, reply) => {
    const user = await requireUser(db, req, reply);
    if (!user) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Name required" });
    const id = randomUUID();
    await db
      .insert(collections)
      .values({ id, slug: slugify(parsed.data.name), name: parsed.data.name, ownerId: user.id });
    const [row] = await db.select().from(collections).where(eq(collections.id, id));
    return reply.code(201).send(row);
  });

  app.get<{ Params: { id: string } }>("/api/collections/:id", async (req, reply) => {
    const user = await getUser(db, req);
    const [row] = await db.select().from(collections).where(eq(collections.id, req.params.id));
    if (!row || !canView(row, user)) return reply.code(404).send({ error: "Not found" });
    return { ...row, nodes: await loadNodes(db, row.id), canEdit: canEdit(row, user) };
  });

  app.get<{ Params: { slug: string } }>("/api/collections/slug/:slug", async (req, reply) => {
    const user = await getUser(db, req);
    const [row] = await db.select().from(collections).where(eq(collections.slug, req.params.slug));
    if (!row || !canView(row, user)) return reply.code(404).send({ error: "Not found" });
    return { ...row, nodes: await loadNodes(db, row.id), canEdit: canEdit(row, user) };
  });

  app.patch<{ Params: { id: string } }>("/api/collections/:id", async (req, reply) => {
    const user = await requireUser(db, req, reply);
    if (!user) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [row] = await db.select().from(collections).where(eq(collections.id, req.params.id));
    if (!row) return reply.code(404).send({ error: "Not found" });
    if (!canEdit(row, user)) return reply.code(403).send({ error: "Only the owner can edit this collection" });
    await db
      .update(collections)
      .set({ ...parsed.data, ownerId: row.ownerId ?? user.id, updatedAt: new Date().toISOString() })
      .where(eq(collections.id, req.params.id));
    const [updated] = await db.select().from(collections).where(eq(collections.id, req.params.id));
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/collections/:id", async (req, reply) => {
    const user = await requireUser(db, req, reply);
    if (!user) return;
    const [row] = await db.select().from(collections).where(eq(collections.id, req.params.id));
    if (!row) return reply.code(404).send({ error: "Not found" });
    if (!canEdit(row, user)) return reply.code(403).send({ error: "Only the owner can delete this collection" });
    await db.delete(collectionNodes).where(eq(collectionNodes.collectionId, row.id));
    await db.delete(collections).where(eq(collections.id, row.id));
    return { deleted: true };
  });

  /** Clone a viewable collection (with its whole TOC) into the caller's account. */
  app.post<{ Params: { id: string } }>("/api/collections/:id/fork", async (req, reply) => {
    const user = await requireUser(db, req, reply);
    if (!user) return;
    const [source] = await db.select().from(collections).where(eq(collections.id, req.params.id));
    if (!source || !canView(source, user)) return reply.code(404).send({ error: "Not found" });
    const sourceNodes = await loadNodes(db, source.id);

    const id = randomUUID();
    const name = `${source.name} (copy)`;
    await db.insert(collections).values({
      id,
      slug: slugify(name),
      name,
      description: source.description,
      visibility: "unlisted",
      ownerId: user.id,
    });
    const idMap = new Map<string, string>(sourceNodes.map((n) => [n.id, randomUUID()]));
    for (const n of sourceNodes) {
      await db.insert(collectionNodes).values({
        ...n,
        id: idMap.get(n.id)!,
        collectionId: id,
        parentId: n.parentId ? idMap.get(n.parentId) ?? null : null,
      });
    }
    const [row] = await db.select().from(collections).where(eq(collections.id, id));
    return reply.code(201).send(row);
  });

  app.post<{ Params: { id: string } }>("/api/collections/:id/nodes", async (req, reply) => {
    const user = await requireUser(db, req, reply);
    if (!user) return;
    const parsed = addNodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const [coll] = await db.select().from(collections).where(eq(collections.id, req.params.id));
    if (!coll) return reply.code(404).send({ error: "Collection not found" });
    if (!canEdit(coll, user)) return reply.code(403).send({ error: "Only the owner can edit this collection" });
    const data = parsed.data;
    if (data.kind !== "part" && (!data.siteId || !data.pageSlug)) {
      return reply.code(400).send({ error: "page/section nodes need siteId and pageSlug" });
    }
    const siblings = await loadNodes(db, coll.id);
    const position = siblings.filter((n) => (n.parentId ?? null) === (data.parentId ?? null)).length;
    const node = {
      id: randomUUID(),
      collectionId: coll.id,
      parentId: data.parentId ?? null,
      position,
      kind: data.kind,
      siteId: data.siteId ?? null,
      pageSlug: data.pageSlug ?? null,
      anchor: data.anchor ?? null,
      title: data.title ?? null,
    };
    await db.insert(collectionNodes).values(node);
    await db.update(collections).set({ updatedAt: new Date().toISOString() }).where(eq(collections.id, coll.id));
    return reply.code(201).send(node);
  });

  /** Shared edit-permission gate for node-level routes. */
  async function editableCollection(req: { params: { id: string } } & FastifyRequest, reply: FastifyReply) {
    const user = await requireUser(db, req, reply);
    if (!user) return null;
    const [coll] = await db.select().from(collections).where(eq(collections.id, (req.params as { id: string }).id));
    if (!coll) {
      await reply.code(404).send({ error: "Collection not found" });
      return null;
    }
    if (!canEdit(coll, user)) {
      await reply.code(403).send({ error: "Only the owner can edit this collection" });
      return null;
    }
    return coll;
  }

  app.patch<{ Params: { id: string; nodeId: string } }>("/api/collections/:id/nodes/:nodeId", async (req, reply) => {
    if (!(await editableCollection(req, reply))) return;
    const parsed = nodePatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    await db
      .update(collectionNodes)
      .set({ title: parsed.data.title ?? null })
      .where(and(eq(collectionNodes.id, req.params.nodeId), eq(collectionNodes.collectionId, req.params.id)));
    return { ok: true };
  });

  app.delete<{ Params: { id: string; nodeId: string } }>("/api/collections/:id/nodes/:nodeId", async (req, reply) => {
    if (!(await editableCollection(req, reply))) return;
    // Orphan children of a deleted part up to root rather than deleting them.
    await db
      .update(collectionNodes)
      .set({ parentId: null })
      .where(and(eq(collectionNodes.parentId, req.params.nodeId), eq(collectionNodes.collectionId, req.params.id)));
    await db
      .delete(collectionNodes)
      .where(and(eq(collectionNodes.id, req.params.nodeId), eq(collectionNodes.collectionId, req.params.id)));
    return { ok: true };
  });

  /** Bulk layout update — the editor sends the whole tree after each rearrange. */
  app.put<{ Params: { id: string } }>("/api/collections/:id/tree", async (req, reply) => {
    if (!(await editableCollection(req, reply))) return;
    const parsed = treeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    for (const n of parsed.data.nodes) {
      await db
        .update(collectionNodes)
        .set({ parentId: n.parentId, position: n.position })
        .where(and(eq(collectionNodes.id, n.id), eq(collectionNodes.collectionId, req.params.id)));
    }
    await db.update(collections).set({ updatedAt: new Date().toISOString() }).where(eq(collections.id, req.params.id));
    return { ok: true };
  });
}
