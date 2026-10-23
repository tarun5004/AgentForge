import { createHash } from "node:crypto";
import { z } from "zod";

export const buildVerificationSchema = z.strictObject({
  status: z.literal("build_passed"), policyVersion: z.literal("next-static-build-v1"),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), runnerImageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  checkId: z.string().uuid(), completedAt: z.iso.datetime(),
});
export type BuildVerification = z.infer<typeof buildVerificationSchema>;

// Match Execution's canonical UTF-8 hash; array order alone must not change source identity.
export function candidateHash(files: { path: string; content: string }[]): string {
  const canonical = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map(({ path, content }) => ({ path, content }));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

// Missing or mismatched proof is never a build pass, including on saved-result replay.
export function matchingBuildVerification(value: unknown, files: { path: string; content: string }[]): BuildVerification | null {
  const proof = buildVerificationSchema.safeParse(value);
  return proof.success && proof.data.snapshotHash === candidateHash(files) ? proof.data : null;
}
