/** A node in a MyST mdast tree. Kept loose — we only rely on a few fields. */
export interface MystNode {
  type: string;
  depth?: number;
  value?: string;
  identifier?: string;
  html_id?: string;
  children?: MystNode[];
  [key: string]: unknown;
}

/** Shape of a site's /myst.xref.json index. */
export interface XrefIndex {
  version: string;
  myst: string;
  references: XrefReference[];
}

export interface XrefReference {
  kind: string;
  data: string;
  url: string;
  identifier?: string;
  implicit?: boolean;
}

/** Shape of a per-page .json document served by a mystmd site. */
export interface MystPageJson {
  version: string;
  kind: string;
  sha256: string;
  slug: string;
  location?: string;
  frontmatter: MystFrontmatter;
  mdast: MystNode;
}

export interface MystFrontmatter {
  title?: string;
  subtitle?: string;
  description?: string;
  subject?: string;
  keywords?: string[];
  tags?: string[];
  authors?: { name?: string; [key: string]: unknown }[];
  license?: { content?: { id?: string; name?: string }; code?: { id?: string; name?: string } } | { id?: string; name?: string };
  thumbnail?: string;
  [key: string]: unknown;
}

/** A section of a page: the unit of search and curation. */
export interface ExtractedSection {
  /** html_id / identifier of the heading, or null for the page preamble. */
  anchor: string | null;
  /** Titles of ancestor headings, ending with this section's own title. */
  headingPath: string[];
  title: string;
  depth: number;
  text: string;
}

/** Document stored in the Meilisearch `sections` index. */
export interface SearchDoc {
  id: string;
  siteId: string;
  siteTitle: string;
  siteUrl: string;
  pageSlug: string;
  pageTitle: string;
  /** Absolute URL of the section (page URL + #anchor when present). */
  url: string;
  anchor: string | null;
  headingPath: string[];
  sectionTitle: string;
  text: string;
  description: string | null;
  authors: string[];
  tags: string[];
  license: string | null;
  thumbnail: string | null;
}

export type SiteStatus = "pending" | "crawling" | "ready" | "error";
export type JobStatus = "queued" | "running" | "done" | "error";

export interface SiteSummary {
  id: string;
  url: string;
  title: string | null;
  status: SiteStatus;
  error: string | null;
  pageCount: number;
  lastCrawledAt: string | null;
  createdAt: string;
}
