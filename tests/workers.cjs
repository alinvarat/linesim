const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.workerCounts = { created: 0, terminated: 0, jobs: [] };
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.jobIndex = workerCounts.created++;
          workerCounts.jobs.push(0);
        }
        postMessage(data, ...args) {
          if (data.c) workerCounts.jobs[this.jobIndex]++;
          return super.postMessage(data, ...args);
        }
        terminate() {
          workerCounts.terminated++;
          return super.terminate();
        }
      };
    });
    await page.goto(pathToFileURL(path.join(__dirname, "../index.html")).href);
    await page.waitForFunction(
      () => document.querySelector("#lapinfo").textContent.length > 0,
    );
    await page.locator("#p_speed").fill("45");
    await page
      .getByRole("button", { name: "Fastest (lap time)", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        /12 of 12 runs/.test(
          document.querySelector("#presetnote").textContent,
        ),
      null,
      { timeout: 120000 },
    );
    const threads = await page.evaluate(
      () => navigator.hardwareConcurrency || 2,
    );
    assert.match(
      await page.locator("#tuneengine").textContent(),
      new RegExp(threads + " workers"),
    );
    let counts = await page.evaluate(() => workerCounts);
    // Best may relax its safety margins and search again (a new worker pool per tier): whole pools only, all terminated.
    assert.ok(counts.created >= threads && counts.created % threads === 0);
    assert.equal(counts.terminated, counts.created);
    assert.ok(
      counts.jobs.every((n) => n > 0),
      "Every available CPU worker must execute candidates",
    );
    const fixedTune = await page.evaluate(() => [
      document.querySelector("#p_Kp").value,
      document.querySelector("#p_Kd").value,
    ]);
    const start = Date.now();
    await page
      .getByRole("button", { name: "Fastest (lap time)", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        /^Fastest .*12 of 12 runs/.test(
          document.querySelector("#presetnote").textContent,
        ),
      null,
      { timeout: 180000 },
    );
    const speed = +(await page.locator("#p_speed").inputValue());
    assert.ok(speed >= 30 && speed <= 255);
    counts = await page.evaluate(() => workerCounts);
    assert.equal(
      counts.created,
      counts.terminated,
      "Completed searches must release every worker",
    );
    console.log(
      JSON.stringify({
        fileOrigin: true,
        maxSeconds: (Date.now() - start) / 1000,
        speed: speed,
        workers: counts,
      }),
    );
    await page.close();

    const fallback = await browser.newPage();
    await fallback.evaluate(() => {
      const NativeWorker = Worker;
      const url = URL.createObjectURL(
        new Blob(['throw new Error("test worker crash");'], {
          type: "text/javascript",
        }),
      );
      window.Worker = class extends NativeWorker {
        constructor() {
          super(url);
        }
      };
    });
    await fallback.setContent(
      fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"),
    );
    await fallback.waitForFunction(
      () => document.querySelector("#lapinfo").textContent.length > 0,
    );
    await fallback.locator("#p_speed").fill("45");
    await fallback
      .getByRole("button", { name: "Fastest (lap time)", exact: true })
      .click();
    await fallback.waitForFunction(
      () =>
        /12 of 12 runs/.test(
          document.querySelector("#presetnote").textContent,
        ),
      null,
      { timeout: 120000 },
    );
    assert.match(await fallback.locator("#tuneengine").textContent(), /1 thread/);
    assert.equal(await fallback.locator("#p_Kp").inputValue(), fixedTune[0]);
    assert.equal(await fallback.locator("#p_Kd").inputValue(), fixedTune[1]);
    console.log("Worker crash fallback: same 12/12 tune on one thread");
    await fallback.close();
    const validationFallback = await browser.newPage();
    await validationFallback.evaluate(() => {
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        postMessage(data, ...args) {
          if (data.full) {
            queueMicrotask(() => this.onerror?.({ preventDefault() {} }));
            return;
          }
          return super.postMessage(data, ...args);
        }
      };
    });
    await validationFallback.setContent(
      fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"),
    );
    await validationFallback.waitForFunction(
      () => document.querySelector("#lapinfo").textContent.length > 0,
    );
    await validationFallback.locator("#p_speed").fill("45");
    await validationFallback
      .getByRole("button", { name: "Fastest (lap time)", exact: true })
      .click();
    await validationFallback.waitForFunction(
      () =>
        /12 of 12 runs/.test(
          document.querySelector("#presetnote").textContent,
        ),
      null,
      { timeout: 120000 },
    );
    assert.match(
      await validationFallback.locator("#tuneengine").textContent(),
      /1 thread/,
    );
    assert.equal(
      await validationFallback.locator("#p_Kp").inputValue(),
      fixedTune[0],
    );
    assert.equal(
      await validationFallback.locator("#p_Kd").inputValue(),
      fixedTune[1],
    );
    console.log(
      "Validation fallback: cached screening trials preserve the same 12/12 winner",
    );
    await validationFallback.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
