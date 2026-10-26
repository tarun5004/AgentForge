import { createGoogle } from "@ai-sdk/google";
import { embed, embedMany, type EmbeddingModel } from "ai";
import { frontendKnowledge, retrieveFrontendGuidance } from "./frontend-knowledge.js";

// Semantic search is opt-in: missing configuration never silently selects a billable embedding model.
export function readRetrievalSettings(source: NodeJS.ProcessEnv = process.env) {
  const method = source.RAG_RETRIEVAL_MODE?.trim() || "lexical";
  if (method !== "lexical" && method !== "semantic") throw new Error("RAG_RETRIEVAL_MODE must be lexical or semantic.");
  const model = source.RAG_EMBEDDING_MODEL?.trim();
  const apiKey = source.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (method === "semantic" && (!model || !/^[a-zA-Z0-9._-]{1,100}$/.test(model) || !apiKey)) {
    throw new Error("Semantic retrieval requires RAG_EMBEDDING_MODEL and GOOGLE_GENERATIVE_AI_API_KEY.");
  }
  return { method, model, apiKey };
}

// Reject malformed vectors before ranking: NaN or inconsistent dimensions cannot be useful evidence.
export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length || left.length > 8192 || [...left, ...right].some((value) => !Number.isFinite(value))) {
    throw new Error("Invalid retrieval embedding.");
  }
  const norm = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  const denominator = norm(left) * norm(right);
  return denominator ? left.reduce((sum, value, index) => sum + value * right[index]!, 0) / denominator : 0;
}

// One small in-memory vector index is enough for this fixed corpus; it is rebuilt after a restart.
export function createSemanticRetriever(model: EmbeddingModel) {
  let index: Promise<number[][]> | undefined;
  return async (query: string, abortSignal: AbortSignal) => {
    if (!query.trim() || Buffer.byteLength(query, "utf8") > 16_000) throw new Error("Invalid retrieval query.");
    let inputTokens = 0;
    let knownUsage = true;
    if (!index) {
      index = embedMany({ model, values: frontendKnowledge.map(({ title, text }) => `${title}\n${text}`), maxRetries: 0, maxParallelCalls: 1, abortSignal })
        .then((result) => {
          if (result.usage.tokens === undefined) knownUsage = false;
          else inputTokens += result.usage.tokens;
          if (result.embeddings.length !== frontendKnowledge.length) throw new Error("Incomplete retrieval index.");
          return result.embeddings;
        }).catch((error: unknown) => { index = undefined; throw error; });
    }
    const vectors = await index;
    const embedded = await embed({ model, value: query, maxRetries: 0, abortSignal });
    if (embedded.usage.tokens === undefined) knownUsage = false;
    else inputTokens += embedded.usage.tokens;
    const sources = frontendKnowledge.map((source, position) => ({ ...source, score: cosineSimilarity(embedded.embedding, vectors[position]!) }))
      .filter((source) => source.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 2);
    return { sources, inputTokens: knownUsage ? inputTokens : null };
  };
}

let semantic: { model: string; key: string; retrieve: ReturnType<typeof createSemanticRetriever> } | undefined;

// A semantic provider error stops this request; there is no hidden lexical or paid-provider fallback.
export async function retrieveGuidance(query: string, abortSignal: AbortSignal) {
  const settings = readRetrievalSettings();
  if (settings.method === "lexical") return { sources: retrieveFrontendGuidance(query), method: "lexical" as const, embeddingModel: null, inputTokens: 0 };
  if (!semantic || semantic.model !== settings.model || semantic.key !== settings.apiKey) {
    semantic = { model: settings.model!, key: settings.apiKey!, retrieve: createSemanticRetriever(createGoogle({ apiKey: settings.apiKey! }).embeddingModel(settings.model!)) };
  }
  try {
    const result = await semantic.retrieve(query, abortSignal);
    return { ...result, method: "semantic" as const, embeddingModel: settings.model! };
  } catch { throw new Error("Local knowledge retrieval is unavailable. No fallback request was made."); }
}
