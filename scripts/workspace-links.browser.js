// Playwright CLI reads this function directly; it is test-only JavaScript, not app code.
// No export or trailing semicolon: the CLI wraps and invokes the function expression.
async (page) => {
  if (page.url() === 'about:blank') {
    const counts = { sessions: 0, lists: 0, unexpected: 0, pageErrors: 0, invalidChecks: 0, recoveryChecks: 0 };
    // Runner-owned counters survive page reloads and cannot hide an earlier failure.
    await page.exposeFunction('workspaceLinkSmokeCounts', () => ({ ...counts }));
    // Count both states, so an unexpected redirect cannot be mistaken for a passing case.
    await page.exposeFunction('recordWorkspaceLinkCheck', (malformed) => {
      counts[malformed ? 'invalidChecks' : 'recoveryChecks'] += 1;
    });
    page.on('pageerror', () => { counts.pageErrors += 1; });

    // Intercept BEFORE navigation: even unexpected API calls cannot reach real services.
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/auth/refresh' && request.method() === 'POST') {
        counts.sessions += 1;
        await route.fulfill({ json: {
          user: { id: '100000000000000000000001', name: 'Link smoke fixture', email: 'links@example.test' },
          accessToken: 'test-only-not-a-valid-jwt',
        } });
      } else if (path === '/api/projects' && request.method() === 'GET') {
        counts.lists += 1;
        await route.fulfill({ json: { projects: [], nextCursor: null } });
      } else {
        counts.unexpected += 1;
        await route.abort();
      }
    });
    return;
  }

  const address = new URL(page.url());
  if (address.pathname !== '/workspace') throw new Error('Workspace did not render.');
  const prompt = page.getByRole('textbox', { name: 'Describe a frontend page or change' });
  const send = page.getByRole('button', { name: 'Send prompt', exact: true });
  await page.getByText('No saved projects yet.', { exact: true }).waitFor();

  if (address.search) {
    await page.getByRole('alert').filter({ hasText: 'Invalid workspace link.' }).waitFor();
    if (!await prompt.isDisabled() || !await send.isDisabled()) {
      throw new Error('Malformed selection must disable both prompt and submission.');
    }
  } else {
    await page.getByText('No generated files. Submit a prompt or choose a saved revision.', { exact: true }).waitFor();
    // Filling waits for enabled state; this draft is deliberately never submitted.
    await prompt.fill('A harmless draft that is never submitted');
    if (await send.isDisabled()) throw new Error('New conversation must restore an actionable draft.');
    // Next's route announcer also uses role=alert; inspect application alerts only.
    if (await page.getByRole('main').getByRole('alert').count()) {
      throw new Error('Recovery must clear the selection error.');
    }
  }

  if (await page.getByRole('button', { name: /\.(tsx?|jsx?|css|json)(\s+[AM])?$/ }).count()) {
    throw new Error('An empty workspace must not show generated or demo file tabs.');
  }
  const counts = await page.evaluate(() => window.workspaceLinkSmokeCounts());
  if (!counts.sessions || !counts.lists || counts.unexpected || counts.pageErrors) {
    throw new Error('Missing fixture reads, unexpected API traffic, or an uncaught page error.');
  }
  await page.evaluate(malformed => window.recordWorkspaceLinkCheck(malformed), Boolean(address.search));
}
