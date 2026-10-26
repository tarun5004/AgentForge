// CLI checkpoints use real HTTP/UI/DB/Docker. Only the upstream AI transport is deterministic.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { phase: 0, token: null, projectId: null, generations: [], firstRequest: null,
      runs: new Map(), refreshes: 0, pageErrors: 0, externalRequests: 0, observerErrors: 0 };
    const observations = new Set();
    page.on('pageerror', () => { state.pageErrors++; });
    // A zero-cost test must not accidentally contact a provider through browser navigation.
    await page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
      state.externalRequests++;
      return route.abort();
    });
    page.on('response', response => {
      const observed = (async () => {
        const request = response.request();
        const path = new URL(response.url()).pathname;
        if (!response.ok() || !path.startsWith('/api/')) return;
        if (['/api/auth/register', '/api/auth/refresh'].includes(path)) {
          state.token = (await response.json()).accessToken;
          if (path.endsWith('/refresh')) state.refreshes++;
        } else if (path === '/api/projects' && request.method() === 'POST') {
          state.projectId = (await response.json()).project.id;
        } else if (/^\/api\/projects\/[a-f\d]{24}(?:\/brief\/[a-f\d]{24})?\/generations$/.test(path) && request.method() === 'POST') {
          state.generations.push((await response.json()).generation);
          state.firstRequest ??= { path, key: request.headers()['idempotency-key'], body: request.postData() };
        } else if (path.startsWith('/api/runs')) {
          const { run } = await response.json();
          if (run) state.runs.set(run.id, run);
          if (path === '/api/runs' && request.method() === 'POST') {
            const input = request.postDataJSON();
            if (input.projectId !== state.projectId || Object.keys(input).sort().join(',') !== 'projectId,revisionId') {
              throw new Error('Preview must submit saved IDs only.');
            }
          }
        }
      })().catch(() => { state.observerErrors++; });
      observations.add(observed);
      void observed.finally(() => observations.delete(observed));
    });
    // Tokens/capabilities remain in this private runner closure, never CLI output or screenshots.
    await page.exposeFunction('previewRealEvidence', async (checkpoint) => {
      await Promise.all([...observations]);
      if (state.pageErrors || state.observerErrors || state.externalRequests) throw new Error('Unexpected browser/transport error.');
      const headers = { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' };
      const base = `http://127.0.0.1:4311/api/projects/${state.projectId}`;
      if (checkpoint === 'selection') return { phase: state.phase, projectId: state.projectId, revisionId: state.generations[0]?.revisionId };
      const first = state.generations[0];
      if (!state.token || !first || first.revisionVersion !== 1) throw new Error('Missing real saved v1.');
      const saved = await fetch(`${base}/revisions/${first.revisionId}`, { headers });
      if (!saved.ok || JSON.stringify((await saved.json()).revision.files) !== JSON.stringify(first.files)) throw new Error('Saved v1 changed or could not be read.');
      if (checkpoint === 'first') {
        if (![...state.runs.values()].some(run => run.state === 'ready' && run.revisionId === first.revisionId)) throw new Error('No real ready preview observed.');
        const registration = await fetch('http://127.0.0.1:4310/api/auth/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Other preview owner', email: 'revision-loop-other@agentforge.test', password: 'Disposable-test-password-13' }),
        });
        if (registration.status !== 201) throw new Error('Second test account failed.');
        const foreignHeaders = { Authorization: `Bearer ${(await registration.json()).accessToken}`, 'Content-Type': 'application/json' };
        const run = [...state.runs.values()].find(item => item.state === 'ready');
        for (const [path, method, body] of [['', 'POST', JSON.stringify({ projectId: state.projectId, revisionId: first.revisionId })],
          [`/${run.id}`, 'GET'], [`/${run.id}`, 'DELETE']]) {
          const response = await fetch(`http://127.0.0.1:5310/api/runs${path}`, { method, headers: foreignHeaders, ...(body ? { body } : {}) });
          if (response.status !== 404) throw new Error('Foreign owner accessed another user preview.');
        }
        const anonymous = await fetch(`http://127.0.0.1:5310/api/runs/${run.id}`);
        if (anonymous.status !== 401) throw new Error('Run API lost authentication.');
      } else if (checkpoint === 'final') {
        if (!state.refreshes || state.generations.length !== 2) throw new Error('Refresh regenerated or failed to restore the session.');
        if (![...state.runs.values()].some(run => run.state === 'failed' && run.errorCode === 'BUILD_FAILED')) throw new Error('Broken source did not produce a real build failure.');
        if (![...state.runs.values()].some(run => run.state === 'cancelled' && run.revisionId === first.revisionId)) throw new Error('Stop was not acknowledged.');
        const replay = await fetch(`http://127.0.0.1:4311${state.firstRequest.path}`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': state.firstRequest.key },
          ...(state.firstRequest.body ? { body: state.firstRequest.body } : {}) });
        if (replay.status !== 201 || (await replay.json()).generation.revisionId !== first.revisionId) throw new Error('Same-key replay lost v1.');
      }
      const fixture = await (await fetch('http://127.0.0.1:4312/__fixture')).json();
      const final = checkpoint === 'final';
      if (fixture.aiRequests.length !== (final ? 3 : 1) || fixture.counts.projects !== 1 || fixture.counts.revisions !== (final ? 2 : 1) ||
          fixture.counts.generations !== (final ? 3 : 1) || fixture.counts.users !== 2 || !fixture.previewEnabled) throw new Error('Unexpected fixture calls or persisted counts.');
      if (final && fixture.aiRequests.slice(1).some(item => item.baseVersion !== 1 || !item.baseMatchesInitial)) throw new Error('Wrong follow-up base reached AI.');
      state.phase++;
      return { checkpoint, passed: true };
    });
    return;
  }

  const selection = await page.evaluate(() => window.previewRealEvidence('selection'));
  const prompt = page.getByRole('textbox', { name: 'Message AgentForge' });
  const dialog = page.getByRole('dialog', { name: 'Saved revision preview' });
  if (selection.phase === 0) {
    await prompt.fill('Build a portfolio website page');
    // Covers keyboard submission through the real authenticated Project API.
    await prompt.press('Enter');
    await page.getByText('Viewing v1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = dialog.frameLocator('iframe');
    await frame.getByRole('heading', { name: 'Zero-cost portfolio preview' }).waitFor({ timeout: 150_000 });
    await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
    await frame.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
    if (await dialog.locator('iframe').getAttribute('sandbox') !== 'allow-scripts') throw new Error('Unsafe iframe sandbox.');
    await page.evaluate(() => window.previewRealEvidence('first'));
    // Leave the working iframe visible for the checkpoint screenshot and refresh test.
    return;
  }

  if (selection.phase !== 1) throw new Error('Unexpected preview checkpoint.');
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await prompt.fill('Return invalid output for this change');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Code generation failed.' }).waitFor();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await prompt.fill('Return broken preview syntax for this change');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'Build failed.' }).waitFor({ timeout: 150_000 });
  if (await dialog.locator('iframe').count()) throw new Error('Failed build published an iframe.');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await page.locator('summary[aria-label="Revision history"]').click();
  await page.getByRole('button', { name: 'v1 Build a portfolio website page Initial saved portfolio snapshot', exact: true }).click();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.frameLocator('iframe').getByRole('button', { name: 'Count 0', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Stop preview' }).click();
  await dialog.getByRole('status').filter({ hasText: 'Preview stopped.' }).waitFor();
  if (await dialog.locator('iframe').count()) throw new Error('Stopped preview retained iframe.');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await page.evaluate(() => window.previewRealEvidence('final'));
}
