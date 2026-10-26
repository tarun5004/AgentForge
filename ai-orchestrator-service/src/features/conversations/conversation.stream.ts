import { once } from "node:events";
import type { RequestHandler, Response } from "express";
import { conversationRequestSchema } from "./conversation.schema.js";
import { streamConversation } from "./conversation.service.js";

// JSON framing escapes newlines; waiting for drain prevents unbounded buffering for slow readers.
async function writeEvent(res: Response, event: string, data: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
    await once(res, "drain", { signal });
  }
}

// Invalid requests stay ordinary JSON errors; after headers, errors use a sanitized terminal SSE event.
export function createConversationStreamController(stream: typeof streamConversation = streamConversation): RequestHandler {
  return async (req, res, next) => {
    let request;
    try { request = conversationRequestSchema.parse(req.body); }
    catch (error) { next(error); return; }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnect);
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    try {
      await writeEvent(res, "start", { requestId: request.requestId }, signal);
      const response = await stream(request, (message) => writeEvent(res, "message", { message }, signal), signal);
      await writeEvent(res, "complete", { response }, signal);
    } catch {
      // Never send a partial decision, raw provider error, token or user content in an error event.
      if (!res.destroyed && !controller.signal.aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ code: "AI_UNAVAILABLE", message: "AI response interrupted. No build decision was accepted." })}\n\n`);
      }
    } finally {
      controller.abort();
      res.off("close", disconnect);
      res.end();
    }
  };
}
