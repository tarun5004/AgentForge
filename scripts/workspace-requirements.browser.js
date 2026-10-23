// CLI-only regression: all API traffic is intercepted before navigation; no paid calls.
async (page) => {
  if (page.url() === 'about:blank') {
    const id = '100000000000000000000001';
    const date = '2026-10-23T00:00:00.000Z';
    const state = { project: null, brief: null, generation: null, posts: [], assessments: 0, confirms: 0, generations: 0, unexpected: 0, errors: 0 };
    page.on('pageerror', () => { state.errors++; });
    await page.exposeFunction('requirementTestState', () => ({ ...state }));
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route('**/api/**', async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const method = req.method();
      const json = value => route.fulfill({ json: value });
      if (path === '/api/auth/refresh') return json({ accessToken: 'test-only', user: { id: '400000000000000000000001', name: 'Brief fixture', email: 'brief@example.test' } });
      if (path === '/api/projects' && method === 'GET') return json({ projects: state.project ? [state.project] : [], nextCursor: null });
      if (path === '/api/projects' && method === 'POST') {
        state.project = { id, name: 'Portfolio', initialPrompt: req.postDataJSON().prompt, template: 'nextjs', status: 'draft', latestRevision: null, createdAt: date };
        return route.fulfill({ status: 201, json: { project: state.project } });
      }
      if (path === `/api/projects/${id}`) return json({ project: state.project });
      if (path === `/api/projects/${id}/brief` && method === 'GET') return json({ brief: state.brief });
      if (path === `/api/projects/${id}/brief` && method === 'POST') {
        const body = req.postDataJSON();
        const key = req.headers()['idempotency-key'];
        const existing = state.posts.find(item => item.key === key);
        state.posts.push({ key, body });
        if (existing) {
          if (JSON.stringify(body) !== JSON.stringify(existing.body)) throw new Error('Replay changed input.');
          return json({ brief: state.brief });
        }
        state.assessments++;
        const version = state.assessments;
        const briefId = `20000000000000000000000${version}`;
        state.brief = { id: briefId, version, sourcePrompt: state.project.initialPrompt, answers: body.answers, status: 'completed',
          assessment: { requestId: briefId, status: version === 1 ? 'needs_clarification' : 'ready',
            message: 'Review your portfolio requirements.', brief: `Build a portfolio for ${body.answers[0]?.answer ?? 'the user'}.`,
            questions: version === 1 ? ['What is your name?'] : [], policyVersion: 'frontend-requirements-v1', model: 'test-fixture',
            usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 }, confirmedAt: null, errorCode: null, createdAt: date };
        // Simulate a lost acknowledgement: server saved the answer, browser must replay its key.
        if (version === 2) return route.fulfill({ status: 503, json: { message: 'Assessment acknowledgement unavailable.', code: 'OUTCOME_UNKNOWN' } });
        return json({ brief: state.brief });
      }
      if (path.endsWith('/confirm') && method === 'POST') {
        if (req.postData() !== '{}') throw new Error('Browser sent an editable brief.');
        state.confirms++; state.brief.confirmedAt = date;
        return json({ brief: state.brief });
      }
      if (path.endsWith('/generations') && method === 'POST') {
        if (!path.includes(`/brief/${state.brief.id}/`) || !state.brief.confirmedAt || req.postData() !== '{}') throw new Error('Generation bypassed saved confirmation.');
        state.generations++;
        state.generation = { id: '300000000000000000000001', status: 'ready', revisionId: '500000000000000000000001', revisionVersion: 1,
          parentRevisionId: null, sourcePrompt: state.brief.assessment.brief, provider: 'fixture', model: 'fixture', summary: 'Approved portfolio saved',
          files: [{ path: 'app/page.tsx', content: 'export default function Page() { return <main>Bob</main>; }' }],
          fileChanges: [{ path: 'app/page.tsx', status: 'A' }], validation: { policyVersion: 'frontend-manifest-v1', status: 'manifest_validated' },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0 };
        state.project = { ...state.project, status: 'ready', latestRevision: { id: state.generation.revisionId, version: 1 } };
        return route.fulfill({ status: 201, json: { generation: state.generation } });
      }
      const revision = state.generation ? { ...state.generation, id: state.generation.revisionId, projectId: id,
        generationId: state.generation.id, version: 1, createdAt: date, updatedAt: date, schemaVersion: 2 } : null;
      if (path === `/api/projects/${id}/revisions`) return json({ revisions: revision ? [revision] : [], nextCursor: null });
      if (revision && path === `/api/projects/${id}/revisions/${revision.id}`) return json({ revision });
      state.unexpected++; return route.abort();
    });
    return;
  }

  const state = () => page.evaluate(() => window.requirementTestState());
  const prompt = page.getByRole('textbox', { name: 'Describe a frontend page or change' });
  await prompt.fill('Build my portfolio website');
  await prompt.press('Enter');
  await page.getByRole('region', { name: 'Project requirements' }).waitFor();
  await page.screenshot({ path: 'output/playwright/requirements-questions.png', fullPage: true });
  const name = page.getByRole('textbox', { name: 'What is your name?' });
  await name.fill('Ada');
  await page.setViewportSize({ width: 900, height: 1000 });
  if (await name.inputValue() !== 'Ada') throw new Error('Resize lost draft answer.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (await name.inputValue() !== 'Ada' || (await state()).generations) throw new Error('Clarification lost facts or generated early.');
  await page.getByRole('button', { name: 'Save answers and reassess' }).click();
  await page.getByRole('button', { name: 'Replay assessment' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Replay assessment' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm brief', exact: true });
  await confirm.click();
  const generate = page.getByRole('button', { name: 'Generate code', exact: true });
  await generate.waitFor();
  await name.fill('Bob');
  if (await generate.isEnabled()) throw new Error('Edited answers reused old consent.');
  await page.getByRole('button', { name: 'Save answers and reassess' }).click();
  await confirm.click();
  await generate.waitFor();
  await page.reload();
  await generate.waitFor();
  const before = await state();
  if (before.assessments !== 3 || before.generations || before.confirms !== 2 || before.posts.length !== 4) throw new Error('Wrong assessment/replay/consent count.');
  if (JSON.stringify(before.posts[1]) !== JSON.stringify(before.posts[2])) throw new Error('Refresh changed uncertain request identity.');
  await generate.click();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  const final = await state();
  if (final.generations !== 1 || final.unexpected || final.errors || final.assessments !== 3) throw new Error('Refresh repeated model work or caused errors.');
  await page.screenshot({ path: 'output/playwright/requirements-complete.png', fullPage: true });
}
