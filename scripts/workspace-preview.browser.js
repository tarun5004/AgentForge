// CLI fixture intercepts every API before navigation: no provider, real account or DB is used.
async (page) => {
  if (page.url() === 'about:blank') {
    const projectId = '100000000000000000000001';
    const revisionId = '200000000000000000000001';
    const id = '11111111-1111-4111-8111-111111111111';
    const date = '2026-10-22T00:00:00Z';
    const project = { id: projectId, name: 'Preview fixture', initialPrompt: 'Build a frontend page', template: 'nextjs', status: 'ready', createdAt: date, latestRevision: { id: revisionId, version: 1 } };
    const summary = { id: revisionId, projectId, generationId: '300000000000000000000001', version: 1, summary: 'Saved fixture', parentRevisionId: null, sourcePrompt: 'Build a frontend page', createdAt: date, updatedAt: date };
    const revision = { ...summary, files: [{ path: 'app/page.tsx', content: 'export default function Page() { return <h1>Saved fixture</h1> }' }], fileChanges: [], provider: null, model: null, usage: null, latencyMs: null, validation: null, schemaVersion: null };
    const state = { mode: 'ready', stopped: false, unexpected: 0, pageErrors: 0, starts: 0, stops: 0 };
    const previewUrl = `http://127.0.0.1:5101/preview/${id}/${'a'.repeat(48)}/`;
    await page.exposeFunction('previewFixtureMode', mode => { state.mode = mode; state.stopped = false; });
    await page.exposeFunction('previewFixtureState', () => ({ ...state }));
    page.on('pageerror', () => { state.pageErrors++; });
    await page.route('http://127.0.0.1:5101/preview/**', route => route.fulfill({
      contentType: 'text/html', body: '<h1>Fixture static preview</h1>',
      headers: { 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'" },
    }));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/auth/refresh') return route.fulfill({ json: { user: { id: '400000000000000000000001', name: 'Preview tester', email: 'preview@example.test' }, accessToken: 'fixture-token' } });
      if (request.method() === 'GET') {
        if (path.endsWith('/brief')) return route.fulfill({ json: { brief: null } });
        if (path === '/api/projects') return route.fulfill({ json: { projects: [project], nextCursor: null } });
        if (path === `/api/projects/${projectId}`) return route.fulfill({ json: { project } });
        if (path === `/api/projects/${projectId}/revisions`) return route.fulfill({ json: { revisions: [summary], nextCursor: null } });
        if (path === `/api/projects/${projectId}/revisions/${revisionId}`) return route.fulfill({ json: { revision } });
      }
      if (path.startsWith('/api/runs')) {
        if (request.headers().authorization !== 'Bearer fixture-token') throw new Error('Missing preview auth.');
        let runState = 'building';
        let errorCode = null;
        let message = 'Fixture build in progress.';
        if (path === '/api/runs' && request.method() === 'POST') {
          state.starts++;
          const input = request.postDataJSON();
          if (input.projectId !== projectId || input.revisionId !== revisionId || Object.keys(input).length !== 2) throw new Error('Wrong preview target/body.');
        } else if (path === `/api/runs/${id}` && request.method() === 'DELETE') {
          state.stops++; state.stopped = true; runState = 'cancelling'; message = 'Waiting for cleanup.';
        } else if (request.method() !== 'GET' && !path.endsWith('/activity')) { state.unexpected++; return route.abort(); }
        if (state.mode === 'offline') return route.fulfill({ status: 503, json: { message: 'Fixture Execution Service offline.' } });
        if (state.mode === 'unclean') { runState = 'failed'; errorCode = 'CLEANUP_UNCONFIRMED'; message = 'Operator review: cleanup unconfirmed.'; }
        else if (state.stopped && request.method() === 'GET') { runState = 'cancelled'; message = 'Cancellation confirmed.'; }
        else if (state.mode === 'ready' && request.method() === 'GET') { runState = 'ready'; message = 'Fixture build passed.'; }
        return route.fulfill({ json: { run: { id, projectId, revisionId, state: runState, errorCode, message, createdAt: date, previewUrl: runState === 'ready' ? previewUrl : null } } });
      }
      state.unexpected++;
      return route.abort();
    });
    return;
  }

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Saved revision preview' });
  await dialog.frameLocator('iframe').getByRole('heading', { name: 'Fixture static preview' }).waitFor();
  const sandbox = await dialog.locator('iframe').getAttribute('sandbox');
  if (sandbox !== 'allow-scripts') throw new Error('Unsafe preview iframe sandbox.');
  await dialog.getByRole('button', { name: 'Close preview' }).click();

  await page.evaluate(() => window.previewFixtureMode('cancel'));
  await preview.click();
  await dialog.getByRole('button', { name: 'Stop preview' }).waitFor();
  if (!await dialog.getByRole('button', { name: 'Close preview' }).isDisabled()) throw new Error('Build must retain its identity until stopped.');
  await dialog.getByRole('button', { name: 'Stop preview' }).click();
  await dialog.getByRole('status').filter({ hasText: 'Cancellation confirmed.' }).waitFor();
  if (await dialog.locator('iframe').count()) throw new Error('Cancelled preview kept an iframe.');
  await dialog.getByRole('button', { name: 'Close preview' }).click();

  await page.evaluate(() => window.previewFixtureMode('offline'));
  await preview.click();
  await dialog.getByRole('alert').filter({ hasText: 'Fixture Execution Service offline.' }).waitFor();
  if (!new URL(page.url()).pathname.endsWith('/workspace')) throw new Error('503 must not log out the user.');
  await page.evaluate(() => window.previewFixtureMode('ready'));
  await dialog.getByRole('button', { name: 'Retry preview' }).click();
  await dialog.frameLocator('iframe').getByRole('heading', { name: 'Fixture static preview' }).waitFor();
  await dialog.getByRole('button', { name: 'Close preview' }).click();

  await page.evaluate(() => window.previewFixtureMode('unclean'));
  await preview.click();
  await dialog.getByRole('status').filter({ hasText: 'cleanup unconfirmed' }).waitFor();
  if (await dialog.getByRole('button', { name: 'Retry preview' }).count() || await dialog.locator('iframe').count()) throw new Error('Unconfirmed cleanup must not offer a blind retry/preview.');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  const state = await page.evaluate(() => window.previewFixtureState());
  if (state.unexpected || state.pageErrors || state.starts < 5 || state.stops !== 1) throw new Error('Unexpected traffic/errors or missing preview scenarios.');
}
