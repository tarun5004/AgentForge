// Test-only CLI expression; no API interception and no export/trailing semicolon.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { stage: 0, token: null, projectId: null, generations: [], requests: [], refreshes: 0, errors: 0 };
    page.on('pageerror', () => { state.errors += 1; });
    // Tokens stay private to the test runner. CLI results/snapshots never include them.
    page.on('response', async (response) => {
      try {
        const path = new URL(response.url()).pathname;
        if (!response.ok() || response.request().method() !== 'POST') return;
        if (['/api/auth/register', '/api/auth/refresh'].includes(path)) {
          state.token = (await response.json()).accessToken;
          if (path.endsWith('/refresh')) state.refreshes += 1;
        } else if (path === '/api/projects') {
          state.projectId = (await response.json()).project.id;
        } else if (/^\/api\/projects\/[a-f\d]{24}\/generations$/.test(path)) {
          state.generations.push((await response.json()).generation);
          state.requests.push({ key: response.request().headers()['idempotency-key'], body: response.request().postDataJSON() });
        }
      } catch { state.errors += 1; }
    });
    // Non-secret state survives hard refreshes without replacing React/application state.
    await page.exposeFunction('realLoopSelection', () => ({
      projectId: state.projectId, revisions: state.generations.map(item => item.revisionId), stage: state.stage,
    }));
    await page.exposeFunction('verifyRealLoop', async () => {
      if (state.errors) throw new Error('Uncaught browser/observer error.');
      if (state.stage === 0) {
        if (!state.token || !state.projectId || state.generations.length !== 1) throw new Error('Initial generation was not captured.');
      } else if (state.stage === 1) {
        if (!state.refreshes || state.generations.length !== 1) throw new Error('Refresh must restore a session, not regenerate.');
      } else if (state.stage >= 2) {
        if (state.generations.length !== 2) throw new Error('Expected exactly two model-backed generations.');
        const [first, second] = state.generations;
        // These reads hit the real owned Project API, whose snapshots come from MongoDB.
        const base = `http://127.0.0.1:4311/api/projects/${state.projectId}`;
        const headers = { Authorization: `Bearer ${state.token}` };
        const firstResponse = await fetch(`${base}/revisions/${first.revisionId}`, { headers });
        const secondResponse = await fetch(`${base}/revisions/${second.revisionId}`, { headers });
        if (!firstResponse.ok || !secondResponse.ok) throw new Error('Persisted owned snapshots could not be read.');
        const v1 = (await firstResponse.json()).revision;
        const v2 = (await secondResponse.json()).revision;
        if (v1.version !== 1 || v2.version !== 2 || v2.parentRevisionId !== v1.id ||
            JSON.stringify(v1.files) !== JSON.stringify(first.files) || JSON.stringify(v2.files) !== JSON.stringify(second.files)) {
          throw new Error('Version, parent or immutable snapshot persistence mismatch.');
        }
        const css1 = v1.files.find(file => file.path === 'app/globals.css');
        const css2 = v2.files.find(file => file.path === 'app/globals.css');
        if (!css1 || css1.content !== css2?.content || v2.files.some(file => file.path === 'components/Old.tsx') ||
            !v2.fileChanges.some(change => change.path === 'components/Old.tsx' && change.status === 'D')) {
          throw new Error('Unchanged files must survive and deletion must be explicit.');
        }
        if (state.stage === 4) {
          // Replay the original key/body; it must not spend another fixture/model call.
          const replay = await fetch(`${base}/generations`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': state.requests[1].key },
            body: JSON.stringify(state.requests[1].body),
          });
          if (!replay.ok || (await replay.json()).generation.revisionId !== second.revisionId) throw new Error('Idempotent replay changed the committed revision.');
          // A separate real account cannot list/read the first account's project or revision.
          const registration = await fetch('http://127.0.0.1:4310/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Other test owner', email: 'revision-loop-other@agentforge.test', password: 'Disposable-test-password-13' }),
          });
          if (registration.status !== 201) throw new Error('Second fixture account could not be created.');
          const otherHeaders = { Authorization: `Bearer ${(await registration.json()).accessToken}` };
          const list = await fetch('http://127.0.0.1:4311/api/projects', { headers: otherHeaders });
          const foreignProject = await fetch(base, { headers: otherHeaders });
          const foreignRevision = await fetch(`${base}/revisions/${v1.id}`, { headers: otherHeaders });
          if (!list.ok || (await list.json()).projects.length !== 0 || foreignProject.status !== 404 || foreignRevision.status !== 404) {
            throw new Error('Real owner isolation failed.');
          }
          const status = await (await fetch('http://127.0.0.1:4312/__fixture')).json();
          if (status.aiRequests.length !== 2 || status.aiRequests[1].baseVersion !== 1 || !status.aiRequests[1].baseMatchesInitial ||
              status.counts.users !== 2 || status.counts.projects !== 1 || status.counts.revisions !== 2 || status.counts.generations !== 2) {
            throw new Error('Unexpected model calls, selected base or persisted record counts.');
          }
        }
      }
      state.stage += 1;
    });
    return;
  }

  const selection = await page.evaluate(() => window.realLoopSelection());
  if (selection.stage > 4) throw new Error('Unexpected extra real-loop checkpoint.');
  const version = selection.stage === 0 || selection.stage === 1 || selection.stage === 4 ? 1 : 2;
  await page.getByText(`Viewing v${version}`, { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).waitFor();
  // A disabled prompt may still be mounted while canonical reads are loading.
  await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).fill('A harmless draft that is never submitted');
  const expected = version === 1 ? 'Initial portfolio' : 'Revised portfolio 2';
  await page.getByText(`export default function Page() { return <main>${expected}</main>; }`, { exact: true }).waitFor();
  const url = new URL(page.url());
  if (url.searchParams.get('project') !== selection.projectId ||
      url.searchParams.get('revision') !== selection.revisions[version - 1]) throw new Error('Restored URL does not identify the visible revision.');
  await page.evaluate(() => window.verifyRealLoop());
}
