import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_DIMENSIONS = 384;
const MODEL = "Xenova/bge-small-en-v1.5";
/** bge models want this prefix on queries (not on passages). */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  // Model (~34 MB, quantized) downloads to the HF cache on first use.
  extractor ??= pipeline("feature-extraction", MODEL, { dtype: "q8" });
  return extractor;
}

async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extract = await getExtractor();
  const out: number[][] = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const tensor = await extract(batch, { pooling: "mean", normalize: true });
    const data = tensor.data as Float32Array;
    for (let j = 0; j < batch.length; j++) {
      out.push(Array.from(data.slice(j * EMBEDDING_DIMENSIONS, (j + 1) * EMBEDDING_DIMENSIONS)));
    }
    tensor.dispose();
  }
  return out;
}

/** Embed passages (section texts) for indexing. */
export function embedPassages(texts: string[]): Promise<number[][]> {
  return embed(texts.map((t) => t.slice(0, 2000)));
}

/** Embed a search query (bge wants an instruction prefix on the query side). */
export async function embedQuery(query: string): Promise<number[]> {
  const [vec] = await embed([QUERY_PREFIX + query]);
  return vec!;
}
