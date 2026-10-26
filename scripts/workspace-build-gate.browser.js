// Real browser/HTTP/Mongo/Docker gate loop. Only the paid model response is a transport fixture.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { phase: 0, token: null, projectId: null, accepted: [], statuses: new Map(), runs: new Map(),
      firstRequest: null, refreshes: 0, errors: 0, external: 0 };
    const observations = new Set();
    page.on('pageerror', () => { state.errors++; });
    await page.context().route('**/*', route => {
      if (['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)) return route.continue();
      state.external++; return route.abort();
    });
    page.on('response', response => {
      const observed = (async () => {
        if (!response.ok()) return;
        const path = new URL(response.url()).pathname;
        const request = response.request();
        if (['/api/auth/register', '/api/auth/refresh'].includes(path)) {
          state.token = (await response.json()).accessToken;
          if (path.endsWith('/refresh')) state.refreshes++;
        } else if (path === '/api/projects' && request.method() === 'POST') {
          state.projectId = (await response.json()).project.id;
        } else if (/^\/api\/projects\/[a-f\d]{24}(?:\/brief\/[a-f\d]{24})?\/generations$/.test(path) && request.method() === 'POST') {
          const generation = (await response.json()).generation;
          if (response.status() !== 202 || generation.status !== 'pending' || generation.revisionId || generation.files) throw new Error('Expected an unpublished 202 candidate.');
          state.accepted.push(generation.id);
          state.firstRequest ??= { path, key: request.headers()['idempotency-key'], body: request.postData() };
        } else if (/^\/api\/projects\/[a-f\d]{24}\/generations\/[a-f\d]{24}$/.test(path)) {
          const generation = (await response.json()).generation;
          state.statuses.set(generation.id, generation);
        } else if (path.startsWith('/api/runs')) {
          const { run } = await response.json();
          if (run) state.runs.set(run.id, run);
          if (path === '/api/runs' && request.method() === 'POST' && Object.keys(request.postDataJSON()).sort().join(',') !== 'projectId,revisionId') throw new Error('Preview submitted more than saved IDs.');
        }
      })().catch(() => { state.errors++; });
      observations.add(observed);
      void observed.finally(() => observations.delete(observed));
    });
    // Controls are test-only Node-side HTTP calls; credentials stay private, not in CLI output.
    await page.exposeFunction('buildGateAction', async action => {
      const response = await fetch(`http://127.0.0.1:4312/__fixture/${action}`, { method: 'POST' });
      if (!response.ok) throw new Error('Fixture barrier rejected.');
    });
    await page.exposeFunction('buildGateEvidence', async checkpoint => {
      await Promise.all([...observations]);
      if (state.errors || state.external) throw new Error('Unexpected browser/transport error.');
      if (checkpoint === 'selection') return { phase: state.phase };
      const headers = { authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' };
      const base = `http://127.0.0.1:4311/api/projects/${state.projectId}`;
      let fixture = await (await fetch('http://127.0.0.1:4312/__fixture')).json();
      // Observe the actual held state, not an assumed delay between HTTP acceptance and worker admission.
      if (checkpoint === 'pending') {
        const deadline = Date.now() + 5_000;
        while (!fixture.checks?.held && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
          fixture = await (await fetch('http://127.0.0.1:4312/__fixture')).json();
        }
      }
      if (!fixture.buildGateEnabled || !fixture.previewEnabled || fixture.counts.projects !== 1) throw new Error('Wrong fixture mode or project count.');
      if (checkpoint === 'pending') {
        if (state.accepted.length !== 1 || fixture.counts.revisions !== 0 || fixture.counts.generations !== 1 ||
            fixture.aiRequests.length !== 1 || !fixture.checks.held) throw new Error('Candidate published early, repeated AI or did not reach the check barrier.');
        const duplicate = await fetch(`http://127.0.0.1:4311${state.firstRequest.path}`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': state.firstRequest.key }, body: state.firstRequest.body });
        if (duplicate.status !== 202 || (await duplicate.json()).generation.id !== state.accepted[0]) throw new Error('Pending replay changed attempt.');
        return { checkpoint, passed: true };
      }
      const first = state.statuses.get(state.accepted[0]);
      if (first?.status !== 'ready' || first.revisionVersion !== 1 || first.buildVerification?.status !== 'build_passed') throw new Error('Missing committed build-verified v1.');
      const savedResponse = await fetch(`${base}/revisions/${first.revisionId}`, { headers });
      const saved = (await savedResponse.json()).revision;
      if (!savedResponse.ok || JSON.stringify(saved.files) !== JSON.stringify(first.files) ||
          JSON.stringify(saved.buildVerification) !== JSON.stringify(first.buildVerification)) throw new Error('Persisted v1 or proof changed.');
      if (checkpoint === 'first') {
        const registration = await fetch('http://127.0.0.1:4310/api/auth/register', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Other preview owner', email: 'revision-loop-other@agentforge.test', password: 'Disposable-test-password-13' }) });
        if (registration.status !== 201) throw new Error('Second account failed.');
        const foreignHeaders = { authorization: `Bearer ${(await registration.json()).accessToken}`, 'Content-Type': 'application/json' };
        const run = [...state.runs.values()].find(value => value.state === 'ready');
        if (!run || run.revisionId !== first.revisionId) throw new Error('No real ready preview.');
        for (const [path, method, body] of [['', 'POST', JSON.stringify({ projectId: state.projectId, revisionId: first.revisionId })], [`/${run.id}`, 'GET'], [`/${run.id}`, 'DELETE']]) {
          const response = await fetch(`http://127.0.0.1:5310/api/runs${path}`, { method, headers: foreignHeaders, ...(body ? { body } : {}) });
          if (response.status !== 404) throw new Error('Foreign owner accessed preview.');
        }
        if ((await fetch(`${base}/generations/${first.id}`, { headers: foreignHeaders })).status !== 404) throw new Error('Foreign owner accessed generation status.');
        if ((await fetch(`http://127.0.0.1:5310/api/runs/${run.id}`)).status !== 401) throw new Error('Anonymous preview API access.');
        if (fixture.aiRequests.length !== 1 || fixture.counts.revisions !== 1 || fixture.checks.completed !== 1) throw new Error('Wrong initial gate evidence.');
        state.phase = 1;
      } else if (checkpoint === 'final') {
        const failed = state.statuses.get(state.accepted[1]);
        if (failed?.status !== 'failed' || failed.errorCode !== 'BUILD_VERIFICATION_FAILED') throw new Error('Broken candidate did not fail verification.');
        if (!state.refreshes || state.accepted.length !== 2 || fixture.aiRequests.length !== 2 || fixture.counts.revisions !== 1 ||
            fixture.counts.generations !== 2 || fixture.counts.users !== 2 || fixture.checks.started !== 2 || fixture.checks.completed !== 1) throw new Error('Failure/reload changed saved history or repeated work.');
        const replay = await fetch(`http://127.0.0.1:4311${state.firstRequest.path}`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': state.firstRequest.key }, body: state.firstRequest.body });
        if (replay.status !== 201 || (await replay.json()).generation.revisionId !== first.revisionId) throw new Error('Ready replay lost original revision.');
        if (![...state.runs.values()].some(run => run.state === 'cancelled')) throw new Error('Stop not acknowledged.');
        if (fixture.aiRequests[1].baseVersion !== 1 || !fixture.aiRequests[1].baseMatchesInitial) throw new Error('Wrong base reached AI fixture.');
        state.phase = 2;
      }
      return { checkpoint, passed: true };
    });
    return;
  }

  const selection = await page.evaluate(() => window.buildGateEvidence('selection'));
  const prompt = page.getByRole('textbox', { name: 'Message AgentForge' });
  const dialog = page.getByRole('dialog', { name: 'Saved revision preview' });
  if (selection.phase === 0) {
    await page.evaluate(() => window.buildGateAction('hold-check'));
    await prompt.fill('Build a portfolio website page');
    await prompt.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Attempt accepted.' }).waitFor();
    await page.getByText('No generated files. Submit a prompt or choose a saved revision.', { exact: true }).waitFor();
    await page.evaluate(() => window.buildGateEvidence('pending'));
    await page.evaluate(() => window.buildGateAction('release-check'));
    await page.getByText('Viewing v1', { exact: true }).waitFor({ timeout: 180_000 });
    await page.getByText('Manifest checked · static build verified', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = dialog.frameLocator('iframe');
    await frame.getByRole('heading', { name: 'Zero-cost portfolio preview' }).waitFor({ timeout: 150_000 });
    await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
    await frame.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
    if (await dialog.locator('iframe').getAttribute('sandbox') !== 'allow-scripts') throw new Error('Unsafe iframe sandbox.');
    if (await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor) !== 'rgb(12, 34, 56)') throw new Error('Saved stylesheet did not reach the real iframe.');
    await page.evaluate(() => window.buildGateEvidence('first'));
    return;
  }
  if (selection.phase !== 1) throw new Error('Unexpected gate checkpoint.');
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await page.getByText('Manifest checked · static build verified', { exact: true }).waitFor();
  await prompt.fill('Return broken preview syntax for this change');
  await prompt.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Generation or build verification failed.' }).waitFor({ timeout: 180_000 });
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.frameLocator('iframe').getByRole('button', { name: 'Count 0', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Stop preview' }).click();
  await dialog.getByRole('status').filter({ hasText: 'Preview stopped.' }).waitFor();
  if (await dialog.locator('iframe').count()) throw new Error('Stopped iframe still mounted.');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await page.evaluate(() => window.buildGateEvidence('final'));
}
