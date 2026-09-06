import { z } from "zod";

const mongoObjectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid MongoDB ObjectId");

export const createRunBodySchema = z.strictObject({
  projectId: mongoObjectIdSchema,
  revisionId: mongoObjectIdSchema,
});

export type CreateRunBody = z.infer<typeof createRunBodySchema>;