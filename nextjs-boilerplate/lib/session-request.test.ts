import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError, logout, refreshSession } from "./auth-api.ts";
import { requestWithSession, type SessionAccess } from "./session-request.ts";
import { generateProject, ProjectApiError } from "./project-api.ts";

// Exercise the production cookie-refresh helper, not a made-up retry algorithm.
function sessionAccess(): SessionAccess {
  return { getAccessToken: () => "expired", refreshAccessToken: async () => (await refreshSession()).accessToken };
}

const session = { user: { id: "owner", name: "Test", email: "test@example.test" }, accessToken: "fresh" };

test("logout waits for a rotating refresh cookie before revoking it", async (context) => {
  let finishRefresh!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finishRefresh = resolve; });
  let logouts = 0;
  context.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/auth/refresh") return pending;
    assert.equal(url, "/api/auth/logout");
    logouts++;
    return Response.json({});
  });
  const refreshing = refreshSession();
  const loggingOut = logout();
  assert.equal(logouts, 0);
  finishRefresh(Response.json(session));
  await Promise.all([refreshing, loggingOut]);
  assert.equal(logouts, 1);
});

test("401 refreshes once, then retries the exact body/key and original deadline", async (context) => {
  const calls: RequestInit[] = [];
  const controller = new AbortController();
  let refreshes = 0;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      assert.equal(init.credentials, "include");
      return Response.json(session);
    }
    calls.push(init);
    return new Headers(init.headers).get("Authorization") === "Bearer fresh"
      ? Response.json({ ok: true }) : Response.json({}, { status: 401 });
  });
  const init = { method: "POST", headers: { "Idempotency-Key": "same-attempt" }, body: '{"prompt":"Build a portfolio"}', signal: controller.signal };
  assert.equal((await requestWithSession("/api/projects/test/generations", sessionAccess(), init)).status, 200);
  assert.equal(refreshes, 1);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.body, init.body);
    assert.equal(call.signal, init.signal);
    assert.equal(new Headers(call.headers).get("Idempotency-Key"), "same-attempt");
  }
});

test("concurrent 401s share one rotating-cookie refresh", async (context) => {
  let refreshes = 0;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 15));
      return Response.json(session);
    }
    return Response.json({}, { status: new Headers(init.headers).get("Authorization") === "Bearer fresh" ? 200 : 401 });
  });
  const results = await Promise.all([requestWithSession("/api/projects/a", sessionAccess()), requestWithSession("/api/projects/b", sessionAccess())]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal(refreshes, 1);
});

test("a rejected refresh or rejected retry stays 401, without an infinite retry loop", async (context) => {
  for (const refreshStatus of [401, 200]) {
    let refreshes = 0;
    let projects = 0;
    context.mock.method(globalThis, "fetch", async (url: string) => {
      if (url === "/api/auth/refresh") { refreshes++; return Response.json(refreshStatus === 200 ? session : {}, { status: refreshStatus }); }
      projects++;
      return Response.json({}, { status: 401 });
    });
    assert.equal((await requestWithSession("/api/projects", sessionAccess())).status, 401);
    assert.equal(refreshes, 1);
    assert.equal(projects, refreshStatus === 200 ? 2 : 1);
    context.mock.restoreAll();
  }
});

test("server/network/invalid refresh responses do not masquerade as an expired session", async (context) => {
  for (const failure of ["server", "network", "invalid"] as const) {
    context.mock.method(globalThis, "fetch", async (url: string) => {
      if (url !== "/api/auth/refresh") return Response.json({}, { status: 401 });
      if (failure === "network") throw new TypeError("Test connection lost");
      return Response.json({}, { status: failure === "server" ? 503 : 200 });
    });
    await assert.rejects(requestWithSession("/api/projects", sessionAccess()), error => !(error instanceof AuthApiError && error.status === 401));
    context.mock.restoreAll();
  }
});

test("ordinary 502 and transport errors never trigger refresh", async (context) => {
  let refreshes = 0;
  const access = { getAccessToken: () => "valid", refreshAccessToken: async () => { refreshes++; return "fresh"; } };
  context.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 502 }));
  assert.equal((await requestWithSession("/api/projects", access)).status, 502);
  context.mock.method(globalThis, "fetch", async () => { throw new TypeError("Test offline"); });
  await assert.rejects(requestWithSession("/api/projects", access), /offline/);
  assert.equal(refreshes, 0);
});

test("an aborted read cannot rotate cookies or retry after cancellation", async (context) => {
  const controller = new AbortController();
  let refreshes = 0;
  const access = { getAccessToken: () => "expired", refreshAccessToken: async () => { refreshes++; return "fresh"; } };
  context.mock.method(globalThis, "fetch", async () => { controller.abort(); return Response.json({}, { status: 401 }); });
  await assert.rejects(requestWithSession("/api/projects", access, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(refreshes, 0);
});

test("public generation API refreshes with the same logical attempt and preserves upstream error codes", async (context) => {
  const keys: (string | null)[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url === "/api/auth/refresh") return Response.json(session);
    keys.push(new Headers(init.headers).get("Idempotency-Key"));
    return Response.json({ message: "Test AI unavailable", code: "AI_GENERATION_FAILED" }, { status: keys.length === 1 ? 401 : 502 });
  });
  await assert.rejects(generateProject("100000000000000000000001", sessionAccess(), "stable-attempt", { prompt: "Build a portfolio" }), error => error instanceof ProjectApiError && error.status === 502 && error.code === "AI_GENERATION_FAILED");
  assert.deepEqual(keys, ["stable-attempt", "stable-attempt"]);
});
