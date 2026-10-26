import type { RequestHandler } from "express";
import { conversationRequestSchema } from "./conversation.schema.js";
import { respondToConversation } from "./conversation.service.js";

// Authentication precedes input validation; model failures pass through the shared sanitized handler.
export function createConversationController(respond: typeof respondToConversation): RequestHandler {
  return async (req, res, next) => {
    try { res.status(200).json({ response: await respond(conversationRequestSchema.parse(req.body)) }); }
    catch (error) { next(error); }
  };
}
