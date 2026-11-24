const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const html = fs
      .readFileSync(path.join(__dirname, "../index.html"), "utf8")
      .replace(
        /\}\)\(\);\s*<\/script>/,
        "window.qa={Plant,sensorReading,simulateRR,reconstruct,simulateU,setDt(v){DT=v},get P(){return P},get H(){return H}};})();</script>",
      );
    await page.setContent(html);
    await page.waitForFunction(() => window.qa && qa.H);
    // Fixtures of the mechanics tests were baselined with the earlier tyre/motor calibration (mu 2, load 0.8); the record lap runs to the end of the course (TotalTime unlimited)
    await page.evaluate(() => { qa.P.mu = 2; qa.P.load = 0.8; qa.P.loadReal = 0.8; qa.P.lat = 12; qa.P.yawInertia = 0.00075; qa.P.recMs = 0; });
    const r = await page.evaluate(() => {
      const base = {
        ...qa.P,
        bias: 0,
        biasX: 0,
        lat: 0,
        rolling: 0,
        mu: 3,
        cgForward: 3,
        cgHeight: 2,
        load: 0.46,
      };
      function run(params, L, R, n = 200) {
        const p = new qa.Plant({ ...base, ...params }, 0, 0, 0);
        for (let i = 0; i < n; i++) p.step(L, R);
        return p;
      }
      const rest = run({}, 0, 0),
        straight = run({}, 80, 80),
        reverse = run({}, -80, -80),
        turn = run({}, 100, 60),
        mirror = run({}, 60, 100);
      const coast = run({}, 80, 80);
      const speedBefore = coast.vel;
      for (let i = 0; i < 200; i++) coast.step(0, 0);
      const brake = run({}, 80, 80);
      for (let i = 0; i < 10; i++) brake.step(-80, -80);
      const light = run({ mu: 10, mass: 0.2 }, 30, 30, 5),
        heavy = run({ mu: 10, mass: 0.4 }, 30, 30, 5);
      const lowI = run({ mu: 10, yawInertia: 0.0004 }, 40, -40, 5),
        highI = run({ mu: 10, yawInertia: 0.0012 }, 40, -40, 5);
      const lowMu = run({ mu: 1 }, 40, 40, 1200),
        highMu = run({ mu: 3 }, 40, 40, 1200);
      const launch = new qa.Plant({ ...base, cgHeight: 4, mu: 3 }, 0, 0, 0);
      let maxPitch = 0,
        minFront = 1e9,
        maxUse = 0,
        maxNormalError = 0;
      for (let i = 0; i < 5; i++) {
        launch.step(255, 255);
        maxPitch = Math.max(maxPitch, launch.pitch);
      }
      const pitchAfterLaunch = launch.pitch;
      for (let i = 0; i < 400; i++) launch.step(0, 0);
      const coupled = new qa.Plant({ ...base, mu: 1.5 }, 0, 0, 0);
      for (let i = 0; i < 2000; i++) {
        coupled.step(
          130 + 80 * Math.sin(i * 0.01),
          130 - 80 * Math.sin(i * 0.01),
        );
        maxUse = Math.max(maxUse, coupled.tractionUse);
        minFront = Math.min(minFront, coupled.frontNormal);
        maxNormalError = Math.max(
          maxNormalError,
          Math.abs(coupled.frontNormal + coupled.rearNormal - 0.2 * 9.81),
        );
      }
      const noFan = run({ mu: 1 }, 255, 255, 10),
        fan = run({ mu: 1, downforce: 2 }, 255, 255, 10);
      // Place the raised row on the same line: attenuation must depend on height, not a timer.
      const optics = new qa.Plant(
        base,
        qa.P.sx,
        qa.P.sy,
        (qa.P.sth * Math.PI) / 180,
      );
      let ground = 0,
        raised = 0;
      const c = Math.cos(optics.th),
        s = Math.sin(optics.th);
      for (let i = 0; i < 16; i++) ground += qa.sensorReading(optics, i, c, s);
      optics.pitchSin = 0.1;
      for (let i = 0; i < 16; i++) raised += qa.sensorReading(optics, i, c, s);
      // No input may not add kinetic energy, including during a turn.
      const unpowered = run({}, 100, 60),
        energy = (p) =>
          0.5 * 0.2 * (p.vx * p.vx + p.vy * p.vy) +
          0.5 * 0.00075 * p.yawRate * p.yawRate +
          0.5 * p.wheelMass * (p.wheelL * p.wheelL + p.wheelR * p.wheelR);
      let previousEnergy = energy(unpowered),
        maxEnergyGain = 0;
      for (let i = 0; i < 200; i++) {
        unpowered.step(0, 0);
        const e = energy(unpowered);
        maxEnergyGain = Math.max(maxEnergyGain, e - previousEnergy);
        previousEnergy = e;
      }
      const coarse = run({}, 100, 60);
      qa.setDt(0.0025);
      const fine = run({}, 100, 60, 400);
      qa.setDt(0.005);
      const convergence = {
        coarse: { x: coarse.x, y: coarse.y, th: coarse.th },
        fine: { x: fine.x, y: fine.y, th: fine.th },
      };
      const pick = (p) => ({
        x: p.x,
        y: p.y,
        th: p.th,
        v: p.vel,
        yaw: p.yawRate,
        pitch: p.pitch,
      });
      return {
        maxEnergyGain,
        convergence,
        rest: pick(rest),
        straight: pick(straight),
        reverse: pick(reverse),
        turn: pick(turn),
        mirror: pick(mirror),
        coast: { before: speedBefore, after: coast.vel },
        brake: brake.vel,
        light: light.vel,
        heavy: heavy.vel,
        lowI: lowI.yawRate,
        highI: highI.yawRate,
        lowMu: lowMu.vel,
        highMu: highMu.vel,
        maxPitch,
        pitchAfterLaunch,
        landed: launch.pitch,
        maxUse,
        minFront,
        maxNormalError,
        noFan: noFan.vel,
        fan: fan.vel,
        optics: { ground, raised },
      };
    });
    assert.equal(r.rest.v, 0);
    assert.equal(r.rest.x, 0);
    assert.equal(r.rest.y, 0);
    assert.ok(
      r.straight.v > 0 &&
        Math.abs(r.straight.y) < 1e-10 &&
        Math.abs(r.straight.th) < 1e-10,
    );
    assert.ok(r.reverse.v < 0 && r.reverse.x < 0);
    assert.ok(r.turn.th > 0 && r.mirror.th < 0);
    assert.ok(Math.abs(r.turn.th + r.mirror.th) < 1e-9);
    assert.ok(
      Math.abs(r.coast.before - r.coast.after) < 1e-4,
      "Zero command must coast (residual only from wheel/body slip equalisation)",
    );
    assert.ok(r.brake < r.coast.before);
    assert.ok(
      r.light > r.heavy,
      "Mass must affect unsaturated motor acceleration",
    );
    assert.ok(r.lowI > r.highI, "Yaw inertia must affect rotation");
    assert.ok(
      Math.abs(r.lowMu - r.highMu) < 1e-6,
      "Grip must not increase no-load RPM",
    );
    assert.ok(
      r.maxUse <= 1 + 1e-10 && r.minFront >= 0 && r.maxNormalError < 1e-10,
      "One friction circle and conserved nonnegative normal load",
    );
    assert.ok(
      r.pitchAfterLaunch > 0 && r.landed === 0,
      "Lift must respond to torque and land under gravity",
    );
    assert.ok(r.fan > r.noFan, "Downforce must raise available traction");
    assert.ok(
      r.optics.ground > 0 && r.optics.raised < r.optics.ground,
      "Sensor height must reduce optical signal",
    );
    assert.ok(
      r.maxEnergyGain < 1e-10,
      "Unpowered tyre contact must not add kinetic energy",
    );
    assert.ok(
      Math.hypot(
        r.convergence.coarse.x - r.convergence.fine.x,
        r.convergence.coarse.y - r.convergence.fine.y,
      ) < 2,
      "Halving the physics step must converge within 2 cm in a one-second turn",
    );
    // All consumers must produce finite state with the new shared Plant.
    const modes = await page.evaluate(() => {
      Object.assign(qa.P, {
        Kp: 0.1,
        Kd: 0.004,
        Ki: 0,
        speed: 40,
        slow: 0,
        rrRatio: 1,
        rrSS: 40,
      });
      const rr = qa.simulateRR(),
        real = qa.reconstruct();
      qa.P.lapStop = 0;
      const u = qa.simulateU();
      return [rr, real, u].map((h) => ({
        N: h.N,
        finite: ["x", "y", "th", "v"].every((key) =>
          Array.from(h[key]).every(Number.isFinite),
        ),
        ok: h.ok,
        recordOk: h.rr && h.rr.rec.ok,
      }));
    });
    assert.ok(modes.every((m) => m.N > 0 && m.finite));
    assert.equal(modes[0].recordOk, true);
    assert.equal(modes[0].ok, true);
    await page
      .locator("details.env")
      .filter({ has: page.locator("#env") })
      .evaluate((d) => (d.open = true));
    await page
      .locator("details.env")
      .filter({ has: page.locator("#env") })
      .screenshot({ path: "/tmp/linesim-physics-controls.png" });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...r, modes }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
