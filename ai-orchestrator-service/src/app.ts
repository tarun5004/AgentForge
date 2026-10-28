import express from "express";
import morgan from "morgan";

import { createGenerationController } from "./features/generations/generation.controller.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { requireInternalToken } from "./middlewares/internal-auth.middleware.js";
import { createRequirementController } from "./features/requirements/requirement.controller.js";
import { assessRequirements } from "./features/requirements/requirement.service.js";
import { createConversationController } from "./features/conversations/conversation.controller.js";
import { respondToConversation, streamConversation } from "./features/conversations/conversation.service.js";
import { createConversationStreamController } from "./features/conversations/conversation.stream.js";
import { repairProject, repairRequestSchema } from "./features/generations/repair.service.js";

// Internal workflows share authentication and the configured model; injection is only a test seam.
export function createApp(requirementAssessor: typeof assessRequirements = assessRequirements, conversationResponder: typeof respondToConversation = respondToConversation, conversationStreamer: typeof streamConversation = streamConversation, repairer: typeof repairProject = repairProject) {
  const app = express();

  app.use(morgan("dev"));
  app.use(express.json({ limit: "256kb" }));

  app.get("/_status/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "ai-orchestrator-service" });
  });

  app.post(
    "/internal/generations",
    requireInternalToken,
    createGenerationController,
  );

  app.post("/internal/requirements", requireInternalToken, createRequirementController(requirementAssessor));
  app.post("/internal/conversations", requireInternalToken, createConversationController(conversationResponder));
  app.post("/internal/conversations/stream", requireInternalToken, createConversationStreamController(conversationStreamer));
  app.post("/internal/repairs", requireInternalToken, async (req, res) => {
    const request = repairRequestSchema.parse(req.body);
    const generation = await repairer(request);
    res.json({ generation });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
