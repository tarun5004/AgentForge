import { dockerCommand } from "./docker.command.js";
import { parseArtifacts, type Artifacts } from "./run.artifacts.js";
import type { Revision } from "./run.schema.js";
import { RunCleanupError } from "./run.errors.js";

const LABEL = "agentforge.local-preview";

// Keep security flags in one reviewable place; no socket, bind mount, port or secret is passed.
export function buildContainerArgs(name: string, imageId: string): string[] {
  return ["create", "--name", name, "--label", `${LABEL}=true`, "--network", "none", "--read-only",
    "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true",
    "--memory", "1g", "--memory-swap", "1g", "--cpus", "1", "--pids-limit", "128",
    "--tmpfs", "/work:rw,noexec,nosuid,nodev,size=536870912,uid=1000,gid=1000",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=67108864,uid=1000,gid=1000",
    "--env", "NEXT_TELEMETRY_DISABLED=1", "--env", "NODE_ENV=production", imageId];
}

export type BuildInput = { id: string; previewPath: string; revision: Revision; signal: AbortSignal };
export type Runner = { build(input: BuildInput): Promise<Artifacts> };

// The trusted local operator controls Docker. This is NOT a public multi-tenant sandbox.
export async function createDockerRunner(image: string, command = dockerCommand): Promise<Runner> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,200}$/.test(image)) throw new Error("Invalid runner image.");
  const info = JSON.parse(await command(["info", "--format", "{{json .OSType}}"]));
  if (info !== "linux") throw new Error("Preview requires Linux Docker containers.");
  const imageId = (await command(["image", "inspect", "--format", "{{.Id}}", image])).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Build the trusted preview image first.");
  const orphans = (await command(["ps", "-aq", "--filter", `label=${LABEL}=true`])).trim();
  if (orphans) throw new Error("Previous preview containers need operator cleanup before startup.");
  let cleanupFailed = false;

  return {
    // Cleanup is awaited before publishing artifacts; a killed CLI alone does not stop a build.
    async build({ id, previewPath, revision, signal }) {
      if (cleanupFailed) throw new Error("Preview disabled after a container cleanup failure. Restart after operator cleanup.");
      if (signal.aborted) throw new Error("Build cancelled before admission.");
      const name = `agentforge-preview-${id}`;
      try {
        await command(buildContainerArgs(name, imageId), { signal });
        await command(["start", name], { signal });
        await command(["exec", "-i", name, "node", "/runner/prepare.mjs"], {
          input: JSON.stringify({ files: revision.files, previewPath }), signal,
        });
        await command(["exec", "--workdir", "/work", name, "node", "/app/node_modules/next/dist/bin/next", "build", "--webpack"], {
          signal, timeoutMs: 120_000,
        });
        const json = await command(["exec", name, "node", "/runner/export.mjs"], {
          signal, maxBytes: 9 * 1024 * 1024,
        });
        if (signal.aborted) throw new Error("Build cancelled.");
        return parseArtifacts(json);
      } finally {
        // Even if create lost its acknowledgement, the unique name identifies only this job.
        try {
          const label = (await command(["inspect", "--format", `{{index .Config.Labels "${LABEL}"}}`, name])).trim();
          if (label !== "true") throw new Error("Container ownership check failed.");
          await command(["rm", "-f", name]);
        } catch {
          cleanupFailed = true;
          throw new RunCleanupError();
        }
      }
    },
  };
}
