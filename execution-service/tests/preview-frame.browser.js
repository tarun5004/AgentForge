// Check actual browser CSP behavior, not a mocked HTTP response or a paid model.
async (page) => {
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Frame policy fixture' }).waitFor();
  await frame.getByRole('button', { name: 'Click me', exact: true }).click();
  await frame.getByRole('button', { name: 'Clicked', exact: true }).waitFor();
  if (await page.locator('iframe').getAttribute('sandbox') !== 'allow-scripts') throw new Error('Iframe sandbox changed.');
  const isolated = await frame.locator('body').evaluate(async () => {
    let storageBlocked = false;
    let networkBlocked = false;
    try { localStorage.getItem('probe'); } catch { storageBlocked = true; }
    try { await fetch(location.href); } catch { networkBlocked = true; }
    return storageBlocked && networkBlocked;
  });
  if (!isolated) throw new Error('Custom parent weakened preview isolation.');
  let ancestorBlocked = false;
  page.on('console', message => { if (message.text().includes('frame-ancestors')) ancestorBlocked = true; });
  await page.getByRole('link', { name: 'Other parent', exact: true }).click();
  await page.getByRole('heading', { name: 'Other parent', exact: true }).waitFor();
  const deadline = Date.now() + 5_000;
  while (!ancestorBlocked && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (!ancestorBlocked || await page.frameLocator('iframe').getByRole('heading', { name: 'Frame policy fixture' }).count()) {
    throw new Error('A non-allowlisted parent embedded the preview.');
  }
}
