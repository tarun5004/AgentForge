import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../middlewares/error.middleware.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const conversationInputSchema = z.strictObject({
  messages: z.array(z.strictObject({
    role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000),
  })).min(1).max(16),
  projectId: objectId.optional(), baseRevisionId: objectId.optional(),
});
export type ConversationInput = z.infer<typeof conversationInputSchema>;
export type ConversationRequest = Pick<ConversationInput, "messages"> & {
  requestId: string; baseRevision?: { id: string; files: { path: string; content: string }[] };
};
const tokenCount = z.number().int().nonnegative().nullable();
export const conversationResponseSchema = z.strictObject({ response: z.strictObject({
  requestId: z.string().min(1).max(100), action: z.enum(["reply", "clarify", "build"]),
  message: z.string().trim().min(1).max(4000), prompt: z.string().trim().min(10).max(1000).nullable(),
  sources: z.array(z.strictObject({ id: z.string().min(1).max(100), title: z.string().min(1).max(200) })).max(8),
  retrieval: z.strictObject({ method: z.enum(["lexical", "semantic"]), embeddingModel: z.string().min(1).max(200).nullable(), inputTokens: tokenCount }),
  model: z.string().min(1).max(200),
  usage: z.strictObject({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount }),
  latencyMs: z.number().finite().nonnegative(),
}) });

// Reject hidden switches and oversized history rather than silently forgetting user context.
export function parseConversationInput(body: unknown): ConversationInput {
  const parsed = conversationInputSchema.safeParse(body);
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user" ||
      (parsed.data.baseRevisionId && !parsed.data.projectId)) {
    throw new AppError(400, "Supply bounded conversation messages ending with a user message.", "INVALID_CONVERSATION");
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data.messages), "utf8") > 16_000) {
    throw new AppError(413, "Conversation history is too large. Start a new conversation.", "CONTEXT_TOO_LARGE");
  }
  return parsed.data;
}

// One authenticated HTTP attempt: network errors must never silently repeat a model request.
export async function requestConversation(request: ConversationRequest) {
  try {
    const response = await fetch(`${env.AI_ORCHESTRATOR_URL}/internal/conversations`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(50_000),
      headers: { "content-type": "application/json", "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN, "x-request-id": request.requestId },
      body: JSON.stringify(request),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("AI request failed.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 32_000) throw new Error("AI response is too large.");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const result = conversationResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (result.response.requestId !== request.requestId ||
        (result.response.action === "build") !== (result.response.prompt !== null)) throw new Error("Invalid AI decision.");
    return result;
  } catch {
    // Upstream authentication is a server configuration failure, not an expired browser session.
    throw new AppError(502, "AI is unavailable. Your message has not generated or changed files. Try again when ready.", "AI_UNAVAILABLE");
  }
}
