import { z } from "zod";
import { MAX_CONTEXT_BYTES, snapshotSchema, validateFiles } from "../generations/generation.schema.js";

export const conversationRequestSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(100),
  messages: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) })).min(1).max(16),
  baseRevision: z.strictObject({ id: z.string().regex(/^[a-f\d]{24}$/i), files: snapshotSchema }).optional(),
}).superRefine((request, context) => {
  if (request.messages.at(-1)?.role !== "user") context.addIssue({ code: "custom", message: "The last message must be from the user." });
  if (Buffer.byteLength(JSON.stringify(request.messages), "utf8") > 16_000 || Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_CONTEXT_BYTES) {
    context.addIssue({ code: "custom", message: "Conversation context is too large.", params: { code: "CONTEXT_TOO_LARGE" } });
  }
  if (request.baseRevision) {
    try { validateFiles(request.baseRevision.files); }
    catch { context.addIssue({ code: "custom", path: ["baseRevision"], message: "Invalid frontend snapshot." }); }
  }
});

export const conversationDecisionSchema = z.strictObject({
  action: z.enum(["reply", "clarify", "build"]),
  message: z.string().trim().min(1).max(4000),
  prompt: z.string().trim().min(10).max(1000).nullable(),
});

export type ConversationRequest = z.infer<typeof conversationRequestSchema>;
export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;

// Cross-field validation stays outside provider JSON schema to avoid provider-specific schema behavior.
export function validateConversationDecision(value: unknown): ConversationDecision {
  const decision = conversationDecisionSchema.parse(value);
  if ((decision.action === "build") !== (decision.prompt !== null)) throw new Error("Conversation action and build prompt disagree.");
  return decision;
}
