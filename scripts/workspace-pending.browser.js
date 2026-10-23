// CLI-only UI contract checks; all API transport is intercepted before entering the workspace.
async (page) => {
  if (page.url() === 'about:blank') {
    const id = '100000000000000000000001';
    const ids = ['200000000000000000000001', '200000000000000000000002'];
    const attempts = ['300000000000000000000002', '300000000000000000000003', '300000000000000000000004'];
    const date = '2026-10-23T00:00:00.000Z';
    const state = { head: 1, mode: 'success', released: false, posts: [], reads: 0, unexpected: 0, errors: 0 };
    const proof = { status: 'build_passed', policyVersion: 'next-static-build-v1', snapshotHash: 'a'.repeat(64),
      runnerImageId: `sha256:${'b'.repeat(64)}`, checkId: '12345678-1234-1234-1234-123456789abc', completedAt: date };
    const project = () => ({ id, name: 'Pending gate fixture', initialPrompt: 'Build a frontend page', template: 'nextjs', status: 'ready',
      createdAt: date, updatedAt: date, latestRevision: { id: ids[state.head - 1], version: state.head } });
    const revision = version => ({ id: ids[version - 1], projectId: id, generationId: version === 1 ? '300000000000000000000001' : attempts[0], version,
      summary: `Saved revision ${version}`, parentRevisionId: version === 1 ? null : ids[0], sourcePrompt: 'Build a frontend page', createdAt: date, updatedAt: date,
      files: [{ path: 'app/page.tsx', content: version === 1 ? 'ORIGINAL_CODE_MARKER' : 'VERIFIED_CODE_MARKER' }], fileChanges: [], provider: 'fixture', model: 'fixture',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1,
      validation: { policyVersion: 'frontend-manifest-v1', status: 'manifest_validated' }, schemaVersion: 2, buildVerification: version === 2 ? proof : null });
    page.on('pageerror', () => { state.errors++; });
    await page.exposeFunction('pendingGateState', () => ({ ...state }));
    await page.exposeFunction('pendingGateControl', change => Object.assign(state, change));
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/auth/refresh') return route.fulfill({ json: { accessToken: 'pending-fixture-token', user: { id: '400000000000000000000001', name: 'Pending fixture', email: 'pending@example.test' } } });
      if (path === '/api/projects') return route.fulfill({ json: { projects: [project()], nextCursor: null } });
      if (path === `/api/projects/${id}`) return route.fulfill({ json: { project: project() } });
      if (path === `/api/projects/${id}/revisions`) return route.fulfill({ json: { revisions: Array.from({ length: state.head }, (_, index) => revision(state.head - index)), nextCursor: null } });
      if (path.startsWith(`/api/projects/${id}/revisions/`)) return route.fulfill({ json: { revision: revision(path.endsWith(ids[0]) ? 1 : 2) } });
      const attempt = state.mode === 'success' ? attempts[0] : state.mode === 'failed' ? attempts[1] : attempts[2];
      const pending = { id: attempt, status: 'pending', hasSavedResult: true, errorCode: null };
      if (path === `/api/projects/${id}/generations` && request.method() === 'POST') {
        state.posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
        return route.fulfill({ status: 202, json: { generation: pending } });
      }
      if (path === `/api/projects/${id}/generations/${attempt}` && request.method() === 'GET') {
        state.reads++;
        if (state.mode === 'outage') return route.fulfill({ status: 503, json: { message: 'Status temporarily unavailable.' } });
        if (!state.released) return route.fulfill({ json: { generation: pending } });
        if (state.mode === 'failed') return route.fulfill({ json: { generation: { ...pending, status: 'failed', errorCode: 'BUILD_VERIFICATION_FAILED' } } });
        state.head = 2;
        const saved = revision(2);
        return route.fulfill({ json: { generation: { ...saved, id: attempt, status: 'ready', revisionId: saved.id, revisionVersion: 2 } } });
      }
      state.unexpected++;
      return route.abort();
    });
    return;
  }

  const prompt = page.getByRole('textbox', { name: 'Describe a frontend page or change' });
  const state = () => page.evaluate(() => window.pendingGateState());
  const control = change => page.evaluate(value => window.pendingGateControl(value), change);
  // Inspect intent only, never print the browser session or generated source.
  const stored = () => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('agentforge:pending:')).map(key => JSON.parse(sessionStorage.getItem(key))));
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await prompt.fill('Make the saved frontend darker');
  await prompt.press('Enter');
  await page.getByRole('status').filter({ hasText: 'Attempt accepted.' }).waitFor();
  if (!(await page.locator('main').innerText()).includes('ORIGINAL_CODE_MARKER')) throw new Error('Pending work erased saved files.');
  if (await page.getByRole('button', { name: 'New conversation', exact: true }).isEnabled()) throw new Error('Pending identity was not frozen.');
  const intent = (await stored())[0];
  if (!intent?.generationId || !intent.key || 'accessToken' in intent) throw new Error('Accepted identity was not safely retained.');
  await control({ released: true });
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  await page.getByText('Manifest checked · static build verified', { exact: true }).waitFor();
  if ((await state()).posts.length !== 1 || (await stored()).length) throw new Error('Ready completion repeated POST or retained a completed intent.');
  await page.reload();
  await page.getByText('Viewing v2', { exact: true }).waitFor();

  await control({ mode: 'failed', released: false, posts: [], reads: 0 });
  await prompt.fill('Build a change that fails verification');
  await prompt.press('Enter');
  await page.getByRole('status').filter({ hasText: 'Attempt accepted.' }).waitFor();
  await control({ released: true });
  await page.getByRole('alert').filter({ hasText: 'Generation or build verification failed.' }).waitFor();
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  if ((await stored()).length || (await state()).posts.length !== 1) throw new Error('Terminal failure corrupted intent or retried AI.');

  await control({ mode: 'outage', released: false, posts: [], reads: 0 });
  await prompt.fill('Keep this attempt during a status outage');
  await prompt.press('Enter');
  await page.getByRole('button', { name: 'Check status', exact: true }).waitFor();
  const uncertain = (await stored())[0];
  await page.reload();
  await page.getByRole('button', { name: 'Check status', exact: true }).waitFor();
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  const restored = (await stored())[0];
  if (restored?.key !== uncertain?.key || restored?.generationId !== uncertain?.generationId) throw new Error('Refresh lost pending identity.');
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Status temporarily unavailable.' }).waitFor();
  const final = await state();
  if (final.posts.length !== 1 || final.unexpected || final.errors || new URL(page.url()).pathname !== '/workspace') throw new Error('Pending checks retried generation, logged out or caused browser errors.');
}
