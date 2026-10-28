// Real Next/Auth/Project/Mongo/Execution/Docker; only model output and one lost HTTP response are fixtures.
async (page) => {
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  const fixture = 'http://localhost:4312';
  const status = async () => (await page.request.get(`${fixture}/__fixture`)).json();
  const email = 'frontend-slice5-20261012@agentforge.test';
  const password = 'Disposable-test-password-13';
  const registered = await page.request.post('http://localhost:4310/api/auth/register', { data: { name: 'Repair test owner', email, password } });
  if (registered.status() !== 201) throw new Error('Disposable registration failed.');
  await page.goto('http://localhost:3102/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message AgentForge' });
  await composer.fill('Build a small portfolio with broken preview syntax');
  await composer.press('Enter');
  const repair = page.getByRole('button', { name: 'Repair once (uses AI tokens)', exact: true });
  await repair.waitFor();
  const failed = await status();
  if (failed.repairCalls !== 0 || failed.counts.revisions !== 0 || failed.aiRequests.length !== 1) throw new Error('Failure triggered automatic repair/publication.');
  if (!(await composer.isVisible()) || !(await composer.isEnabled())) throw new Error('Composer unavailable after failed build.');
  await page.reload();
  await repair.waitFor();
  if ((await status()).repairCalls !== 0) throw new Error('Reload inferred without a click.');

  // Lose only the first accepted response, proving that reload/retry retains the repair endpoint and key.
  const posts = [];
  await page.route('**/api/projects/*/generations/*/repair', async route => {
    posts.push({ url: route.request().url(), body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    const response = await route.fetch();
    if (posts.length === 1) {
      if (response.status() !== 202) throw new Error('Repair was not accepted before response-loss injection.');
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Simulated lost proxy response' });
    } else await route.fulfill({ response });
  });
  await page.request.post(`${fixture}/__fixture/hold-check`);
  await repair.click();
  const retry = page.getByRole('button', { name: 'Retry same attempt', exact: true });
  await retry.waitFor();
  await page.reload();
  await retry.waitFor();
  const accepted = await status();
  if (accepted.repairCalls !== 1 || accepted.counts.revisions !== 0) throw new Error('Unknown result was mistaken for publication or repeated inference.');
  await retry.click();
  await page.request.post(`${fixture}/__fixture/release-check`);
  const log = page.getByRole('log', { name: 'Conversation', exact: true });
  await log.getByText('Repaired portfolio snapshot', { exact: true }).waitFor();
  if (posts.length !== 2 || JSON.stringify(posts[0]) !== JSON.stringify(posts[1])) throw new Error('Replay changed the repair endpoint, key or body.');
  const ready = await status();
  if (ready.repairCalls !== 1 || ready.counts.revisions !== 1 || ready.checks.completed !== 1) throw new Error('Fresh build/publication evidence is missing.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Generated frontend preview"]');
  await frame.getByRole('heading', { name: 'Repaired portfolio preview', exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
  await frame.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/explicit-repair-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  if (errors.length) throw new Error('Uncaught browser error during repair.');
  return { passed: true, checks: ['no-auto-repair', 'failed-composer-usable', 'reload-no-inference', 'lost-response-stable-repair-key', 'fresh-Docker-gate-publication', 'interactive-repaired-preview'], provider: 'deterministic AI HTTP, real Docker builds' };
}
