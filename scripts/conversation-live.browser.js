// This CLI scenario uses real APIs and a real model. No response, generated file or Preview is intercepted.
async (page) => {
  let token = null;
  let pageErrors = 0;
  let externalRequests = 0;
  let generationPosts = 0;
  const conversationRequests = [];
  page.on('pageerror', () => { pageErrors++; });
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/generations$/.test(path)) generationPosts++;
    if (request.method() === 'POST' && path === '/api/conversations') conversationRequests.push(request.postDataJSON());
  });
  // Generated preview must stay local; the API key is never exposed to this browser.
  await page.context().route('**/*', route => {
    if (['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)) return route.continue();
    externalRequests++;
    return route.abort();
  });
  const origin = 'http://localhost:3102';
  const textbox = page.getByRole('textbox', { name: 'Message AgentForge', exact: true });
  const sendButton = page.getByRole('button', { name: 'Send message', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Saved revision preview' });

  // Wait for the exact request before inspecting its answer; UI timers alone are not evidence of inference.
  async function send(message) {
    await textbox.fill(message);
    await sendButton.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Send message"]');
      return button && !button.disabled;
    });
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/conversations' && response.request().method() === 'POST', { timeout: 100_000 }),
      textbox.press('Enter'),
    ]);
    if (!response.ok()) throw new Error(`Conversation API failed with HTTP ${response.status()}; no automatic retry.`);
    const body = await response.json();
    if (!body.response?.message?.trim()) throw new Error('Conversation returned no assistant message.');
    return body.response;
  }

  // Read persisted snapshots through owner-authenticated production routes, not browser display caches.
  async function read(path) {
    const response = await fetch(`http://127.0.0.1:4311${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok()) throw new Error(`Persisted API read failed: HTTP ${response.status()}.`);
    return response.json();
  }

  // A build badge is required before checking the independently built, sandboxed browser preview.
  async function preview(heading, screenshot) {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = dialog.frameLocator('iframe');
    await frame.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 180_000 });
    if (await dialog.locator('iframe').getAttribute('sandbox') !== 'allow-scripts') throw new Error('Preview iframe sandbox changed.');
    await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
    await frame.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
    await page.screenshot({ path: `output/playwright/${screenshot}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Preview stopped.' }).waitFor({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close preview', exact: true }).click();
  }

  await page.goto(`${origin}/register`);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Demo Student');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('conversation-live-owner@agentforge.test');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Disposable-test-password-26');
  const [registration] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Create account', exact: true }).click(),
  ]);
  if (registration.status() !== 201) throw new Error('Disposable registration failed.');
  token = (await registration.json()).accessToken;
  if (!token) throw new Error('Disposable registration returned no session.');
  await textbox.waitFor();

  const greeting = await send('Hi');
  if (greeting.action !== 'reply') throw new Error('A greeting should reply without starting a build.');
  const planning = await send('Help me plan a simple frontend portfolio. Explain a short plan only; do not build or change files yet.');
  if (planning.action === 'build') throw new Error('Planning unexpectedly started a build.');
  if ((await read('/api/projects')).projects.length !== 0 || generationPosts !== 0) throw new Error('Greeting or planning created a project/generated code.');

  const initial = await send('Build it now. Make a static React/Next.js portfolio for Demo Student, an AI engineering student. Use the exact hero heading "Local AI Portfolio", About, Projects and Contact sections, a navy background, and plain CSS. Include a client-side counter whose button text starts exactly "Count 0" and changes to "Count 1" when clicked. Use synthetic placeholder contact details. No external imports, APIs, images, packages or backend. Choose all other design details yourself; no more questions.');
  if (initial.action !== 'build') throw new Error('The complete explicit build request did not start generation.');
  await page.getByText('Viewing v1', { exact: true }).waitFor({ timeout: 180_000 });
  const projectId = new URL(page.url()).searchParams.get('project');
  if (!/^[a-f\d]{24}$/i.test(projectId ?? '')) throw new Error('No saved project URL after generation.');
  const history1 = await read(`/api/projects/${projectId}/revisions`);
  if (history1.revisions.length !== 1) throw new Error('Initial build did not save exactly one revision.');
  const first = (await read(`/api/projects/${projectId}/revisions/${history1.revisions[0].id}`)).revision;
  if (first.buildVerification?.status !== 'build_passed') throw new Error('Initial revision has no real candidate-build evidence.');
  const originalFiles = JSON.stringify(first.files);
  await preview('Local AI Portfolio', 'conversation-live-v1');
  await page.reload();
  await page.getByText('Viewing v1', { exact: true }).waitFor();
  await textbox.waitFor();
  if (generationPosts !== 1) throw new Error('Refresh unexpectedly regenerated code.');

  const followup = await send('Change only the hero heading from "Local AI Portfolio" to exactly "Hello, Future AI Engineer". Keep every other file and the existing counter behavior unchanged. Apply this edit now.');
  if (followup.action !== 'build') throw new Error('Explicit follow-up edit did not start generation.');
  const selected = conversationRequests.at(-1);
  if (selected.projectId !== projectId || selected.baseRevisionId !== first.id) throw new Error('Follow-up did not submit the selected persisted base.');
  await page.getByText('Viewing v2', { exact: true }).waitFor({ timeout: 180_000 });
  const history2 = await read(`/api/projects/${projectId}/revisions`);
  if (history2.revisions.length !== 2) throw new Error('Follow-up did not save exactly a second revision.');
  const second = (await read(`/api/projects/${projectId}/revisions/${history2.revisions[0].id}`)).revision;
  if (second.parentRevisionId !== first.id || second.buildVerification?.status !== 'build_passed') throw new Error('Follow-up lost selected parent/build evidence.');
  const reloadedFirst = (await read(`/api/projects/${projectId}/revisions/${first.id}`)).revision;
  if (JSON.stringify(reloadedFirst.files) !== originalFiles) throw new Error('Published v1 was modified.');
  const changed = second.files.filter(file => first.files.find(old => old.path === file.path)?.content !== file.content);
  if (changed.length !== 1 || second.files.length !== first.files.length || !changed[0].content.includes('Hello, Future AI Engineer')) {
    throw new Error('Targeted follow-up changed unrelated files or did not make the requested edit.');
  }
  await preview('Hello, Future AI Engineer', 'conversation-live-v2');
  await page.reload();
  await page.getByText('Viewing v2', { exact: true }).waitFor();
  await textbox.waitFor();
  if (conversationRequests.length !== 4 || generationPosts !== 2 || pageErrors || externalRequests) throw new Error('Unexpected repeat calls, browser error or external dependency.');
  await page.screenshot({ path: 'output/playwright/conversation-live-restored.png', fullPage: true });
  return { passed: true, conversationRequests: conversationRequests.length, generationRequests: generationPosts,
    checks: ['greeting', 'planning-without-project', 'generated-v1', 'interactive-preview', 'refresh', 'selected-base-followup', 'immutable-v1', 'generated-v2', 'interactive-v2', 'restored-v2'] };
}
