import { z } from "zod";

export const createSiteSchema = z.object({
  url: z.string().url(),
});

export const searchQuerySchema = z.object({
  q: z.string().default(""),
  site: z.string().optional(),
  tags: z.string().optional(),
  author: z.string().optional(),
  mode: z.enum(["keyword", "hybrid"]).default("hybrid"),
  limit: z.coerce.number().int().min(1).max(50).default(15),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
