import { spawn } from "node:child_process";

type CommandOptions = { input?: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number };
export type DockerFailureReason = "command_failed" | "timeout" | "output_limit" | "unavailable" | "cancelled";

// Diagnostics stay inside the trusted controller/test harness, never in public run responses.
export class DockerCommandError extends Error {
  constructor(message: string, public diagnostic: string, public exitCode: number | null,
    public reason: DockerFailureReason = "command_failed") { super(message); }
}

// Invoke only Docker control commands, never generated code or a user-provided shell string.
export function dockerCommand(args: string[], options: CommandOptions = {}, start = spawn): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new DockerCommandError("Build cancelled.", "", null, "cancelled"));
  return new Promise((resolve, reject) => {
    // Tests replace only process creation; production always invokes the fixed Docker executable.
    const child = start("docker", args, { shell: false, windowsHide: true, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: { message: string; reason: DockerFailureReason } | undefined;
    const stop = (message: string, reason: DockerFailureReason) => {
      failure ??= { message, reason };
      child.kill();
    };
    const timer = setTimeout(() => stop("Docker operation timed out.", "timeout"), options.timeoutMs ?? 15_000);
    const abort = () => stop("Build cancelled.", "cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxBytes ?? 64_000)) stop("Docker output limit exceeded.", "output_limit");
      else stdout.push(chunk);
    });
    // Drain stderr, but never surface daemon details, source text, or host configuration.
    child.stderr.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxBytes ?? 64_000)) stop("Docker output limit exceeded.", "output_limit");
      else stderr.push(chunk);
    });
    child.stdin.on("error", () => { /* Early exits can close stdin before the input is written. */ });
    child.on("error", () => { failure ??= { message: "Docker CLI unavailable.", reason: "unavailable" }; });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure || code !== 0) reject(new DockerCommandError(failure?.message ?? "Container command failed; check template compatibility.",
        Buffer.concat([...stdout, ...stderr]).toString("utf8").slice(-4000), code, failure?.reason ?? "command_failed"));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(options.input);
  });
}
