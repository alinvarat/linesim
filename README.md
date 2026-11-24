# LineSim

> English | [ภาษาไทย](README.th.md)

You can open `index.html` directly in a browser. To use the GPU on this Debian machine, launch it with:

```sh
./run-gpu.sh
```

The launcher uses a separate Chrome profile at `~/.cache/linesim-chrome-gpu` (the main profile is not modified) and enables Vulkan/WebGPU following [Chrome's guidance](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips). The screen shows `GPU amd` with a "sensor table ready" status when the AMD GPU is actually usable. If no adapter is available, the sensor table is prepared on the CPU instead and this is reported truthfully; it does not fall back to re-reading the light-sensing area 5 times on every step.

## Sensors and GPU

The simulator adds no random noise. There is no noise parameter or noise control, either in the simulation loop or in record/replay. Real data from the robot is left unchanged.

The source of `getCalibratedValue()` / `calPoint()` in the 16-channel sensor library source (not published) has been checked: the library rescales the White/Black range and applies a deadband of `difWhite=20`, `difBlack=10` before computing the position as a weighted average. The simulator uses an ideal signal after the light settings requested, so it does not add Gaussian noise on top of this signal. This does not confirm that the real hardware is free of interference in every case.

The 12 checks use different starting positions across the line, from -0.5 to +0.5 cm, including a starting angle of +1°. They are not claimed to be 12 random noise sets.

The GPU uses a compute shader to prepare a table of the sensors' light-sensing area with 2,430,000 points per track. Then CPU workers on every thread the browser makes available use this table to read the sensors while searching for tuning values. Tables are cached per track, and the GPU buffers/device are released once preparation is done. So the GPU is not run full-time throughout tuning, and PID/physics are not all moved to the GPU.

The GPU table uses f32, but PID/physics still use JavaScript f64. Near the track edge, or for values where sensor rounding could change, it falls back to the original formula. Comparing reads at 50,000 positions, the integer sensor values matched the CPU at every position, and full-lap run histories were tested to match at every step.

Measurements before the route index was added, at Best speed 90 on an AMD GPU + Ryzen 5 5625U, in a test run with no other tests running alongside: CPU 12 workers 2.779 s, GPU-assisted CPU 12 workers 2.354 s (excluding the first-time table preparation of about 81 ms). Tuning values and scores matched. The GPU table was used in the workers about 51.5 million times. Timings may vary with machine load, track and driver.

## Tuning criteria

The criteria are **few line deviations, continuous curve following, and fast lap times**. Kp, Kd and slowrage are searched together, followed by a fine search around promising sets. Finishing all 12 starting points is used to check consistency, while ranking uses line-following quality combined with time.

- **Best (line following + time)** keeps the speed set by the user.
- **Fastest (continuous line following)** searches speed 30–250 in steps of 10, plus 255 and the current speed, then searches further at -10, -5, 0, +5, +10 around the 24 most promising sets. It checks up to 96 finalists, and does not stop just because a high PWM value finished the run.

Deviation is measured as the distance from the sensor row to the reference route exceeding 2 cm, with total time, longest continuous stretch, and the portion within curves reported separately. Curves are referenced from the route geometry. The 2 cm deviation is only a lightly weighted ranking aid and is not used in place of losing the line. If the sensors still see the line, it is not counted as a stretch of lost line-following in a curve. Sensors not seeing the line is measured from all-zero readings across the row and reported separately.

Score per run (lower is better, cost units equivalent to seconds) = lap time + 0.1×time deviated beyond 2 cm + 0.2×time deviated in curves + 4×time sensors do not see the line + 6×time sensors do not see the line in curves + 6×longest continuous stretch not seeing the line + 8×longest continuous stretch not seeing the line in curves + 0.25×curve RMS distance (cm). Across tests these are combined as 75% mean and 25% worst-scoring run. Sets that finish all 12 runs are selected first, then the lowest score is chosen. The multipliers are the tuner's default values. Sensors moving off the centre of the line while entering a curve normally is not considered losing the line.

The selection trades some aspects of quality against time. It does not guarantee improvement on every metric, nor that the result is the optimal value among all possibilities. The simulation duration uses the value set on screen. If no set passes completely, partial results are shown and marked as not yet meeting the criteria. All results come from the simulation model and have not yet been confirmed on the real robot.

## Tests

Uses Node.js and Google Chrome on Linux:

```sh
npm install
npm test
npm run test:workers
npm run test:objective
npm run test:gpu
npm run bench
npm run test:optimization
```

Set `CHROME_PATH` if Chrome is in a different location; the default is `/usr/bin/google-chrome`. The GPU test requires access to a hardware adapter, while the general tests also check the CPU fallback path.

- `test`: presses Best in the browser and checks the displayed run of 12 starting points, value restoration, caching, and cancelling work in progress.
- `test:workers`: opens from file, checks that every worker computed and returned completely, tests Fastest mode, and continuing the computation when a worker fails.
- `test:objective`: checks scoring under the three criteria and the selected tuning set on the Senior track.
- `test:gpu`: uses the hardware GPU to check 50,000 values, full-lap run history, tuning results versus CPU, table use in workers, and track switching.
- `bench`: compares a single thread against all CPU workers using the same criteria; the results must match.

Files from before each stage of changes are in `.backups/`. Measurement data from before noise was removed is in `README-before-noise-gpu-20261112.md` in that folder. It is kept as history and is not used to compare run results directly against the current model.

## Reducing route search work and repeated simulation

The old route check compared against up to 281 points on every PID step. The current version uses a bounding-box tree over the route to skip groups of points that cannot be closer than the point already found. It still searches within the original index range and picks the lower index when distances are equal; it does not approximate the route. A check of 32,000 positions covering all 5 tracks must give the same point and distance as the old exhaustive comparison for every value.

The 12-start confirmation run reuses the results of 3 starting points already computed during screening, by storing per-run values and summing them in the original order. It does not create duplicate results and does not reduce the number of starting points checked, the number of tuning sets, or the grid resolution.

Fastest-mode measurement on Senior with GPU+CPU 12 workers: 11.315 s before the change, 6.292 s after, about 1.80× faster in this run. Tuning values, all scores and run histories matched. The pre-change file is at `.backups/index-before-route-index-20261112.html`, and this can be re-checked with `npm run test:optimization`.

GPU-assisted Best took 1.429 s in the post-change test run (CPU 12 workers alone: 1.961 s). In the test where workers fail during confirmation, the CPU fallback continued the computation from the cached screening data and produced the same tuning set over all 12 starting points.

The fallback when the GPU is unavailable also uses a table prepared on the CPU. Run histories and tuning values were checked to match the original formula. Fastest mode, opened as a file in normal Chrome, took about 6.486 s in this test run, without needing to enable the GPU first.

## Physics and reference points from the real robot

The shared mechanics core used by simulation, auto tune, record/replay and reconstruction was changed to DC motor force/torque/inertia, wheel normal load under acceleration, a combined friction circle for acceleration and cornering, contact impulse for sliding, rolling resistance, and nose-lift/fall-back moment with gravity. Sensor signal decreases with height. The old acceleration/turning lag and the sensor-blackout timer were removed.

Read [MODEL_NOTES.md](MODEL_NOTES.md) for the equations, default values and limitations. Centre of gravity, inertia, fan force and light sensing are still values that must be measured on the real robot. They can be adjusted in the robot settings, and changing them triggers a full recomputation of runs and tuning searches.

The reference values `ATrack(100,.08,0,.004,-255,0,3500)` and `ATrack(80,.08,0,.0024,-255,0,4500)` pass Formula μ=3 at all 12/12 starting points with no stretch where the sensors lose the line in the new model. The 3.5/4.5-second command periods from the track start were also checked. This result does not confirm that the speed/trajectory matches the real robot.

AccelSet is set jointly in the tuning panel and applies to all modes. Default (.17,80); rate=0 disables it. It limits only the launch up to the first speed; after that, consecutive commands can change the target immediately, as in Pro 2.0.1. The first PID cycle uses the pre-start wait period, default 500 ms as in the examples; subsequent cycles use 5 ms.

When the tyres or physics values are changed, a recomputation status is shown. Results that do not complete all 12 runs are not stored as successes and do not automatically overwrite the existing tuning values. The currently selected Best/Fastest button can be pressed again to recompute. Use of successful cached results is clearly indicated.

## Checking results

`npm run test:physics` checks the mechanical requirements; `npm run test:firmware-timing` checks both ref sets; `npm run test:accel` checks speed ramping; `npm test` and `npm run test:grip` check tuning/recomputation; `npm run test:gpu` checks the hardware GPU and agreement with the CPU; `npm run test:workers` checks all threads and Max; `npm run bench` measures timing in the current machine state.

The benchmark figures in the earlier sections are for the model before the physics change and do not certify the timing of the new force core. The source before the change is kept at `.backups/index-before-full-physics-20261112.html`.

Benchmark results for the new force core on this machine (Senior, Best speed90, sensor table ready, no other tests running alongside): single thread 6.724 s, CPU 12 workers 1.853 s, or 3.63×. Tuning values/scores matched and 12/12 finished. Max, from another workers check, took about 10.22 s. Figures depend on machine load and track.

## Record -> replay and tuned defaults (2026-11-13)
The default tune is the one used on the real robot: speed 90, Kp 0.15, Kd 0.003, AccelSet(0.17, 80), AReplay(0.75). The record -> replay mode runs the same logic as library version 2.0.2 (see MODEL_NOTES.md).
