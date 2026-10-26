import { env } from "../config/env.js";
import { conversationResponseSchema, type ConversationRequest } from "./conversation.client.js";

export type ConversationResponse = ReturnType<typeof conversationResponseSchema.parse>["response"];
export type ConversationEvent = { event: "message"; message: string } | { event: "complete"; response: ConversationResponse };

// Treat upstream SSE as untrusted input, including frame boundaries split across UTF-8/network chunks.
export async function* requestConversationStream(request: ConversationRequest, signal: AbortSignal): AsyncGenerator<ConversationEvent> {
  const response = await fetch(`${env.AI_ORCHESTRATOR_URL}/internal/conversations/stream`, {
    method: "POST", redirect: "error", signal,
    headers: { "content-type": "application/json", "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    await response.body?.cancel();
    throw new Error("AI stream unavailable.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let events = 0;
  let started = false;
  let completed = false;
  let finalResponse: ConversationResponse | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_650_000) throw new Error("AI stream exceeds total limit.");
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (++events > 67 || Buffer.byteLength(frame) > 32_000 || completed) throw new Error("Invalid AI stream frame.");
        const lines = frame.split("\n");
        if (lines.length !== 2 || !lines[0]?.startsWith("event: ") || !lines[1]?.startsWith("data: ")) throw new Error("Invalid SSE framing.");
        const name = lines[0].slice(7);
        const data = JSON.parse(lines[1].slice(6));
        if (name === "start" && !started && data?.requestId === request.requestId) { started = true; continue; }
        if (!started) throw new Error("AI stream correlation failed.");
        if (name === "message" && typeof data?.message === "string" && data.message.length <= 4000 && Object.keys(data).length === 1) {
          yield { event: "message", message: data.message };
        } else if (name === "complete") {
          const { response: result } = conversationResponseSchema.parse(data);
          if (result.requestId !== request.requestId || (result.action === "build") !== (result.prompt !== null)) throw new Error("Invalid AI decision.");
          completed = true;
          finalResponse = result;
        } else throw new Error("AI stream interrupted or invalid.");
      }
      if (Buffer.byteLength(buffer) > 32_000) throw new Error("AI stream frame exceeds limit.");
    }
    buffer += decoder.decode();
    if (!completed || buffer.trim()) throw new Error("AI stream ended without completion.");
    yield { event: "complete", response: finalResponse! };
  } finally { await reader.cancel().catch(() => undefined); }
}
