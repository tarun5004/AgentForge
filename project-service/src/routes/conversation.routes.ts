import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { validateQueryKeys } from "../services/project-read.validation.js";
import { converse } from "../services/conversation.service.js";

const router = express.Router();
// JSON escaping can exceed the logical context budget; validate that budget after parsing.
router.post("/", authenticate, express.json({ limit: "100kb" }), async (req, res, next) => {
  try {
    validateQueryKeys(req.query, []);
    res.json(await converse(req.user!.id, req.body));
  } catch (error) { next(error); }
});
export default router;
