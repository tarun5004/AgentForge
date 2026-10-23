import type { DockerFailureReason } from "./docker.command.js";

// Carry safe public messages without leaking Docker or upstream response details.
export class RunError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

// Cancellation is not confirmed if the worker cannot prove that its container was removed.
export class RunCleanupError extends Error {
  constructor() { super("Container cleanup could not be confirmed; operator review is required."); }
}

export type BuildStage = "container" | "prepare" | "compile" | "export" | "artifacts";
const stageDescriptions: Record<BuildStage, string> = {
  container: "starting the restricted container", prepare: "preparing saved frontend files",
  compile: "running the frontend build command", export: "reading the static export", artifacts: "validating the static export",
};
const stageMessages: Record<BuildStage, string> = {
  container: "The restricted container could not start. Check the local Docker setup.",
  prepare: "Saved frontend files could not be prepared for the fixed preview template.",
  compile: "The frontend build command failed. Check source compatibility and the local Docker setup.",
  export: "Static export bytes could not be read from the container.",
  artifacts: "The static export did not match the allowed artifact format.",
};

// Build public diagnostics from trusted enums only, never compiler text or an upstream Error.message.
export class RunBuildError extends Error {
  constructor(public stage: BuildStage, public reason: DockerFailureReason = "command_failed") {
    let detail = stageMessages[stage];
    if (reason === "timeout") detail = `Time limit exceeded while ${stageDescriptions[stage]}.`;
    else if (reason === "output_limit") detail = `Output limit exceeded while ${stageDescriptions[stage]}.`;
    else if (reason === "unavailable") detail = "The local Docker CLI is unavailable.";
    else if (reason === "cancelled") detail = "The container command was interrupted.";
    super(`Build failed. ${detail}`);
  }
}
