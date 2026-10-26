// Test-only CLI expression. All successful data comes from real Auth/Project/Mongo.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { step: 0, token: null, projects: [], results: [], posts: [], statuses: 0,
      errors: 0, uncertain: null, committed: null, inject: false, holdRead: false, readAborted: false };
    let releaseRead, readStarted, readFinished;
    const started = new Promise(resolve => { readStarted = resolve; });
    const finished = new Promise(resolve => { readFinished = resolve; });
    page.on('pageerror', () => { state.errors += 1; });
    // Observe keys and safe metadata privately, never print bearer tokens or change app state.
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/projects\/[^/]+(?:\/brief\/[^/]+)?\/generations$/.test(new URL(request.url()).pathname)) {
        state.posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      }
    });
    page.on('requestfailed', request => {
      if (state.projects[0] && new URL(request.url()).pathname === `/api/projects/${state.projects[0]}` &&
          /aborted/i.test(request.failure()?.errorText ?? '')) state.readAborted = true;
    });
    // A proxy 503 is deliberately different from model rejection: its generation ID permits GET recovery.
    page.on('response', async response => {
      try {
        const path = new URL(response.url()).pathname;
        const method = response.request().method();
        if (method === 'POST' && response.ok() && ['/api/auth/register', '/api/auth/refresh'].includes(path)) state.token = (await response.json()).accessToken;
        else if (method === 'POST' && response.ok() && path === '/api/projects') state.projects.push((await response.json()).project.id);
        else if (method === 'POST' && /\/api\/projects\/[^/]+(?:\/brief\/[^/]+)?\/generations$/.test(path)) {
          const body = await response.json();
          if (response.status() === 201) state.results.push(body.generation);
          else if (response.status() === 503 && body.code === 'OUTCOME_UNKNOWN') state.uncertain = body;
          else state.errors += 1;
        } else if (method === 'GET' && /\/generations\/[^/]+$/.test(path)) {
          if (!response.ok() || (await response.json()).generation.id !== state.committed?.id) state.errors += 1;
          state.statuses += 1;
        }
      } catch { state.errors += 1; }
    });
    await page.route('**/api/projects/*/generations', async route => {
      if (!state.inject) { await route.continue(); return; }
      state.inject = false;
      const response = await route.fetch({ maxRetries: 0, timeout: 120_000 });
      if (response.status() !== 201) { state.errors += 1; await route.fulfill({ response }); return; }
      state.committed = (await response.json()).generation;
      await response.dispose();
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        message: 'Test proxy lost the successful acknowledgement.', code: 'OUTCOME_UNKNOWN', generationId: state.committed.id,
      }) });
    });
    // Delay a real A read while the user selects B; no synthetic project/revision data is supplied.
    await page.route('**/api/projects/*', async route => {
      if (!state.holdRead || route.request().method() !== 'GET' ||
          new URL(route.request().url()).pathname !== `/api/projects/${state.projects[0]}`) { await route.continue(); return; }
      state.holdRead = false;
      const response = await route.fetch();
      const release = new Promise(resolve => { releaseRead = resolve; });
      readStarted();
      await release;
      try { await route.fulfill({ response }); }
      catch { if (!state.readAborted) state.errors += 1; }
      finally { await response.dispose(); readFinished(); }
    });
    // Test controls target only the loopback fixture. They never write React/sessionStorage state.
    await page.exposeFunction('workspaceStateAction', async action => {
      const control = async path => {
        const response = await fetch(`http://127.0.0.1:4312/__fixture/${path}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('Fixture barrier control failed.');
      };
      if (action === 'arm-generation') { state.inject = true; await control('hold-next'); }
      else if (action === 'wait-pending') {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const status = await (await fetch('http://127.0.0.1:4312/__fixture', { signal: AbortSignal.timeout(2000) })).json();
          if (status.heldGeneration) return;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw new Error('AI request never reached the test barrier.');
      } else if (action === 'release-generation') await control('release');
      else if (action === 'arm-read') state.holdRead = true;
      else if (action === 'wait-read') await started;
      else if (action === 'release-read') { if (!releaseRead) throw new Error('No held read.'); releaseRead(); await finished; }
      else throw new Error('Unknown state test action.');
    });
    await page.exposeFunction('workspaceStateSelection', () => ({ step: state.step, projectId: state.projects[state.step >= 6 ? 1 : 0] }));
    // Counts and exact saved files distinguish real recovery from a merely plausible screen.
    await page.exposeFunction('verifyWorkspaceState', async () => {
      if (state.errors || !state.token || !state.results[0]) throw new Error('Observer failure or missing real generation.');
      const pending = state.step >= 1 && state.step <= 3;
      const expectedAttempts = state.step === 0 ? 1 : state.step < 6 ? 2 : 3;
      const expectedRevisions = pending ? 1 : expectedAttempts;
      const response = await fetch('http://127.0.0.1:4312/__fixture', { signal: AbortSignal.timeout(10_000) });
      const fixture = await response.json();
      if (fixture.counts.users !== 1 || fixture.counts.projects !== (state.step < 6 ? 1 : 2) ||
          fixture.counts.generations !== expectedAttempts || fixture.counts.revisions !== expectedRevisions ||
          fixture.aiRequests.length !== expectedAttempts || fixture.heldGeneration !== pending || state.posts.length !== expectedAttempts) {
        throw new Error('Duplicate attempt, unexpected publication or lost in-flight identity.');
      }
      if (state.step >= 1 && (state.posts[1].body.baseRevisionId !== state.results[0].revisionId ||
          state.posts[1].key === state.posts[0].key || !fixture.aiRequests[1].baseMatchesInitial)) throw new Error('Frozen selected base/key changed.');
      if (state.step >= 4 && (!state.uncertain || state.uncertain.generationId !== state.committed?.id)) throw new Error('Uncertain attempt identity missing.');
      if (state.step >= 5 && (state.statuses !== 1 || state.committed.revisionVersion !== 2 ||
          state.committed.parentRevisionId !== state.results[0].revisionId)) throw new Error('Status GET did not recover the actual revision.');
      const saved = await fetch(`http://127.0.0.1:4311/api/projects/${state.projects[0]}/revisions/${state.results[0].revisionId}`, {
        headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!saved.ok || JSON.stringify((await saved.json()).revision.files) !== JSON.stringify(state.results[0].files)) throw new Error('Old snapshot changed.');
      if (state.step >= 6 && (state.projects.length !== 2 || state.results.length !== 2)) throw new Error('Expected a distinct saved project B.');
      state.step += 1;
    });
    return;
  }
  const selection = await page.evaluate(() => window.workspaceStateSelection());
  if (selection.step > 8) throw new Error('Unexpected state checkpoint.');
  if (selection.step === 1) {
    // Keep reflows in one operation: repeated CLI startup is not part of the app's AI deadline.
    for (const width of [1440, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.getByRole('separator').first().waitFor({ state: width === 390 ? 'detached' : 'visible' });
      await page.getByText('Viewing v1', { exact: true }).waitFor();
      for (const button of ['New conversation', 'Send message', 'Sign out']) {
        if (await page.getByRole('button', { name: button, exact: true }).isEnabled()) throw new Error('In-flight controls must stay frozen.');
      }
      const prompt = page.getByRole('textbox', { name: 'Message AgentForge' });
      if (await prompt.isEnabled() || await prompt.inputValue() !== 'Make the hero darker and remove old component') throw new Error('In-flight prompt changed.');
      await page.evaluate(() => window.verifyWorkspaceState());
      if (width === 390) await page.screenshot({ path: `output/playwright/state-mobile-${Date.now()}.png`, fullPage: true });
    }
    return;
  }
  const pending = selection.step >= 1 && selection.step <= 3;
  const version = selection.step === 5 ? 2 : 1;
  await page.getByText(`Viewing v${version}`, { exact: true }).waitFor();
  if (pending) {
    for (const button of ['New conversation', 'Send message', 'Sign out']) {
      if (await page.getByRole('button', { name: button, exact: true }).isEnabled()) throw new Error('In-flight controls must stay frozen.');
    }
    if (await page.getByRole('textbox', { name: 'Message AgentForge' }).isEnabled()) throw new Error('Prompt changed during generation.');
  } else if (selection.step === 4) {
    await page.getByRole('button', { name: 'Check status', exact: true }).waitFor();
  } else {
    await page.getByRole('textbox', { name: 'Message AgentForge' }).fill('An unsent verification draft');
    if (await page.getByRole('button', { name: 'Check status', exact: true }).count()) throw new Error('Completed state still shows pending controls.');
  }
  if (!pending) {
    const expected = selection.step === 5 ? 'Revised portfolio 2' : 'Initial portfolio';
    await page.getByText(`export default function Page() { return <main>${expected}</main>; }`, { exact: true }).waitFor();
    if (new URL(page.url()).searchParams.get('project') !== selection.projectId) throw new Error('Stale project selection overwrote the URL.');
  }
  await page.evaluate(() => window.verifyWorkspaceState());
}
