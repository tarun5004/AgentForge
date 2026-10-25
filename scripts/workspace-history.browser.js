// CLI function expression: test-only JavaScript, with no export or trailing semicolon.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { step: 0, expired: false, projectPages: 0, revisionPages: 0, rejectedReads: 0, unexpected: 0, pageErrors: 0 };
    const projectId = '100000000000000000000001';
    const revisionIds = ['', '200000000000000000000001', '200000000000000000000002', '200000000000000000000003'];
    const date = '2026-10-12T00:00:00.000Z';
    const project = {
      id: projectId, name: 'History demo', initialPrompt: 'Build a simple frontend page',
      template: 'nextjs', status: 'ready', createdAt: date,
      latestRevision: { id: revisionIds[3], version: 3 },
    };
    const draft = { ...project, id: '100000000000000000000002', name: 'Draft demo', status: 'draft', latestRevision: null };

    // History rows omit file content, just like the public summary contract.
    function summary(version) {
      return {
        id: revisionIds[version], projectId, generationId: `30000000000000000000000${version}`, version,
        summary: `Snapshot v${version}`, sourcePrompt: `Saved change v${version}`,
        parentRevisionId: version > 1 ? revisionIds[version - 1] : null,
        createdAt: date, updatedAt: date,
      };
    }
    const snapshot = {
      ...summary(3), files: [{ path: 'app/page.tsx', content: 'export default function Page() { return <h1>Version three fixture</h1>; }' }],
      fileChanges: [{ path: 'app/page.tsx', status: 'M' }],
      provider: 'test-transport', model: 'fixture-not-a-real-model',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, latencyMs: 5,
      validation: { policyVersion: 'frontend-manifest-v1', status: 'manifest_validated' }, schemaVersion: 2,
    };

    // Test-owned state survives navigation; none of these functions alter app state.
    await page.exposeFunction('workspaceHistorySmokeState', () => ({ ...state }));
    await page.exposeFunction('completeWorkspaceHistoryCheck', () => { state.step += 1; });
    await page.exposeFunction('expireWorkspaceHistorySession', () => { state.expired = true; });
    page.on('pageerror', () => { state.pageErrors += 1; });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const address = new URL(request.url());
      const path = address.pathname;
      if (path === '/api/auth/refresh' && request.method() === 'POST') {
        await route.fulfill(state.expired ? { status: 401, json: { message: 'Session expired.' } } : { json: {
          user: { id: '400000000000000000000001', name: 'History fixture', email: 'history@example.test' },
          accessToken: 'test-only-not-a-valid-jwt',
        } });
        return;
      }
      // Block every write and unknown path; no request reaches a real backend/provider.
      if (path.endsWith('/brief') && request.method() === 'GET') return route.fulfill({ json: { brief: null } });
      if (request.method() !== 'GET' || !path.startsWith('/api/projects')) {
        state.unexpected += 1; await route.abort(); return;
      }
      if (state.expired) {
        state.rejectedReads += 1;
        await route.fulfill({ status: 401, json: { message: 'Session expired.', code: 'UNAUTHORIZED' } });
      } else if (path === '/api/projects' && address.searchParams.get('limit') === '20') {
        const cursor = address.searchParams.get('cursor');
        if (cursor === null) {
          await route.fulfill({ json: { projects: [project], nextCursor: 'project-page-2' } });
        } else if (cursor === 'project-page-2') {
          state.projectPages += 1;
          // Deliberately overlapping fixtures verify the sidebar's defensive deduplication.
          await route.fulfill({ json: { projects: [project, draft], nextCursor: null } });
        } else { state.unexpected += 1; await route.abort(); }
      } else if (path === `/api/projects/${projectId}`) {
        await route.fulfill({ json: { project } });
      } else if (path === `/api/projects/${projectId}/revisions` && address.searchParams.get('limit') === '20') {
        const cursor = address.searchParams.get('beforeVersion');
        if (cursor === null) {
          await route.fulfill({ json: { revisions: [summary(3), summary(2)], nextCursor: '2' } });
        } else if (cursor === '2') {
          state.revisionPages += 1;
          await route.fulfill({ json: { revisions: [summary(2), summary(1)], nextCursor: null } });
        } else { state.unexpected += 1; await route.abort(); }
      } else if (path === `/api/projects/${projectId}/revisions/${revisionIds[3]}`) {
        await route.fulfill({ json: { revision: snapshot } });
      } else { state.unexpected += 1; await route.abort(); }
    });
    return;
  }

  const state = await page.evaluate(() => window.workspaceHistorySmokeState());
  const history = page.getByRole('region', { name: 'Revision history' });
  if (state.step === 0) {
    await page.locator('summary[aria-label="Saved conversations"]').click();
    await page.getByRole('button', { name: 'History demo v3', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load more projects', exact: true }).waitFor();
    if (await page.getByRole('button', { name: 'Draft demo Draft', exact: true }).count()) {
      throw new Error('Second project must not appear before loading its page.');
    }
  } else if (state.step === 1) {
    await page.getByRole('button', { name: 'Draft demo Draft', exact: true }).waitFor();
    if (await page.getByRole('button', { name: 'History demo v3', exact: true }).count() !== 1 ||
        await page.getByRole('button', { name: 'Load more projects', exact: true }).count()) {
      throw new Error('Project pages must append without duplicates and hide the exhausted cursor.');
    }
  } else if (state.step === 2) {
    await page.locator('summary[aria-label="Revision history"]').click();
    await history.getByText('Saved change v2', { exact: true }).waitFor();
    await page.getByText('export default function Page() { return <h1>Version three fixture</h1>; }', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load older revisions', exact: true }).waitFor();
    if (await history.getByText('Saved change v1', { exact: true }).count()) {
      throw new Error('Older history must not appear before its page is loaded.');
    }
  } else if (state.step === 3) {
    await history.getByText('Saved change v1', { exact: true }).waitFor();
    const labels = await history.getByRole('button').allTextContents();
    if (labels.length !== 3 || !labels[0].startsWith('v3') || !labels[1].startsWith('v2') || !labels[2].startsWith('v1') ||
        await page.getByRole('button', { name: 'Load older revisions', exact: true }).count()) {
      throw new Error('History must remain ordered, deduplicated and bounded after load-more.');
    }
  } else if (state.step === 4) {
    await page.getByRole('heading', { name: 'Sign in to AgentForge', exact: true }).waitFor({ timeout: 8000 });
    if (new URL(page.url()).pathname !== '/login' ||
        await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).count() || state.rejectedReads !== 1) {
      throw new Error('A protected 401 must stay on login, clear the workspace and never bounce/retry.');
    }
  } else { throw new Error('Unexpected extra history check.'); }

  const checked = await page.evaluate(() => window.workspaceHistorySmokeState());
  if (checked.unexpected || checked.pageErrors ||
      (state.step >= 1 && checked.projectPages !== 1) || (state.step >= 3 && checked.revisionPages !== 1)) {
    throw new Error('Unexpected API/page error or incorrect pagination cursor requests.');
  }
  await page.evaluate(() => window.completeWorkspaceHistoryCheck());
}
