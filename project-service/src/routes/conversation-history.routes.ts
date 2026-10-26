import { Router } from "express";
import { once } from "node:events";
import { AppError } from "../middlewares/error.middleware.js";
import * as repository from "../repositories/conversation.repository.js";
import { attachProject, getOwnedConversation, prepareSavedTurn, runSavedTurn, serializeConversation } from "../services/conversation-history.service.js";
import { validateObjectId, validateQueryKeys } from "../services/project-read.validation.js";

const router = Router();
// The sidebar reads metadata only, with an ID cursor and no inference work.
router.get("/", async (req, res, next) => {
  try {
    validateQueryKeys(req.query, ["before"]);
    const before = req.query.before === undefined ? undefined : validateObjectId(req.query.before, "before");
    const records = await repository.listConversations(req.user!.id, before);
    const page = records.slice(0, 20);
    res.json({ conversations: page.map((item) => ({ id: String(item._id), title: item.title, projectId: item.projectId, createdAt: item.createdAt, updatedAt: item.updatedAt })),
      nextCursor: records.length > 20 ? String(page.at(-1)!._id) : null });
  } catch (error) { next(error); }
});
// Create durable chat identity without creating a generated project.
router.post("/threads", async (req, res, next) => {
  try {
    validateQueryKeys(req.query, []);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) throw new AppError(400, "Supply an empty object to create a conversation.");
    res.status(201).json({ conversation: serializeConversation((await repository.insertConversation(req.user!.id)).toObject()) });
  }
  catch (error) { next(error); }
});
// Reload one bounded history page after the account has been authenticated.
router.get("/:id", async (req, res, next) => {
  try {
    validateQueryKeys(req.query, ["before"]);
    const before = req.query.before === undefined ? undefined : Number(req.query.before);
    if (before !== undefined && (typeof req.query.before !== "string" || !/^\d{1,3}$/.test(req.query.before) || !Number.isInteger(before) || before < 0 || before > 100)) throw new AppError(400, "Invalid turn cursor.");
    res.json({ conversation: serializeConversation(await getOwnedConversation(validateObjectId(req.params.id, "conversation ID"), req.user!.id), before) });
  } catch (error) { next(error); }
});
// Associate the first explicit build with its original conversation.
router.post("/:id/project", async (req, res, next) => {
  try {
    validateQueryKeys(req.query, []);
    if (!req.body || Object.keys(req.body).some((key) => key !== "projectId")) throw new AppError(400, "Supply a project ID only.");
    res.json({ conversation: await attachProject(validateObjectId(req.params.id, "conversation ID"), req.user!.id, validateObjectId(req.body.projectId, "project ID")) });
  } catch (error) { next(error); }
});
// Admission errors stay JSON; accepted turns stream only checked events and durable final responses.
router.post("/:id/turns/stream", async (req, res, next) => {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]);
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  let reserved: { id: string; key: string } | null = null;
  res.on("close", disconnect);
  try {
    validateQueryKeys(req.query, []);
    const id = validateObjectId(req.params.id, "conversation ID");
    const prepared = await prepareSavedTurn(id, req.user!.id, req.body);
    if (!prepared.replay) reserved = { id, key: prepared.input.key };
    signal.throwIfAborted();
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(`event: start\ndata: ${JSON.stringify({ conversationId: id, key: prepared.input.key, contextTrimmed: prepared.trimmed, replayed: !!prepared.replay })}\n\n`);
    for await (const event of runSavedTurn(id, req.user!.id, prepared, signal)) {
      const data = event.event === "message" ? { message: event.message } : { response: event.response };
      if (!res.write(`event: ${event.event}\ndata: ${JSON.stringify(data)}\n\n`)) await once(res, "drain", { signal });
    }
    res.end();
  } catch (error) {
    if (reserved) await repository.interruptConversationTurn(reserved.id, req.user!.id, reserved.key).catch(() => undefined);
    if (!res.headersSent && !res.destroyed) next(error);
    else if (!res.destroyed) {
      res.end(`event: error\ndata: ${JSON.stringify({ code: "CHAT_INTERRUPTED", message: "Reply interrupted. Read saved history before trying again. No build decision was accepted." })}\n\n`);
    }
  } finally { controller.abort(); res.off("close", disconnect); }
});
export default router;
