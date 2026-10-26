// Natural clarification regression. Every API is intercepted before navigation; no paid calls.
async (page) => {
  if (page.url() === 'about:blank') {
    const id = '100000000000000000000001';
    const date = '2026-10-23T00:00:00.000Z';
    const state = { project: null, generation: null, conversations: [], creates: 0, generations: 0, failNext: false, unexpected: 0, errors: 0 };
    page.on('pageerror', () => { state.errors++; });
    await page.exposeFunction('requirementTestState', () => ({ ...state }));
    await page.exposeFunction('failNextClarification', () => { state.failNext = true; });
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route('**/api/**', async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const method = req.method();
      const json = value => route.fulfill({ json: value });
      if (path === '/api/auth/refresh') return json({ accessToken: 'test-only', user: { id: '400000000000000000000001', name: 'Clarification fixture', email: 'clarification@example.test' } });
      if (path === '/api/conversations' && method === 'POST') {
        const body = req.postDataJSON(); state.conversations.push(body);
        if (state.failNext) {
          state.failNext = false;
          return route.fulfill({ status: 502, json: { message: 'Fixture conversation unavailable.', code: 'AI_UNAVAILABLE' } });
        }
        const text = body.messages.at(-1).content;
        const action = text === 'Build my portfolio website' ? 'clarify' : text.startsWith('My name is') ? 'reply' : 'build';
        const message = action === 'clarify' ? 'What name and role should appear? You can answer together.'
          : action === 'reply' ? 'I will use Ada, frontend developer. Say build it when ready.' : 'I will build the portfolio using your saved details.';
        return json({ response: { requestId: `conversation-${state.conversations.length}`, action, message,
          prompt: action === 'build' ? 'Build a portfolio for Ada, a frontend developer, with projects and contact sections.' : null,
          sources: [{ id: 'portfolio', title: 'Portfolio guidance' }], retrieval: { method: 'lexical', embeddingModel: null, inputTokens: 0 },
          model: 'test-fixture', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0 } });
      }
      if (path === '/api/projects' && method === 'GET') return json({ projects: state.project ? [state.project] : [], nextCursor: null });
      if (path === '/api/projects' && method === 'POST') {
        state.creates++;
        state.project = { id, name: 'Portfolio', initialPrompt: req.postDataJSON().prompt, template: 'nextjs', status: 'draft', latestRevision: null, createdAt: date };
        return route.fulfill({ status: 201, json: { project: state.project } });
      }
      if (path === `/api/projects/${id}` && method === 'GET') return json({ project: state.project });
      if (path === `/api/projects/${id}/brief` && method === 'GET') return json({ brief: null });
      if (path === `/api/projects/${id}/generations` && method === 'POST') {
        const body = req.postDataJSON();
        if (!body.prompt.includes('Ada') || 'baseRevisionId' in body || !req.headers()['idempotency-key']) throw new Error('Generation lost clarified facts or initial request identity.');
        state.generations++;
        state.generation = { id: '300000000000000000000001', status: 'ready', revisionId: '500000000000000000000001', revisionVersion: 1,
          parentRevisionId: null, sourcePrompt: body.prompt, provider: 'fixture', model: 'fixture', summary: 'Clarified portfolio saved',
          files: [{ path: 'app/page.tsx', content: 'export default function Page() { return <main>Ada</main>; }' }],
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
  const prompt = page.getByRole('textbox', { name: 'Message AgentForge' });
  const log = page.getByRole('log', { name: 'Conversation' });
  await prompt.fill('Build my portfolio website');
  await prompt.press('Enter');
  await log.getByText('What name and role should appear? You can answer together.', { exact: true }).waitFor();
  if ((await state()).creates || (await state()).generations) throw new Error('Clarification prematurely created a project or generated code.');
  await prompt.fill('My name is Ada, frontend developer');
  await page.setViewportSize({ width: 900, height: 1000 });
  if (await prompt.inputValue() !== 'My name is Ada, frontend developer') throw new Error('Resize lost the natural clarification answer.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.failNextClarification());
  await prompt.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Fixture conversation unavailable.' }).waitFor();
  if (await prompt.inputValue() !== 'My name is Ada, frontend developer' || (await state()).conversations.length !== 2) throw new Error('Failed clarification lost the composer or retried automatically.');
  await prompt.press('Enter');
  await log.getByText('I will use Ada, frontend developer. Say build it when ready.', { exact: true }).waitFor();
  await page.reload();
  await log.getByText('I will use Ada, frontend developer. Say build it when ready.', { exact: true }).waitFor();
  if ((await state()).conversations.length !== 3 || (await state()).creates) throw new Error('Refresh repeated model work or created a project while planning.');
  await prompt.fill('Build it now');
  await prompt.press('Enter');
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  const built = await state();
  const context = built.conversations.at(-1).messages;
  if (!context.some(message => message.role === 'user' && message.content.includes('Ada')) ||
      !context.some(message => message.role === 'assistant' && message.content.includes('Say build it'))) throw new Error('Generation decision forgot the previous clarification context.');
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  const final = await state();
  if (final.generations !== 1 || final.creates !== 1 || final.conversations.length !== 4 || final.unexpected || final.errors) throw new Error('Refresh repeated work or unexpected traffic/errors occurred.');
  await page.screenshot({ path: 'output/playwright/requirements-complete.png', fullPage: true });
}
