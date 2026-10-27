// Real Next/Auth/Project/Mongo; only the upstream AI HTTP stream is a deterministic fixture.
async (page) => {
  const base = 'http://localhost:3102';
  const email = 'frontend-slice5-20261012@agentforge.test';
  const password = 'Disposable-test-password-13';
  const failures = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => failures.push(error.name));
  const registered = await page.request.post('http://localhost:4310/api/auth/register', { data: { name: 'Streaming chat owner', email, password } });
  if (![201, 409].includes(registered.status())) throw new Error('Fixture registration failed.');
  await page.goto(`${base}/login`);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message AgentForge' });
  await composer.waitFor();
  await page.request.post('http://localhost:4312/__fixture/hold-chat');
  await composer.fill('Hi buddy');
  await composer.press('Enter');
  const log = page.getByRole('log', { name: 'Conversation', exact: true });
  await log.getByText('Early streamed reply', { exact: true }).waitFor();
  if (await log.getByText('Hello! We can plan before building.', { exact: true }).count()) throw new Error('Final response arrived before barrier release.');
  await page.getByRole('button', { name: 'Stop reply', exact: true }).waitFor();
  await page.request.post('http://localhost:4312/__fixture/release-chat');
  await log.getByText('Hello! We can plan before building.', { exact: true }).waitFor();
  await page.waitForURL(url => !!url.searchParams.get('conversation'));
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor({ state: 'visible' });
  const before = await (await page.request.get('http://localhost:4312/__fixture')).json();
  if (before.counts.projects !== 0 || before.counts.conversations !== 1 || before.conversationCalls !== 1) throw new Error('Greeting created incorrect backend work.');

  // A fresh browser context has no localStorage, cookies or prior in-memory transcript.
  const fresh = await page.context().browser().newContext();
  try {
    const second = await fresh.newPage();
    second.on('pageerror', error => failures.push(error.name));
    await second.goto(`${base}/login`);
    await second.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await second.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await second.getByRole('button', { name: 'Sign in', exact: true }).click();
    await second.getByRole('textbox', { name: 'Message AgentForge' }).waitFor();
    await second.locator('summary[aria-label="Saved conversations"]').click();
    await second.getByRole('button', { name: 'Hi buddy', exact: true }).click();
    await second.getByRole('log', { name: 'Conversation', exact: true }).getByText('Hello! We can plan before building.', { exact: true }).waitFor();
    const restored = await (await second.request.get('http://localhost:4312/__fixture')).json();
    if (restored.conversationCalls !== 1) throw new Error('History restoration repeated model inference.');
    await second.screenshot({ path: 'output/playwright/streaming-chat-restored.png', fullPage: true });

    const input = second.getByRole('textbox', { name: 'Message AgentForge' });
    await input.fill('Build a simple portfolio page for my CV');
    await input.press('Enter');
    await second.getByRole('log', { name: 'Conversation', exact: true }).getByText('Initial saved portfolio snapshot', { exact: true }).waitFor({ timeout: 30000 });
    await second.waitForURL(url => !!url.searchParams.get('project') && !!url.searchParams.get('conversation'));
    await second.reload();
    await second.getByRole('log', { name: 'Conversation', exact: true }).getByText('Hello! We can plan before building.', { exact: true }).waitFor();
    const after = await (await second.request.get('http://localhost:4312/__fixture')).json();
    if (after.conversationCalls !== 2 || after.aiRequests.length !== 1 || after.counts.revisions !== 1) throw new Error('Build/refresh counts changed unexpectedly.');
    await second.screenshot({ path: 'output/playwright/streaming-chat-built.png', fullPage: true });
    await second.request.post('http://localhost:4312/__fixture/hold-chat');
    await input.fill('Hi again');
    await input.press('Enter');
    const secondLog = second.getByRole('log', { name: 'Conversation', exact: true });
    await secondLog.getByText('Early streamed reply', { exact: true }).waitFor();
    await second.getByRole('button', { name: 'Stop reply', exact: true }).click();
    await secondLog.getByText('Reply interrupted; partial text was not accepted. Reload saved chat to check the outcome.', { exact: true }).waitFor();
    if (!(await input.isVisible())) throw new Error('Composer disappeared after interruption.');
  } finally { await fresh.close(); }
  if (failures.length) throw new Error('Uncaught browser errors.');
  return { passed: true, checks: ['early-SSE-through-proxy', 'greeting-no-project', 'fresh-browser-account-history', 'restore-no-inference', 'explicit-build', 'project-linked-chat-refresh', 'cancel-keeps-composer'], provider: 'deterministic HTTP fixture, not live AI' };
}
