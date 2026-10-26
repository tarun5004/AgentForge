// Test-only CLI expression. Successful payloads always come from the real Project API.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { stage: 0, token: null, projectId: null, requests: [], successes: [], failed: null,
      lost: null, dropNext: false, drops: 0, errors: 0 };
    page.on('pageerror', () => { state.errors += 1; });
    // Capture identity privately; never expose tokens or alter application/storage state.
    page.on('request', request => {
      if (request.method() === 'POST' && /^\/api\/projects\/[a-f\d]{24}(?:\/brief\/[a-f\d]{24})?\/generations$/.test(new URL(request.url()).pathname)) {
        state.requests.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      }
    });
    // Keep actual successes separate from the expected 502 so a rejection cannot look committed.
    page.on('response', async response => {
      try {
        const path = new URL(response.url()).pathname;
        if (response.request().method() !== 'POST') return;
        if (response.ok() && ['/api/auth/register', '/api/auth/refresh'].includes(path)) state.token = (await response.json()).accessToken;
        else if (response.ok() && path === '/api/projects') state.projectId = (await response.json()).project.id;
        else if (/^\/api\/projects\/[a-f\d]{24}(?:\/brief\/[a-f\d]{24})?\/generations$/.test(path)) {
          const body = await response.json();
          if (response.status() === 201) state.successes.push(body.generation);
          else if (response.status() === 502 && state.stage === 1) state.failed = body;
          else state.errors += 1;
        }
      } catch { state.errors += 1; }
    });
    // Forward the real POST first. Drop only its committed 201 response, never fabricate success.
    await page.route('**/api/projects/*/generations', async route => {
      if (!state.dropNext) { await route.continue(); return; }
      state.dropNext = false;
      try {
        const response = await route.fetch({ maxRetries: 0 });
        if (response.status() !== 201) throw new Error('Expected a committed response before loss.');
        state.lost = (await response.json()).generation;
        state.drops += 1;
        await response.dispose();
      } catch { state.errors += 1; }
      await route.abort('failed');
    });
    // Arm one known request; unexpected calls must never consume the deliberate fault.
    await page.exposeFunction('armRecoveryResponseLoss', () => {
      if (state.stage !== 3 || state.dropNext || state.drops) throw new Error('Response loss armed at the wrong stage.');
      state.dropNext = true;
    });
    await page.exposeFunction('recoveryStage', () => state.stage);
    // Check persisted facts, not just success labels or an in-memory file list.
    await page.exposeFunction('verifyRecovery', async () => {
      if (state.errors || !state.token || !state.projectId) throw new Error('Browser/observer failure or missing real identity.');
      const first = state.successes[0];
      if (!first || first.revisionVersion !== 1) throw new Error('Initial revision not captured.');
      const base = `http://127.0.0.1:4311/api/projects/${state.projectId}`;
      const headers = { Authorization: `Bearer ${state.token}` };
      // Bounded reads keep an unavailable service from hanging the verification session.
      async function read(url) {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('Owned persisted read failed.');
        return response.json();
      }
      const [project, history, saved, fixture] = await Promise.all([
        read(base), read(`${base}/revisions`), read(`${base}/revisions/${first.revisionId}`),
        read('http://127.0.0.1:4312/__fixture'),
      ]);
      const expectedAttempts = state.stage === 0 ? 1 : state.stage <= 2 ? 2 : 3;
      const expectedRevisions = state.stage <= 2 ? 1 : 2;
      const expectedPosts = state.stage === 0 ? 1 : state.stage <= 2 ? 2 : state.stage <= 4 ? 3 : 4;
      if (fixture.counts.users !== 1 || fixture.counts.projects !== 1 || fixture.counts.generations !== expectedAttempts ||
          fixture.counts.revisions !== expectedRevisions || fixture.aiRequests.length !== expectedAttempts ||
          history.revisions.length !== expectedRevisions || project.project.latestRevision.version !== expectedRevisions ||
          state.requests.length !== expectedPosts || JSON.stringify(saved.revision.files) !== JSON.stringify(first.files)) {
        throw new Error('Unexpected persistence, model calls, browser POSTs or changed v1 snapshot.');
      }
      if (state.stage >= 1) {
        if (!state.failed?.generationId || !state.failed.code) throw new Error('Expected a real terminal AI failure.');
        const failed = await read(`${base}/generations/${state.failed.generationId}`);
        if (failed.generation.status !== 'failed' || failed.generation.hasSavedResult ||
            state.requests[1].body.baseRevisionId !== first.revisionId || state.requests[1].key === state.requests[0].key) {
          throw new Error('Failed attempt must be terminal, parent-scoped and unpublished.');
        }
      }
      if (state.stage >= 3) {
        if (state.drops !== 1 || state.dropNext || !state.lost || state.lost.revisionVersion !== 2 ||
            state.lost.parentRevisionId !== first.revisionId || state.requests[2].body.baseRevisionId !== first.revisionId ||
            new Set(state.requests.slice(0, 3).map(item => item.key)).size !== 3) {
          throw new Error('Response loss did not follow one independently committed v2 attempt.');
        }
        const v2 = (await read(`${base}/revisions/${state.lost.revisionId}`)).revision;
        if (JSON.stringify(v2.files) !== JSON.stringify(state.lost.files) || v2.parentRevisionId !== first.revisionId ||
            v2.files.some(file => file.path === 'components/Old.tsx') ||
            v2.files.find(file => file.path === 'app/globals.css')?.content !== first.files.find(file => file.path === 'app/globals.css')?.content ||
            !v2.fileChanges.some(change => change.path === 'components/Old.tsx' && change.status === 'D')) {
          throw new Error('Lost result must be persisted with a complete validated change snapshot.');
        }
        if (fixture.aiRequests[2].baseVersion !== 1 || !fixture.aiRequests[2].baseMatchesInitial) throw new Error('Wrong selected base sent to AI.');
      }
      if (state.stage >= 5) {
        if (state.successes.length !== 2 || state.successes[1].revisionId !== state.lost.revisionId ||
            JSON.stringify(state.successes[1].files) !== JSON.stringify(state.lost.files) ||
            state.requests[3].key !== state.requests[2].key ||
            JSON.stringify(state.requests[3].body) !== JSON.stringify(state.requests[2].body)) {
          throw new Error('Explicit retry changed its identity or duplicated the committed result.');
        }
      }
      state.stage += 1;
    });
    return;
  }

  const stage = await page.evaluate(() => window.recoveryStage());
  if (stage > 6) throw new Error('Unexpected recovery checkpoint.');
  const version = stage <= 4 ? 1 : 2;
  await page.getByText(`Viewing v${version}`, { exact: true }).waitFor();
  await page.getByText(`export default function Page() { return <main>${version === 1 ? 'Initial portfolio' : 'Revised portfolio 3'}</main>; }`, { exact: true }).waitFor();
  const prompt = page.getByRole('textbox', { name: 'Message AgentForge' });
  const retry = page.getByRole('button', { name: 'Retry same attempt', exact: true });
  if (stage === 3 || stage === 4) {
    await retry.waitFor();
    await page.getByText('Unconfirmed attempt retained: Make the hero darker and remove old component', { exact: true }).waitFor();
    if (await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled()) throw new Error('An uncertain attempt must block a new submission.');
  } else {
    // Waiting for an editable prompt also waits for canonical reads after refresh/error.
    await prompt.fill('A harmless draft that is never submitted');
    if (await retry.count()) throw new Error('Terminal/completed attempts must not show retry controls.');
    if (stage === 1) await page.getByRole('alert').filter({ hasText: 'Code generation failed.' }).waitFor();
  }
  await page.evaluate(() => window.verifyRecovery());
}
