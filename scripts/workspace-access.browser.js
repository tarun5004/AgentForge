// CLI function expression: test-only JavaScript, without an export or trailing semicolon.
async (page) => {
  const legacyId = '100000000000000000000001';
  const draftId = '100000000000000000000002';
  const unavailableId = '100000000000000000000099';
  const legacyRevisionId = '200000000000000000000001';
  const unavailableRevisionId = '200000000000000000000099';

  if (page.url() === 'about:blank') {
    const state = {
      legacyReads: 0, rejectedProjects: 0, rejectedRevisions: 0, unexpected: 0, pageErrors: 0,
      lastProjectCheck: 0, lastRevisionCheck: 0,
      checks: { legacy: 0, draft: 0, project404: 0, revision404: 0, recovery: 0 },
    };
    const date = '2026-10-12T00:00:00.000Z';
    const legacy = {
      id: legacyId, name: 'Legacy demo', initialPrompt: 'Build a simple frontend page',
      template: 'nextjs', status: 'ready', createdAt: date,
      latestRevision: { id: legacyRevisionId, version: 1 },
    };
    const draft = { ...legacy, id: draftId, name: 'Empty draft', status: 'draft', latestRevision: null };
    const summary = {
      id: legacyRevisionId, projectId: legacyId, generationId: '300000000000000000000001',
      version: 1, summary: 'Saved legacy snapshot', sourcePrompt: null, parentRevisionId: null,
      createdAt: date, updatedAt: date,
    };
    // Historical data stays readable without inventing missing provenance or change badges.
    const revision = {
      ...summary, files: [{ path: 'app/page.tsx', content: '// LEGACY_SNAPSHOT_ONLY\nexport default function Page() { return <h1>Legacy fixture</h1>; }' }],
      fileChanges: null, provider: null, model: null, usage: null,
      latencyMs: null, validation: null, schemaVersion: null,
    };
    await page.exposeFunction('workspaceAccessSmokeState', () => ({ ...state, checks: { ...state.checks } }));
    // Count each state so a redirect or skipped retry cannot falsely pass the whole suite.
    await page.exposeFunction('recordWorkspaceAccessCheck', (name) => {
      if (!Object.hasOwn(state.checks, name)) throw new Error('Unknown access checkpoint.');
      state.checks[name] += 1;
      if (name === 'project404') state.lastProjectCheck = state.rejectedProjects;
      if (name === 'revision404') state.lastRevisionCheck = state.rejectedRevisions;
    });
    page.on('pageerror', () => { state.pageErrors += 1; });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const address = new URL(request.url());
      const path = address.pathname;
      if (path === '/api/auth/refresh' && request.method() === 'POST') {
        await route.fulfill({ json: {
          user: { id: '400000000000000000000001', name: 'Access fixture', email: 'access@example.test' },
          accessToken: 'test-only-not-a-valid-jwt',
        } });
        return;
      }
      // These mocks verify UI handling, NOT real server authorization. Block all writes.
      if (request.method() !== 'GET') { state.unexpected += 1; await route.abort(); return; }
      if (path === '/api/projects' && address.searchParams.get('limit') === '20' && !address.searchParams.has('cursor')) {
        await route.fulfill({ json: { projects: [legacy, draft], nextCursor: null } });
      } else if (path === `/api/projects/${legacyId}` || path === `/api/projects/${draftId}`) {
        await route.fulfill({ json: { project: path.endsWith(legacyId) ? legacy : draft } });
      } else if (path === `/api/projects/${legacyId}/revisions` || path === `/api/projects/${draftId}/revisions`) {
        await route.fulfill({ json: { revisions: path.includes(legacyId) ? [summary] : [], nextCursor: null } });
      } else if (path === `/api/projects/${draftId}/brief`) {
        await route.fulfill({ json: { brief: null } });
      } else if (path === `/api/projects/${legacyId}/revisions/${legacyRevisionId}`) {
        state.legacyReads += 1;
        await route.fulfill({ json: { revision } });
      } else if (path === `/api/projects/${unavailableId}` || path === `/api/projects/${unavailableId}/revisions`) {
        if (path.endsWith(unavailableId)) state.rejectedProjects += 1;
        // Missing and foreign resources deliberately share the same public not-found response.
        await route.fulfill({ status: 404, json: { message: 'Project not found.', code: 'PROJECT_NOT_FOUND' } });
      } else if (path === `/api/projects/${legacyId}/revisions/${unavailableRevisionId}`) {
        state.rejectedRevisions += 1;
        await route.fulfill({ status: 404, json: { message: 'Revision not found.', code: 'REVISION_NOT_FOUND' } });
      } else { state.unexpected += 1; await route.abort(); }
    });
    return;
  }

  const address = new URL(page.url());
  if (address.pathname !== '/workspace') throw new Error('Access cases must stay in the signed-in workspace.');
  const projectId = address.searchParams.get('project');
  const revisionId = address.searchParams.get('revision');
  const prompt = page.getByRole('textbox', { name: 'Describe a frontend page or change' });
  let checkpoint;

  if (projectId === legacyId && revisionId === null) {
    await page.getByText('// LEGACY_SNAPSHOT_ONLY', { exact: true }).waitFor();
    await page.getByText('1 files · Model unknown (legacy) · Usage unknown', { exact: true }).waitFor();
    await page.getByText('Parent unknown (legacy)', { exact: true }).waitFor();
    await page.getByText('Validation unknown (legacy)', { exact: true }).waitFor();
    await page.getByText('Producing prompt unknown (legacy)', { exact: true }).waitFor();
    await page.getByText('Change metadata unavailable.', { exact: true }).waitFor();
    if (await page.getByRole('button', { name: 'page.tsx', exact: true }).count() !== 1) {
      throw new Error('Legacy files must load without fabricated added/modified badges.');
    }
    checkpoint = 'legacy';
  } else if (projectId === draftId && revisionId === null) {
    await page.getByText('Saved draft. No generated files yet.', { exact: true }).waitFor();
    await page.getByText('No saved revisions.', { exact: true }).waitFor();
    checkpoint = 'draft';
  } else if (projectId === unavailableId || (projectId === legacyId && revisionId === unavailableRevisionId)) {
    checkpoint = projectId === unavailableId ? 'project404' : 'revision404';
    const message = checkpoint === 'project404' ? 'Project not found.' : 'Revision not found.';
    await page.getByRole('main').getByRole('alert').filter({ hasText: message }).waitFor();
    if (!await prompt.isDisabled() || !await page.getByRole('button', { name: 'Send prompt', exact: true }).isDisabled()) {
      throw new Error('Unavailable selection must not allow generation.');
    }
    // Read counters after the error renders; requests may finish during the DOM wait.
    const state = await page.evaluate(() => window.workspaceAccessSmokeState());
    const reads = checkpoint === 'project404' ? state.rejectedProjects : state.rejectedRevisions;
    const previous = checkpoint === 'project404' ? state.lastProjectCheck : state.lastRevisionCheck;
    if (reads <= previous) throw new Error('Retry must issue a new scoped read, not replay a stale error.');
  } else if (projectId === null && revisionId === null) {
    checkpoint = 'recovery';
  } else { throw new Error('Unexpected workspace selection.'); }

  if (checkpoint !== 'legacy') {
    if (await page.getByRole('button', { name: /\.(tsx?|jsx?|css|json)(\s+[AM])?$/ }).count() ||
        await page.getByText('// LEGACY_SNAPSHOT_ONLY', { exact: true }).count()) {
      throw new Error('Draft/error/recovery must not show legacy or demo files.');
    }
  }
  if (checkpoint === 'draft') {
    await page.getByRole('button', { name: 'Assess saved request', exact: true }).waitFor();
    if (await prompt.count()) throw new Error('Draft should use saved requirements, not an ignored editable initial prompt.');
  }
  if (checkpoint === 'recovery') {
    await page.getByText('No generated files. Submit a prompt or choose a saved revision.', { exact: true }).waitFor();
    await prompt.fill('A harmless draft that is never submitted');
    if (await page.getByRole('main').getByRole('alert').count() ||
        await page.getByRole('button', { name: 'Send prompt', exact: true }).isDisabled()) {
      throw new Error('Empty drafts must stay usable without an error or generated files.');
    }
  }
  const checked = await page.evaluate(() => window.workspaceAccessSmokeState());
  if (checked.unexpected || checked.pageErrors || (checkpoint === 'legacy' && !checked.legacyReads)) {
    throw new Error('Unexpected API call, missing snapshot read or uncaught page error.');
  }
  await page.evaluate(name => window.recordWorkspaceAccessCheck(name), checkpoint);
}
