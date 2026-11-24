const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Expose the existing closure only in this test page; production stays standalone.
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const html = source.replace(/\}\)\(\);\s*<\/script>/,
      'window.qa={get P(){return P},get H(){return H},validateTune,envKey,get running(){return !!activeTuneRunner}};})();</script>');
    await page.setContent(html);
    await page.waitForFunction(() => window.qa && qa.H);
    assert.equal(await page.locator('#p_noise').count(), 0, 'Noise control must be removed');
    assert.ok(await page.evaluate(() => !Object.hasOwn(qa.P, 'noise')), 'No synthetic noise parameter');
    const original = await page.evaluate(() => ({ ...qa.P }));
    await page.locator('#p_speed').fill('45');
    await page.getByRole('button', { name: 'Fastest (lap time)', exact: true }).click();
    await page.waitForFunction(() => /12 of 12 runs/.test(document.querySelector('#presetnote').textContent), null, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const before = { ...qa.P };
      const c = [qa.P.Kp, qa.P.Kd, qa.P.slow, qa.P.speed];
      const pass = qa.validateTune(c, -1);
      return { c, pass, before, after: { ...qa.P }, route: qa.H.route, note: document.querySelector('#presetnote').textContent };
    });
    assert.equal(result.pass, 12, 'Chosen tune must finish all twelve trials');
    assert.ok(result.route.finish >= 0 && result.route.back <= 2, 'Displayed run must finish');
    assert.deepEqual(result.after, result.before, 'Validation must restore simulation parameters');
    for (const key of ['sx','sy','sth','T','mass','deadS','biasX']) assert.equal(result.after[key], original[key], key);
    await page.screenshot({ path: '/tmp/linesim-autotune-verified.png', fullPage: true });
    const cacheCheck = await page.evaluate(() => {
      const key = qa.envKey(); const fields = ['deadS','biasX','tb','mass','cgForward','cgHeight','yawInertia','rolling','downforce','sensorRange','load','lat','T'];
      return fields.every(field => { const v = qa.P[field]; qa.P[field] = v + 1; const changed = qa.envKey() !== key; qa.P[field] = v; return changed; });
    });
    assert.ok(cacheCheck, 'Every physical setting must invalidate cached tuning');
    await page.getByRole('button', { name: 'Manual tune', exact: true }).click();
    await page.locator('details').filter({has: page.locator('#p_bias')}).evaluate(details => { details.open = true; });
    await page.locator('#p_bias').fill('0.092');
    await page.locator('#p_bias').dispatchEvent('input');
    const manual = await page.evaluate(() => ({ ...qa.P }));
    await page.locator('#p_speed').fill('45');
    await page.getByRole('button', { name: 'Fastest (lap time)', exact: true }).click();
    await page.waitForFunction(() => qa.running);
    assert.ok(await page.evaluate(() => qa.running), 'Cancellation must exercise an active search');
    await page.getByRole('button', { name: 'Manual tune', exact: true }).click();
    assert.equal(await page.evaluate(() => qa.running), false, 'Cancellation must stop workers immediately');
    await page.waitForTimeout(500); // allow the cancelled search's queued callback to run
    const cancelled = await page.evaluate(() => ({ ...qa.P }));
    assert.deepEqual(cancelled, manual, 'Cancelled search must not overwrite manual parameters');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ course: 'senior', speed: result.c[3], tune: result.c, passes: result.pass, displayedFinish: result.route.finish, checks: ['validation','displayed run','parameter restoration','cache invalidation','cancellation','browser errors'] }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
