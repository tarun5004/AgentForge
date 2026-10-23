// CLI-only verification of actual exported bytes: this is not a production provider mode.
async (page) => {
  await page.getByRole('heading', { name: 'AgentForge real Docker preview' }).waitFor();
  const background = await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
  if (background !== 'rgb(12, 34, 56)') throw new Error('Saved global CSS was not applied in the browser.');
  const button = page.getByRole('button', { name: 'Count 0', exact: true });
  await button.click();
  await page.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
  const isolated = await page.evaluate(async () => {
    let storageBlocked = false;
    let networkBlocked = false;
    try { localStorage.getItem('probe'); } catch { storageBlocked = true; }
    try { await fetch(location.href); } catch { networkBlocked = true; }
    return { storageBlocked, networkBlocked };
  });
  if (!isolated.storageBlocked || !isolated.networkBlocked) throw new Error('Preview browser isolation failed.');
}
