// CLI-only regression checks. Block every API request before navigation: never spend model credits.
async (page) => {
  if (page.url() === 'about:blank') {
    const state = { mode: 'create401', refreshes: 0, creates: [], conversations: [], generations: [], rejectedReads: 0, unexpected: 0, errors: 0, logout: 0 };
    let releaseRefresh;
    const project = { id: '100000000000000000000001', name: 'Session test draft', initialPrompt: 'Build a portfolio website', template: 'nextjs', status: 'draft', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z', latestRevision: null };
    page.on('pageerror', () => { state.errors++; });
    await page.exposeFunction('sessionTestState', () => ({ ...state }));
    await page.exposeFunction('setSessionTestCase', mode => {
      Object.assign(state, { mode, refreshes: 0, creates: [], conversations: [], generations: [], rejectedReads: 0, logout: 0 });
    });
    await page.exposeFunction('releaseSessionRefresh', () => { releaseRefresh?.(); });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const unauthorized = () => route.fulfill({ status: 401, json: { message: 'Test expired token.' } });
      if (path === '/api/auth/refresh' && method === 'POST') {
        state.refreshes++;
        if (state.refreshes > 1) {
          if (state.mode === 'refresh401') return unauthorized();
          if (state.mode === 'refresh503') return route.fulfill({ status: 503, json: { message: 'Test auth temporarily unavailable.' } });
          if (state.mode === 'refreshNetwork') return route.abort('failed');
          if (state.mode === 'refreshInvalid') return route.fulfill({ json: {} });
          if (state.mode === 'logoutRace') await new Promise(resolve => { releaseRefresh = resolve; });
          // Give parallel rejections time to arrive; one refresh must cover them all.
          if (state.mode === 'concurrent') await new Promise(resolve => setTimeout(resolve, 50));
        }
        const userId = state.mode === 'accountChanged' && state.refreshes > 1 ? '400000000000000000000002' : '400000000000000000000001';
        return route.fulfill({ json: { user: { id: userId, name: 'Session fixture', email: 'session@example.test' }, accessToken: `test-token-${state.refreshes}` } });
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        state.logout++;
        return route.fulfill({ json: {} });
      }
      if (path === '/api/conversations' && method === 'POST') {
        const input = request.postDataJSON(); state.conversations.push(input);
        const text = input.messages.at(-1).content;
        const action = text === 'Hi' ? 'reply' : 'build';
        return route.fulfill({ json: { response: { requestId: `session-${state.conversations.length}`, action,
          message: action === 'reply' ? 'Hello! How can I help?' : 'I will build that portfolio.', prompt: action === 'build' ? text : null,
          sources: [], retrieval: { method: 'lexical', embeddingModel: null, inputTokens: 0 }, model: 'test-fixture',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0 } } });
      }
      if (method === 'GET' && path.startsWith('/api/projects')) {
        if (['concurrent', 'logoutRace'].includes(state.mode) && request.headers().authorization === 'Bearer test-token-1') {
          state.rejectedReads++;
          // This 401 deliberately arrives after refresh, proving late failures reuse the new token.
          if (state.mode === 'concurrent' && path.endsWith('/revisions')) await new Promise(resolve => setTimeout(resolve, 150));
          return unauthorized();
        }
        if (path.endsWith('/brief')) return route.fulfill({ json: { brief: null } });
        if (path.endsWith('/revisions')) return route.fulfill({ json: { revisions: [], nextCursor: null } });
        if (path === `/api/projects/${project.id}`) return route.fulfill({ json: { project } });
        if (path === '/api/projects') return route.fulfill({ json: { projects: [], nextCursor: null } });
      }
      if (path === '/api/projects' && method === 'POST') {
        state.creates.push(request.postDataJSON());
        if (state.mode === 'upstream502' || state.mode === 'keyboard') {
          if (state.mode === 'keyboard') await new Promise(resolve => setTimeout(resolve, 200));
          return route.fulfill({ status: 502, json: { message: 'Test server unavailable.' } });
        }
        if (state.mode === 'projectNetwork') return route.abort('failed');
        if (state.mode !== 'generation401' && (state.creates.length === 1 || state.mode === 'retry401')) return unauthorized();
        return route.fulfill({ status: 201, json: { project } });
      }
      if (path === `/api/projects/${project.id}/generations` && method === 'POST') {
        state.generations.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
        if (state.mode === 'generation401' && state.generations.length === 1) return unauthorized();
        return route.fulfill({ status: 502, json: { message: 'Test AI unavailable.', code: 'AI_UNAVAILABLE' } });
      }
      state.unexpected++;
      await route.abort('failed');
    });
    return;
  }

  const origin = new URL(page.url()).origin;
  const prompt = page.getByRole('textbox', { name: 'Message AgentForge' });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const text = 'Build a portfolio website';
  const read = () => page.evaluate(() => window.sessionTestState());
  // Fresh app navigation restores one fixture session, then each case controls only its own failure.
  async function start(mode, query = '') {
    await page.evaluate(value => window.setSessionTestCase(value), mode);
    await page.goto(`${origin}/workspace${query}`);
    await prompt.waitFor();
    if (query) await page.getByText('Session test draft', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Send message"]')?.disabled ||
      !document.querySelector('#workspace-prompt')?.disabled && !document.body.textContent.includes('Loading saved workspace...'));
  }
  // An API outage should be visible without discarding the prompt or authenticated workspace.
  async function expectPreserved() {
    await page.getByRole('main').getByRole('alert').first().waitFor();
    const current = await read();
    const preserved = await prompt.inputValue() === text;
    if (new URL(page.url()).pathname !== '/workspace' || !preserved) throw new Error(`Failure lost the session or prompt in ${current.mode}.`);
  }

  for (const mode of ['create401', 'generation401']) {
    await start(mode);
    await prompt.fill(text);
    await send.click();
    await expectPreserved();
    const state = await read();
    if (state.refreshes !== 2 || state.creates.length !== (mode === 'create401' ? 2 : 1) || state.generations.length !== (mode === 'generation401' ? 2 : 1)) throw new Error('Expected one refresh and one retry of the rejected operation.');
    if (mode === 'create401' && JSON.stringify(state.creates[0]) !== JSON.stringify(state.creates[1])) throw new Error('Create retry changed the prompt.');
    if (mode === 'generation401' && JSON.stringify(state.generations[0]) !== JSON.stringify(state.generations[1])) throw new Error('Generation retry changed its key/body.');
  }
  for (const mode of ['refresh503', 'refreshNetwork', 'refreshInvalid', 'upstream502', 'projectNetwork']) {
    await start(mode);
    await prompt.fill(text);
    await send.click();
    await expectPreserved();
    const state = await read();
    if (state.creates.length !== 1 || state.generations.length || state.refreshes !== (mode.startsWith('refresh') ? 2 : 1)) throw new Error('Outage triggered an unsafe retry or extra refresh.');
  }
  for (const mode of ['refresh401', 'retry401', 'accountChanged']) {
    await start(mode);
    await prompt.fill(text);
    await send.click();
    await page.waitForURL(url => url.pathname === '/login');
    await page.getByRole('heading', { name: 'Sign in to AgentForge', exact: true }).waitFor();
    const state = await read();
    if (state.refreshes !== 2 || state.creates.length !== (mode === 'retry401' ? 2 : 1)) throw new Error('Rejected session looped instead of stopping.');
  }
  await start('concurrent', '?project=100000000000000000000001');
  const concurrent = await read();
  if (concurrent.refreshes !== 2 || concurrent.rejectedReads < 3) throw new Error('Parallel or late 401s rotated the cookie more than once.');

  await start('keyboard');
  await prompt.fill('');
  await prompt.press('Enter');
  if ((await read()).conversations.length || (await read()).creates.length) throw new Error('Empty prompt was submitted.');
  await prompt.fill('Hi');
  await prompt.press('Enter');
  await page.getByRole('log', { name: 'Conversation' }).getByText('Hello! How can I help?', { exact: true }).waitFor();
  if ((await read()).creates.length || (await read()).generations.length) throw new Error('Greeting created a project or generated code.');
  await start('keyboard');
  await prompt.fill(text);
  await prompt.press('Shift+Enter');
  if (!(await prompt.inputValue()).endsWith('\n') || (await read()).conversations.length) throw new Error('Shift+Enter must only add a line.');
  await prompt.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  await prompt.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })));
  if ((await read()).conversations.length) throw new Error('IME/repeated Enter submitted a prompt.');
  await prompt.fill(text);
  await prompt.press('Enter');
  await page.keyboard.press('Enter');
  await expectPreserved();
  if ((await read()).creates.length !== 1 || (await read()).conversations.length !== 1) throw new Error('Enter must submit once, not duplicate work.');

  await start('logoutRace');
  await page.waitForFunction(async () => (await window.sessionTestState()).refreshes === 2);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  if ((await read()).logout !== 0) throw new Error('Logout must wait until the rotating cookie settles.');
  await page.evaluate(() => window.releaseSessionRefresh());
  await page.waitForURL(url => url.pathname === '/login');
  await page.getByRole('heading', { name: 'Sign in to AgentForge', exact: true }).waitFor();
  // Wait for the held refresh to settle so a late identity restoration cannot escape the assertion.
  await page.waitForLoadState('networkidle');
  const final = await read();
  if (new URL(page.url()).pathname !== '/login' || final.logout !== 1 || final.unexpected || final.errors) throw new Error('Late refresh restored logout or unexpected API/browser activity occurred.');
}
