const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox']});
  try {
    const samples = [];
    for (const [name, file, workers] of [
      ['optimized-serial', 'index.html', 1],
      ['optimized-workers', 'index.html', undefined]
    ]) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      let html = fs.readFileSync(path.join(root, file), 'utf8');
      html = html.replace(/\}\)\(\);\s*<\/script>/, 'window.qa={runBestSearch,simulate,get P(){return P},get H(){return H}};})();</script>');
      await page.setContent(html); await page.waitForFunction(() => window.qa && qa.H && document.querySelector("#gpuengine").textContent.includes("sensor table ready"));
      {
        const parity = await page.evaluate(() => {
          const full = qa.simulate(), compact = qa.simulate(true);
          return full.N === compact.N && JSON.stringify(full.route) === JSON.stringify(compact.route) && JSON.stringify(full.tracking) === JSON.stringify(compact.tracking) &&
            ['err','ridx','lost'].every(key => full[key].every((v,i) => v === compact[key][i]));
        });
        assert.ok(parity, 'Compact simulation must match displayed simulation');
      }
      const result = await page.evaluate(workers => new Promise(resolve => {
        qa.P.speed = 45;   // Senior is only feasible at low speed with the real-robot calibration
        const before = {...qa.P}, start = performance.now();
        let heartbeats = 0; const timer = setInterval(() => heartbeats++, 20);
        qa.runBestSearch((good, fallback) => {
          clearInterval(timer);
          resolve({ seconds: (performance.now() - start) / 1000, good, fallback, before, after: {...qa.P},
            engine: document.querySelector('#tuneengine')?.textContent, heartbeats, hardwareThreads: navigator.hardwareConcurrency });
        }, () => {}, false, {workers});
      }), workers);
      assert.ok(result.good && result.good.pass === 12, name + ' must finish 12/12');
      assert.equal(JSON.stringify(result.after), JSON.stringify(result.before), name + ' must restore parameters');
      assert.deepEqual(errors, []);
      if (name === 'optimized-workers') {
        assert.match(result.engine, new RegExp(result.hardwareThreads + ' workers')); 
        assert.ok(result.heartbeats > 5, 'Main thread should remain responsive');
      }
      samples.push({ name, ...result });
      await page.close();
    }
    for (const sample of samples.slice(1)) assert.deepEqual(sample.good, samples[0].good, 'Tuning and scores must be deterministic across backends');
    console.log(JSON.stringify(samples.map(s => ({name: s.name, seconds: +s.seconds.toFixed(3), speedup: +(samples[0].seconds/s.seconds).toFixed(2), tune:s.good.c, passes:s.good.pass, engine:s.engine, heartbeats:s.heartbeats, hardwareThreads:s.hardwareThreads})), null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
