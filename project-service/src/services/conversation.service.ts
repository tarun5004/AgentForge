import { randomUUID } from "node:crypto";
import { parseConversationInput, requestConversation, type ConversationRequest } from "../clients/conversation.client.js";
import { AppError } from "../middlewares/error.middleware.js";
import { findOwnedProjectForRead } from "../repositories/project.repository.js";
import { findProjectRevision } from "../repositories/revision.repository.js";
import { validateRevisionFiles } from "./revision-files.js";

// Conversation reads owned context only; actual code publication stays in the generation workflow.
export async function converse(ownerId: string, body: unknown) {
  const input = parseConversationInput(body);
  const request: ConversationRequest = { requestId: randomUUID(), messages: input.messages };
  if (input.projectId) {
    const project = await findOwnedProjectForRead(input.projectId, ownerId);
    if (!project) throw new AppError(404, "Project not found.");
    if (input.baseRevisionId) {
      const revision = await findProjectRevision(input.projectId, input.baseRevisionId);
      if (!revision) throw new AppError(404, "Revision not found.");
      validateRevisionFiles(revision.files);
      request.baseRevision = { id: input.baseRevisionId, files: revision.files.map(({ path, content }) => ({ path, content })) };
    }
  }
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > 240_000) {
    throw new AppError(413, "Selected revision and conversation exceed the context limit.", "CONTEXT_TOO_LARGE");
  }
  return requestConversation(request);
}
