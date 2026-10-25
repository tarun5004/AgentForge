// Browser-only fixture: every API is intercepted; this suite never contacts a paid model.
async (page) => {
  if (page.url() === 'about:blank') {
    const projectId = '100000000000000000000011';
    const runId = '11111111-1111-4111-8111-111111111111';
    const state = { project: null, brief: null, revisions: [], posts: [], pending: null,
      checks: 0, previews: 0, unexpected: 0, errors: 0, foreign: false, failNext: false };
    const previewUrl = `http://127.0.0.1:5101/preview/${runId}/${'a'.repeat(48)}/`;
    await page.exposeFunction('chatFixtureState', () => ({ ...state }));
    await page.exposeFunction('chatFixtureMode', mode => { state[mode] = true; });
    page.on('pageerror', () => { state.errors++; });
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route('http://127.0.0.1:5101/preview/**', route => route.fulfill({ contentType: 'text/html',
      body: '<h1>Fixture preview only</h1>', headers: { 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'" } }));

    // Publish a deterministic fixture snapshot only after its pending response has been read.
    const publish = () => {
      const next = state.pending;
      state.pending = null;
      state.revisions.unshift(next);
      state.project = { ...state.project, status: 'ready', latestRevision: { id: next.id, version: next.version } };
      return { ...next, id: next.generationId, status: 'ready', revisionId: next.id, revisionVersion: next.version };
    };
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const json = value => route.fulfill({ json: value });
      const now = () => new Date().toISOString();
      if (path === '/api/auth/refresh') return json({ accessToken: 'chat-fixture-not-a-real-token', user: {
        id: state.foreign ? '400000000000000000000012' : '400000000000000000000011', name: 'Chat tester', email: 'chat@example.test' } });
      if (state.foreign && path.startsWith('/api/projects/')) return route.fulfill({ status: 404, json: { message: 'Project not found.' } });
      if (path === '/api/projects' && method === 'GET') return json({ projects: state.project && !state.foreign ? [state.project] : [], nextCursor: null });
      if (path === '/api/projects' && method === 'POST') {
        state.project = { id: projectId, name: 'Chat portfolio', initialPrompt: request.postDataJSON().prompt,
          template: 'nextjs', status: 'draft', latestRevision: null, createdAt: now() };
        return route.fulfill({ status: 201, json: { project: state.project } });
      }
      if (path === `/api/projects/${projectId}` && method === 'GET') return json({ project: state.project });
      if (path === `/api/projects/${projectId}/brief` && method === 'GET') return json({ brief: state.brief });
      if (path === `/api/projects/${projectId}/brief` && method === 'POST') {
        const id = '600000000000000000000011';
        state.brief = { id, version: 1, sourcePrompt: state.project.initialPrompt, answers: [], status: 'completed',
          assessment: { requestId: id, status: 'ready', message: 'I have enough detail to build this frontend.',
            brief: 'Build a compact portfolio for Demo Student with a working counter.', questions: [],
            policyVersion: 'frontend-requirements-v1', model: 'fixture-model',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1 },
          confirmedAt: null, errorCode: null, createdAt: now() };
        return json({ brief: state.brief });
      }
      if (path.endsWith('/confirm')) { state.brief.confirmedAt = now(); return json({ brief: state.brief }); }
      if (path.endsWith('/generations') && method === 'POST') {
        const body = request.postDataJSON();
        state.posts.push({ body, key: request.headers()['idempotency-key'] });
        if (state.revisions.length && body.baseRevisionId !== state.revisions[0].id) throw new Error('Follow-up lost the selected base.');
        if (state.failNext) {
          state.failNext = false;
          return route.fulfill({ status: 502, json: { message: 'Fixture generation failed.', code: 'AI_GENERATION_FAILED' } });
        }
        const version = state.revisions.length + 1;
        const id = `20000000000000000000001${version}`;
        const generationId = `30000000000000000000001${version}`;
        state.pending = { id, generationId, projectId, version, summary: `Portfolio revision ${version} is saved.`,
          parentRevisionId: state.revisions[0]?.id ?? null, sourcePrompt: body.prompt ?? state.brief.assessment.brief,
          createdAt: now(), updatedAt: now(), files: [{ path: 'app/page.tsx', content: `export default function Page() { return <h1>Fixture v${version}</h1>; }` }],
          fileChanges: [{ path: 'app/page.tsx', status: version === 1 ? 'A' : 'M' }], provider: 'fixture', model: 'fixture-model',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, schemaVersion: 2,
          validation: { policyVersion: 'frontend-manifest-v1', status: 'manifest_validated' },
          buildVerification: { status: 'build_passed', policyVersion: 'next-static-build-v1', snapshotHash: 'b'.repeat(64),
            runnerImageId: `sha256:${'c'.repeat(64)}`, checkId: runId, completedAt: now() } };
        return route.fulfill({ status: 202, json: { generation: { id: generationId, status: 'pending', hasSavedResult: true, errorCode: null } } });
      }
      if (path.includes('/generations/') && method === 'GET') { state.checks++; return json({ generation: publish() }); }
      if (path.endsWith('/revisions')) return json({ revisions: state.revisions, nextCursor: null });
      if (path.includes('/revisions/')) return json({ revision: state.revisions.find(item => path.endsWith(item.id)) });
      if (path.startsWith('/api/runs')) {
        if (method === 'POST' && path === '/api/runs') state.previews++;
        return json({ run: { id: runId, projectId, revisionId: state.revisions[0].id, state: method === 'DELETE' ? 'cancelled' : 'ready',
          message: method === 'DELETE' ? 'Fixture preview stopped.' : 'Fixture preview ready.', errorCode: null,
          createdAt: now(), previewUrl: method === 'DELETE' ? null : previewUrl } });
      }
      state.unexpected++; return route.abort();
    });
    return;
  }

  const state = () => page.evaluate(() => window.chatFixtureState());
  const log = page.getByRole('log', { name: 'Conversation' });
  if (await page.getByRole('button', { name: 'Clear terminal', exact: true }).count()) throw new Error('Unconnected demo terminal must not return to the workspace.');
  await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).fill('Build a portfolio for Demo Student with a working counter.');
  await page.getByRole('button', { name: 'Send prompt', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm brief', exact: true }).click();
  await page.getByRole('button', { name: 'Generate code', exact: true }).click();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  if (!(await log.innerText()).includes('Build a portfolio for Demo Student')) throw new Error('Initial prompt disappeared.');
  if (!(await log.innerText()).includes('Portfolio revision 1 is saved.')) throw new Error('Result is not part of the chat.');
  await log.getByText('Changed files and verification', { exact: true }).click();
  if ((await log.innerText()).includes('Tool completed:')) throw new Error('The UI invented an unreported tool event.');
  if (!(await log.innerText()).includes('Static build passed for this snapshot.')) throw new Error('Build evidence missing.');
  await page.getByRole('button', { name: 'Preview this revision' }).click();
  await page.frameLocator('iframe[title="Generated frontend preview"]').getByText('Fixture preview only').waitFor();
  if (await page.locator('iframe').getAttribute('sandbox') !== 'allow-scripts') throw new Error('Preview sandbox changed.');
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  const beforeReload = await state();
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  if ((await state()).posts.length !== beforeReload.posts.length) throw new Error('Refresh started another generation.');
  if (!(await log.innerText()).includes('Preview request accepted')) throw new Error('Preview activity was not restored.');

  await page.evaluate(() => window.chatFixtureMode('failNext'));
  const prompt = page.getByRole('textbox', { name: 'Describe a frontend page or change' });
  await prompt.fill('Change only the hero heading to AI Engineer.'); await prompt.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Fixture generation failed.' }).waitFor();
  if (!(await page.getByText('Viewing v1', { exact: true }).isVisible())) throw new Error('Failure lost saved files.');
  await prompt.fill('Change only the hero heading to Future Engineer.'); await prompt.press('Enter');
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  await page.reload(); await page.getByText('Viewing v2', { exact: true }).waitFor();
  await page.setViewportSize({ width: 900, height: 1000 });
  if (!(await log.innerText()).includes('Future Engineer.')) throw new Error('Resize lost follow-up history.');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Mobile layout overflows horizontally.');
  await page.screenshot({ path: 'output/playwright/agent-chat-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await log.getByText('Changed files and verification', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Preview this revision' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/agent-chat-desktop.png', fullPage: true });
  await page.getByRole('complementary', { name: 'Agent chat' }).screenshot({ path: 'output/playwright/agent-sidebar-reference.png' });
  const final = await state();
  if (final.posts.length !== 3 || final.checks !== 2 || final.previews !== 1 || final.errors || final.unexpected) throw new Error(`Unexpected test activity: ${JSON.stringify(final)}`);
  await page.locator('summary[aria-label="Revision history"]').click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear local chat messages', exact: true }).click();
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  if ((await state()).posts.length !== 3) throw new Error('Clearing display history changed request identity.');
  await page.evaluate(() => window.chatFixtureMode('foreign'));
  await page.reload(); await page.getByRole('alert').filter({ hasText: 'Project not found.' }).waitFor();
  if ((await log.innerText()).includes('Demo Student')) throw new Error('Foreign account saw cached transcript.');
  return { passed: 11, coverage: 'unified transcript, build evidence, single preview start, refresh, failed follow-up, successful follow-up, responsive reflow, mobile overflow, selected base, clear cache, account isolation', providerCalls: 0 };
}
