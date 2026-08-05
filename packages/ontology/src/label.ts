import Anthropic from "@anthropic-ai/sdk";

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have how in is it its of on or that the this to was we what when where which will with you your not can use using used our they their there here also more most other些"
    .split(/\s+/),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 2 && t.length < 30 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * TF-IDF labels: top distinctive terms for each cluster relative to the corpus.
 * Always available; used as the fallback when no Claude API key is configured
 * and as the raw material for Claude labeling.
 */
export function tfidfTerms(clusterTexts: string[][], topN = 6): string[][] {
  const df = new Map<string, number>();
  const clusterTf: Map<string, number>[] = clusterTexts.map((texts) => {
    const tf = new Map<string, number>();
    const seen = new Set<string>();
    for (const text of texts) {
      for (const tok of tokenize(text)) {
        tf.set(tok, (tf.get(tok) ?? 0) + 1);
        seen.add(tok);
      }
    }
    for (const tok of seen) df.set(tok, (df.get(tok) ?? 0) + 1);
    return tf;
  });
  const total = clusterTexts.length;
  return clusterTf.map((tf) =>
    [...tf.entries()]
      .map(([term, count]) => [term, count * Math.log(1 + total / (df.get(term) ?? 1))] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([term]) => term),
  );
}

export interface ClusterForLabeling {
  key: string;
  terms: string[];
  sampleTitles: string[];
}

export interface ConceptLabel {
  label: string;
  description: string;
}

/** Deterministic fallback label from TF-IDF terms. */
export function fallbackLabel(c: ClusterForLabeling): ConceptLabel {
  const label = c.terms
    .slice(0, 3)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" · ");
  return { label: label || "Miscellaneous", description: `Sections about: ${c.terms.join(", ")}` };
}

/**
 * Label all clusters in one Claude call. Returns null if no API key is
 * available or the call fails — callers fall back to TF-IDF labels.
 */
export async function claudeLabels(
  clusters: ClusterForLabeling[],
  apiKey?: string,
): Promise<Map<string, ConceptLabel> | null> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key || !clusters.length) return null;
  const client = new Anthropic({ apiKey: key });
  const input = clusters.map((c) => ({ key: c.key, terms: c.terms, sample_titles: c.sampleTitles.slice(0, 8) }));
  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system:
        "You label topic clusters for a knowledge tree over scientific/technical documentation sites. " +
        "Given each cluster's distinctive terms and sample section titles, produce a short human-friendly " +
        "topic label (2-4 words, title case, no punctuation) and a one-sentence description.",
      messages: [{ role: "user", content: JSON.stringify(input) }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              labels: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["key", "label", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["labels"],
            additionalProperties: false,
          },
        },
      },
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { labels: { key: string; label: string; description: string }[] };
    return new Map(parsed.labels.map((l) => [l.key, { label: l.label, description: l.description }]));
  } catch (err) {
    console.warn("Claude labeling failed, using TF-IDF labels:", (err as Error).message);
    return null;
  }
}
