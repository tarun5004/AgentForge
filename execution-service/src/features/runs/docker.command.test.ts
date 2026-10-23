import assert from "node:assert/strict";
import { ChildProcess, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { dockerCommand, DockerCommandError, type DockerFailureReason } from "./docker.command.js";

// Model child-process events only: unit tests never require a Docker daemon or execute generated code.
function processFixture(events: (child: ChildProcessWithoutNullStreams) => void) {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: () => { queueMicrotask(() => child.emit("close", null)); return true; },
  }) as ChildProcessWithoutNullStreams;
  const start = ((binary, _args, options) => {
    assert.equal(binary, "docker");
    assert.equal(options?.shell, false);
    assert.equal(options?.windowsHide, true);
    queueMicrotask(() => events(child));
    return child;
  }) as typeof spawn;
  return { child, start };
}

// Assert the trusted reason enum rather than matching changeable Docker/compiler error strings.
function reasonIs(reason: DockerFailureReason) {
  return (error: unknown) => error instanceof DockerCommandError && error.reason === reason;
}

test("Docker process exit keeps stdout successful and nonzero exits classified", async () => {
  const success = processFixture(child => { child.stdout.emit("data", Buffer.from("fixture")); child.emit("close", 0); });
  assert.equal(await dockerCommand(["fixture"], {}, success.start), "fixture");
  const failed = processFixture(child => { child.stderr.emit("data", Buffer.from("private detail")); child.emit("close", 2); });
  await assert.rejects(dockerCommand(["fixture"], {}, failed.start), reasonIs("command_failed"));
});

test("Docker timeout is explicit even when process termination emits another error", async () => {
  const fixture = processFixture(() => {});
  fixture.child.kill = () => {
    fixture.child.emit("error", new Error("secondary private error"));
    fixture.child.emit("close", null);
    return true;
  };
  await assert.rejects(dockerCommand(["fixture"], { timeoutMs: 5 }, fixture.start), reasonIs("timeout"));
});

test("Docker output limit covers stderr and stdout without retaining oversized chunks", async () => {
  for (const stream of ["stdout", "stderr"] as const) {
    const fixture = processFixture(child => child[stream].emit("data", Buffer.alloc(5)));
    await assert.rejects(dockerCommand(["fixture"], { maxBytes: 4 }, fixture.start), error => {
      assert.ok(error instanceof DockerCommandError);
      assert.equal(error.reason, "output_limit");
      assert.equal(error.diagnostic, "");
      return true;
    });
  }
});

test("Docker spawn failure is classified without exposing the operating system error", async () => {
  const fixture = processFixture(child => { child.emit("error", new Error("private executable path")); child.emit("close", null); });
  await assert.rejects(dockerCommand(["fixture"], {}, fixture.start), error => {
    assert.ok(error instanceof DockerCommandError);
    assert.equal(error.reason, "unavailable");
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test("Docker cancellation is classified and pre-aborted calls never start a process", async () => {
  const controller = new AbortController();
  const fixture = processFixture(() => controller.abort());
  await assert.rejects(dockerCommand(["fixture"], { signal: controller.signal }, fixture.start), reasonIs("cancelled"));
  const neverStart = (() => { throw new Error("Unexpected process creation"); }) as typeof spawn;
  await assert.rejects(dockerCommand(["fixture"], { signal: controller.signal }, neverStart), reasonIs("cancelled"));
});
