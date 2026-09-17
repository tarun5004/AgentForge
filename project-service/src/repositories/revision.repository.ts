import { Revision } from "../models/revision.model.js";
import type { GeneratedFile } from "../models/generation.model.js";

type NewRevision = {
  projectId: string;
  generationId: string;
  version: number;
  summary: string;
  files: GeneratedFile[];
};

export async function insertRevision(input: NewRevision) {
  return Revision.create(input);
}
