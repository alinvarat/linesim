> This note is also available in Thai: [MODEL_NOTES.th.md](MODEL_NOTES.th.md)
# LineSim physics — 12 November 2026

The entire Plant shared by the simulation loop, auto tune, ARecord/AReplay and route reconstruction from logs was changed; this is not just a change to the tuning score. The user's reference values are used to check behaviour after the change; they were not used to find CG/motor force by adjusting until they pass.

## Equations and what changed

- Mechanics are computed in SI units; positions/sensors are converted to cm at the display boundary. PID/mechanics period 5 ms.
- DC motor: `F = Fstall * (duty * load * mismatch - vWheel / vNoLoad)` when commanded, with dead zone and latency. A zero command lets the robot coast; a reversed command produces braking/reverse force. Left/right wheel contact speeds are derived from the body velocity and yaw rate.
- The separate acceleration/turning speed lag `tauc/tau` was removed. Velocity results from force/mass, and yaw rate from torque/inertia. `load` now means the fraction of supply voltage used, not a speed multiplier applied after the force calculation.
- Front normal load `Nfront = clamp((W * cgForward - mass * ax * cgHeight) / support, 0, W)` and rear `W - Nfront`, using the previous step's acceleration for weight transfer; the assumed fan applies a downward force at the CG.
- Each rear drive wheel has a single friction circle: `Fx² + Fy² ≤ (mu * Nwheel)²`. Force used for acceleration leaves less for cornering; lateral force is allocated from the remaining share of the friction circle. There are no two separate μg quotas. Left/right weight distribution is still symmetric; roll is not modelled.
- CG velocity is computed in world coordinates. The lateral impulse at the rear-axle contact point is solved using mass and inertia together (`1/m + cgForward²/Iyaw`), so both sliding and its effect on rotation are captured. No rule forces the velocity direction to follow the robot's heading at a fixed rate.
- Each drive wheel is a state variable (wheel contact speed) with reflected inertia `wheelInertia` (rotor×gear ratio²+wheel, default 1.8e-6 kg·m² per side, equivalent to mass J/r²). Back-EMF is computed from wheel speed. Tyre force comes from slip (wheel speed − contact-point speed) with stiffness `tyreStiff` (default 60 N per m/s), then saturates at the friction circle. So wheels can spin freely/lock and are not rigidly tied to the body. The Plant runs 5 substeps (1 ms) per 5 ms control period, implicit in wheel speed. `wheelInertia`/`tyreStiff` are unmeasured assumptions and shift the stability limit for high Kp (see the sensitivity table below).
- Rolling resistance opposes motion and is limited so it cannot push a stationary robot backwards.
- Nose lift results from the moment of the acceleration force and weight about the rear axle, including pitch inertia; it comes back down through gravity and a contact constraint. There is no `aLift`/`liftMs` and no timer-based sensor blackout. Pitch is bounded at a maximum of 1.4 rad; flipping over/detailed impacts are not modelled.
- Sensing positions shrink with cos(pitch), each sensor's height increases by SF*sin(pitch), and the signal decreases as `exp(-(height/sensorRange)²)`, so the signal reflects actual height within the model. No noise is added.

Motor force/mass/inertia follow the equation structure of [WPILib physics simulation](https://docs.wpilib.org/en/stable/docs/software/wpilib-tools/robot-simulation/physics-sim.html); the normal-force friction limit references [OpenStax: Friction](https://openstax.org/books/university-physics-volume-1/pages/6-2-friction). The friction-circle allocation, contact impulse, pitch and light attenuation are LineSim-specific approximations, not a whole simulator taken from these sources.

## What is known and values that must be measured

| Item | Evidence/assumption |
|---|---|
| PID/AccelSet | Pro source checked; weighted position 0–1500, first cycle uses elapsed time with a 500 ms default as in the examples, subsequent cycles 5 ms; jitter and PID state before each command are not modelled |
| Geometry/sensor positions | Body 15×15 cm, wheels 23 mm, wheel track 12 cm, SF/SX from the 16MuxV3 board file |
| Mass | Default 0.2 kg; adjustable |
| CG/inertia | CG 3 cm forward of the axle, 2 cm high, Iyaw=0.00075 kg·m² are geometry-based defaults, not measurements of the user's robot; support assumed at the front edge, 13.85 cm |
| Motor | Kept the existing N60 6000 rpm/10 A/1:5 gear preset and the example N20; no datasheet confirms the motor curve of the user's robot; load=.46/bias=.091 are existing values still to be compared with real speed and current |
| Tyres/fan | μ=1/1.5/2/3 are approximate levels, not values from tyre testing; downforce starts at 0 N because no measured value exists yet |
| Sensors | Five-point footprint, radius .4 cm, cutoff after rounding <6, sensorRange .5 cm are a light model; ambient light/ADC noise are not modelled |
| Scope | Car on a flat floor; battery sag circuit, temperature, caster swivel, roll/left-right load, and full 3D flipping are not modelled |
| Real logs | Routes reconstructed from sensor positions are inferred using the same model; they must not be used as independent ground truth to validate the physics |

## User references and checks

The user reports that these are steady through the curve of section 4/straight of section 5, lower left, on Formula:

- `ATrack(100, 0.08, 0, 0.0040, -255, 0, 3500)`
- `ATrack(80, 0.08, 0, 0.0024, -255, 0, 4500)`

After the model change, tested on Formula μ=3, AccelSet(.17,80), startWaitMs=500: each set completed the route at all 12/12 starting points with no stretch where the sensors lost the line, and over the full 3.5/4.5-second command periods from the track start it did not leave the route. This is a behavioural regression check, not confirmation that real timing/positions match, because there is no trajectory/timestamp/initial state for the two real runs.

The new model does not force accel to be disabled or the first dt to be wrong and then always lose the line. So the old regression that locked in that error as having to make the robot lose the line was changed to directly check the first-cycle PID numbers and that accel changes the trajectory.

`npm run test:physics` checks standing still, driving straight/reversing, left-right symmetry, coast/reverse polarity, mass/inertia, grip not changing the final lap, the combined friction circle, total normal load, nose lift then landing, the fan increasing traction, and light signal decreasing with height. It additionally checks that coasting during a turn does not add energy, and that halving the step 5→2.5 ms changes the position after a 1 s turn by about .077 cm. It checks that record/replay at a playback speed equal to the recording completes the route; it does not guarantee that full-255 playback will pass, because the robot may slide or lift its nose depending on robot parameters. This is combined with `test:firmware-timing`, `test:accel`, auto tune/cache/grip, CPU workers and GPU parity.

There has been no test driving the real robot and no quantitative confirmation of the full physics error from measured data.

## Sensitivity of the stability limit (Formula μ3, speed80, Kd.0024, Ki0, slow0; temporary script, not tuning to pass)

ref Kp .08 and .15/.2 finished the lap without losing the line for every value combination tried (wheelInertia 0/1.8e-6/5e-6 × tyreStiff 30/60/150). Kp .3 passes when wheelInertia ≥1.8e-6 but loses the line at 0; Kp .46 loses the line in every combination (earliest ~4 s with wheelInertia 0, latest ~32 s). So the instability at high Kp is an effect of slip-based tyre force + motor lag, but the exact location of the limit depends on these two assumed values. They must be measured or compared with the real robot (does the real robot oscillate at ~5 Hz with high Kp?).

## Latency, margin and the Best steadiness criterion (12 Nov 2026, evening)

- Default motor command latency 12 ms with 1 ms resolution (previously 10 ms in steps of 5 ms). The 12 ms value was chosen from a scan on Formula μ1.5 speed80: ref (Kp .08 Kd .0024) is steady at all values; Kp .46 Kd .005 oscillates continuously but still finishes the lap at ≤12 ms and starts losing the line at 13 ms, matching what the user saw on the real robot. This is fitting the stability limit from a single observation, not a measured value.
- Tuning (Best/Max) simulates with latency +4 ms (`tuneTrial`) as a margin.
- Best (not Max): `runBestSearch` runs the user's ref (selected speed, Kp .08, Kd .0024) on the same track/tyres/physics, measures `osc` (number of err sign flips on straights with hysteresis ±10 per second, excluding the first second), sets `oscLimit = max(1.3×ref, ref+0.5)`, score += 8×max(0, osc−oscLimit).
- Best result Formula μ1.5 speed80: Kp .3 Kd .009, 12/12, 20.77 s, osc 1.43 (ref 1.48)
- Observation: the 1.3-second real log (`REAL_POS`) gives RMS 37.6 (before wheel state), 55.4 (wheel state, latency 10). Fitting with latency 0 gives ~20 but contradicts the real oscillation at Kp .46, so it is not used yet.

## Best = no worse than ref, then pick the smoothest (12 Nov 2026, late night; replaces the weighted osc penalty above)

- Weighted scoring does not make ref win (grid on Formula μ1.5 speed80: high Kp always gives better time/curves), so the final selection of Best (not Max) was changed.
- `runBestSearch` runs ref (Kp .08, Kd .0024) at the same speed/track/tyres (using the same latency margin +4 ms as the other candidates). If ref passes 12/12: candidates that are "no worse than ref" are those that pass 12/12, do not lose the line/lose it in curves, lap time ≤ ref, curve RMS ≤ ref, time outside the 2 cm band ≤ ref, osc ≤ max(1.3×ref, ref+0.5). Within that group, the lowest `slew` (sum of |Δ steering output| per step) is chosen. If no candidate passes yet / ref does not pass at that speed, the old score is used.
- ref is always added to the shortlist.
- Result: Formula speed80 μ1.5 and μ3 give Kp .08 Kd .0024; speed 100/120 give Kp ~.29–.3 (ref does not pass at those speeds).
- Not yet tried on the real robot.

## New fit from the real log (12 Nov 2026, late night; replaces the 12 ms latency and the "Best = ref" rule above, which has been withdrawn)

- The rule making Best select ref has been withdrawn (backup `.backups/index-with-ref-select-20261112.html`). Best goes back to using the score + osc criterion as before.
- Plant parameters fitted to the real log `REAL_POS` (1.3 s, speed 90 Kp .3 Kd .009): lat 2 ms, tyreStiff 150, wheelInertia 1.8e-6 unchanged. Position RMS difference 55.4 → 23.8 (peak −581@870 ms vs real −602@855 ms).
- The motor dead zone made the log fit worse (RMS ~150) and laps slow at 25–35 s, so it is not used. load stays at .46.
- Behaviour consistent with real-robot observations (Formula μ1.5 speed80): ref osc ~1.1; Kp .3 osc ~1.1–1.3; Kp .46 Kd .005 osc 4–6, still finishes the lap.
- Best Formula μ1.5 speed80 now: Kp .345 Kd .0072. Not yet tried on the real robot. This fit uses a single short log on a track reconstructed by the model itself; it is not a full calibration.

## Adjusted to the real 12-second lap time (12 Nov 2026, very late night)

- Real data from the user: `ARecord(80, 0.08, 0, 0.0024, -255, 0, 12000)` completes a Formula lap in about 12 seconds (the old model gave 21 seconds), so `load` was set 0.46 → 0.8: ref at speed 80 gives 12.2 s without losing the line, the real log `REAL_POS` still fits (RMS 23.1), and `loadReal` is 0.8 as well (the total rotation of the U at −180° is consistent with higher load). At load ≥0.9 even ref loses the line.
- Default tyre μ 2 (the 3rd option), because at load 0.8 the second ref (speed 100 Kp .08 Kd .004) launches from standstill and loses the line at μ 1.5 but passes at μ ≥2 (brief sensor loss ~0.15 s).
- At load 0.8 the Senior track is only achievable with low gains and speed ≤ ~45–50 (Kp ≥ .12 loses the line). Tests that previously used speed 90 on Senior were changed to feasible parameters (physics RR: Kp .1 Kd .004 speed 40; objective baseline: [.1,.004,0,45]; grip: Senior speed 45; accel/firmware-timing: relaxed lostTime for speed 100 to <0.5 s).
- Scaling motor torque (current limiting) was tried and made everything worse, so it was withdrawn.
- ref in the model now: curve RMS 2.68 cm, outside the 2 cm band ~4.7 s per lap, maximum deviation from the centre line 6 cm. The user says the real robot strays from curves less than this (not yet adjusted).

## Best allows as much lag as ref can tolerate (12 Nov 2026, very late night)

- The real robot oscillates at Kp .46 (Kd .005 and .0096), but in the model this high gain is still stable, which means the real robot has lag that the model lacks.
- `runBestSearch` (not Max) finds the maximum "added lag" (in steps of 4 ms, 8–28) at which ref (Kp .08, Kd .0024) still passes 12/12, then uses that value as `sv.latMargin` for `tuneTrial` (Max uses 4 ms as before). All candidates and the ref osc metric are measured at that lag.
- On Formula speed80 μ2: ref tolerates up to ~16 ms of added lag (Kp .3 loses the line at 16, Kp .46 at 12). Best gives Kp .13 Kd .006 (μ1.5: Kp .2875 Kd .008).
- Remaining conflict: the 1.3 s real log fits μ1.5 (RMS ~23) better than μ2 (~49), but ref speed 100 from standstill only passes at μ ≥2.

## Best searches Kd/Kp in the range 0.001–0.1 (user experience; 12 Nov 2026, very late night)

- The user states that from experience the Kd/Kp ratio is around 0.001–0.1 (ref 0.03). Best (not Max) searches Kd = {0.001, 0.003, 0.01, 0.02, 0.03, 0.05, 0.1} × Kp, and during refinement keeps Kd within this range at all times (the current P value is included in the list when it is within range). Max searches Kd freely.
- Formula speed80: μ2 → Kp .13 Kd .0065; μ1.5 → Kp .255 Kd .009
- The user accepts slight oscillation when exiting curves in exchange for time: osc counts only straight sections (excluding the first second).
- The model has no noise in the derivative, but the firmware computes the derivative from the raw error with no filter, and dt is an integer number of ms, which may make high Kd oscillate more on the real robot than in the model (not yet added; awaiting the user's decision).

## Status summary after several sets of real-robot data (13 Nov 2026)

Real data from the user (Formula, tyre μ2, speed 80 unless stated): ref Kp .08 Kd .0024 runs ~12 s, steady; Kp .08 Kd .0032 is better than ref; values that oscillate: (.13,.0065), (.46,.005), (.46,.0096), (.069,.0069 @ speed 52); the user does not want ref speed 100 used for decisions.

- Dead zone removed (dead 0, deadS 0; it made low speeds unrealistically slow: speed 52 gave 22 s), back to load/loadReal 0.8.
- Added the `slew` metric (mean |Δ PID output| per step): real steady values are ≤ 1.54× ref, oscillating ones 1.95–4.1×. Best (not Max) applies a heavy score penalty when slew > 1.5× ref (measured on the same track/tyres/speed).
- The `posNoise` parameter (line position jitter, seeded per trial) was added but is disabled (0), because the slew criterion separates the groups without needing noise.
- Best still has: Kd/Kp 0.001–0.1, lag criterion relaxed according to ref, gain margin ×1.15/1.3/1.45, and stepwise criterion relaxation (tier 1/2) when nothing is found.
- Best results Formula μ2: speed80 Kp .092 Kd .004; speed90 .1/.0036/slow .025; speed100 .184/.00384/slow .05; speed120 .034/.0008/slow .2; speed150 relaxed criteria .034/.0032/slow .2
- These values have not yet been tried on the real robot (except .08/.0032, which the user tested as better than ref).

## Gain margin disabled, slew ceiling 1.3× (13 Nov 2026)

- The user tested on the real robot that Kp .08 Kd .0032 is better (faster and steadier) than ref, and better than the values Best gave (.092/.004/slow .05).
- In the sim, .08/.0032 scores 14.30 (slew 1.24× ref), better than .092/.004/.05 (14.54; slowrage makes the lap 13.4 s), but Best discarded it because of the gain margin ×1.15/1.3/1.45. So the gain margin was disabled (`GMS = []`; the lag-margin + osc + slew ≤1.3× ref criteria are used instead).
- Best Formula μ2 speed80 now Kp .092 Kd .0032 slow .025; speed90 .1/.0036/.05; speed100 .184/.0032/.05; speed120 .034/.0008/.2; speed150 .034/.0032/.2

## Max uses the same criteria as Best (13 Nov 2026)

- `runBestSearch` (Max) measures ref (Kp .08 Kd .0024) at every speed 30–250 (step 10) and stores `sv.yard[speed] = {margin (added lag 4/8/12/16 ms at which ref still fully passes), oscLimit, slew}`. If ref does not pass at a speed, the values of the highest passing speed are used. `tuneTrial` uses the per-speed margin, and `evaluateTune` deducts score when osc/slew exceed the criteria (slew > 1.3× ref), as in Best.
- Max Formula μ2: speed 100 Kp .184 Kd .0024 slowrage .1 (previously Kp .46 Kd .0096, which the user found oscillates on the real robot). Takes ~10 s more computation time.
- Best: slowrage always 0 except in the final relaxation tier (tier 2), Kd/Kp 0.001–0.1 (finer ratio table), gain margin disabled, stepwise criterion relaxation.
- Tests: objective scores the baseline with the same criteria the search uses (hook `options.onSetup`); workers allow multiple worker sets per Best (all closed).
- Simulation results: the faster the speed, the narrower the gain range that finishes the lap (Formula μ2: at speed 100 only ~Kp .08 remains, at 110 no value passes), so Kp decreases with speed. Not yet compared with the real robot at speed > 80.
- Outstanding: Best at speeds where ref does not pass (≥~110) uses the relaxation tier that enables slowrage; the record/replay detector (DET) is too narrow (details in the chat). Awaiting the user's choice of option A/B.

## Record -> replay (2026-11-13, matches PulseMiniV2.2ControlPro.h 2.0.2)
- Defaults are the tuned real values: speed 90, Kp 0.15, Kd 0.003, AccelSet(0.17, 80), AReplay(0.75). Record -> replay keeps the manual tune when its record lap finishes the course; only if it fails the Best search is used.
- Detector: moving average of |error| (alpha 0.25 per 5 ms tick), bands 100 (in) / 180 (out), hold 30 ms enter / 150 ms exit.
- AccelSet keeps limiting during the whole replay (not only the launch); lowering the command is immediate.
- AReplay: position from distance travelled (estimated speed lags the command with 150 ms), snapped to the recorded curve entry/exit when the detector sees one within 300 ms; finishes at the recorded total distance. Straights run at 255 for the learned share of their length and brake (250 ms x speed above the recorded speed) before the curve.
- Learning: every straight starts at 100 % (capped by AReplay ratio). A lap that sees a curve while still fast, or loses the line in the straight or the curve after it, lowers that straight by 10 % and locks it. The UI replays the lap until it passes twice (up to 12 laps) and shows the learned shares.
- Not modelled: PWM frequency (3.9 kHz) and motor heating; the real robot reaches full speed on the first straight without lifting the sensors at AccelSet 0.17 (user's real run).
- Backups of the previous version: `.backups/index-before-final-replay-20261113.html` (+ README / MODEL_NOTES).

## Recalibration after the motor PWM change (2026-11-13)
- Real run: ARecord(90, 0.15, 0, 0.003, -255, 0, 9800) laps Formula in about 9.7 s, faster than the model (11.1 s at tyre mu 2, load 0.8), because the motor PWM was raised from 490 Hz to 3.9 kHz. Defaults are now tyre level 4 (mu 3) and motor load 0.9: the same command gives a 9.74 s lap and the record lap finishes. Other fitting combinations exist (mu 3 with lat 6 and load 0.9 gives 9.66 s); this one changes only the two existing parameters. The earlier mu 2 / load 0.8 calibration (speed 80 lap about 12 s) belongs to the old PWM.
- The record lap now ends at TotalTime (P.recMs, default 9800, 0 = until the course is finished) like ARecord(). It counts as complete when the sensor row reached 96 % of the route.
- Fixtures of test:physics, test:firmware-timing and test:objective keep the earlier calibration explicitly (mu 2, load 0.8, TotalTime unlimited) so they still test the same mechanics.
- Steadiness (2026-11-13, later): at control latency 12 ms and yaw inertia 0.00075 the straights of the record lap wobbled (error std 10-108 units, up to one sensor spacing) while the real robot is steady with no line loss. Defaults are now lat 2 ms and yaw inertia 0.0004 (straight error std 3-29 units), with motor load 0.89 so the lap stays 9.68 s. Earlier fits (lat 12) belong to the old 490 Hz PWM. tests/physics, firmware-timing and objective set lat 12 / yaw 0.00075 / mu 2 / load 0.8 explicitly to keep their baselines.
