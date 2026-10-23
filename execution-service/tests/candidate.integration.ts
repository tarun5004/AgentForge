import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateHash, createCandidateChecks } from "../src/features/runs/candidate.check.js";
import { createDockerRunner } from "../src/features/runs/docker.runner.js";
import { RunError } from "../src/features/runs/run.errors.js";

// Explicitly opt in: real Docker and fixed fixture source, no database or paid model access.
test("real candidate build returns bound evidence only after cleanup, invalid TSX returns no proof", { timeout: 240_000 }, async () => {
  assert.equal(process.env.RUN_DOCKER_TESTS, "1");
  const runner = await createDockerRunner(process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:local");
  const projectId = "100000000000000000000001";
  const id = "200000000000000000000001";
  const files = [{ path: "app/page.tsx", content: "export default function Page() { return <main>Candidate build fixture</main>; }" }];
  const checks = createCandidateChecks(runner, async () => ({ id, projectId, files }));
  try {
    const proof = await checks.check({ projectId, generationId: id, snapshotHash: candidateHash(files) }, "Bearer fixture");
    assert.equal(proof.snapshotHash, candidateHash(files));
    assert.equal(proof.runnerImageId, runner.imageId);
    assert.equal(proof.status, "build_passed");
    process.stdout.write("candidate-build-passed-and-cleaned\n");
    files[0]!.content = "export default function Page( { return <main>broken; }";
    await assert.rejects(checks.check({ projectId, generationId: id, snapshotHash: candidateHash(files) }, "Bearer fixture"),
      (error: unknown) => error instanceof RunError && error.code === "BUILD_VERIFICATION_FAILED");
    process.stdout.write("invalid-candidate-rejected-and-cleaned\n");
  } finally { await checks.close(); }
});
