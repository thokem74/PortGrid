# Verification status

## Completed job and order history — 2026-11-23

`node tests/archive-performance.js` passed twice on Node.js 26.13.1. The seed 3 probe starts three vessels with 12 discharge and 8 load entries each and no crane outages. It warms up for 90 simulated seconds and times the next 60 seconds over seven paired runs. The confirmation took 16.23 wall seconds. Median tick time was 441.9 ms with ordinary history and 426.3 ms with 1,000 additional completed job/order pairs, a ratio of 0.965 against the 1.25 limit. Each measured window produced 715 identical events, eight new orders, six new jobs, and two imports. New work's audit records, KPIs, and safety counters matched.

`npm test` passed all 14 checks in 54.22 wall seconds. The continuous small, full-storage recovery, and loaded-delivery outage cases passed in independent runs. Use `node tests/integration.acceptance.js SCENARIO` for any row. Each starts with three vessels, nine STSs, twelve RTGs, 24 AGVs and twelve trucks. The loaded-delivery fixture takes one destination RTG out of service for 90 simulated seconds. The full-storage fixture starts with inbound AGV-side storage at capacity. D/L is the manifest per vessel. All rows recorded zero route failures, body overlaps, rail or transfer-ownership violations, manifest violations, premature loads, duplicate orders and job errors.

| Scenario | Seed | D/L | Simulated s | Wall s | Imports / exports / departures | Live missions | AGVs without progress for ≥60 s at end |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `complete-small-seed3` | 3 | 3/2 | 900 | 2.68 | 9 / 6 / 3 | 0 | 0 |
| `complete-small-seed7` | 7 | 3/2 | 900 | 2.66 | 9 / 6 / 3 | 0 | 0 |
| `normal-load-first-service` | 3 | 12/8 | 300 | 2.90 | 15 / 0 / 0 | 21 | 4 |
| `complete-normal-seed3` | 3 | 12/8 | 2400 | 10.80 | 36 / 24 / 3 | 0 | 0 |
| `complete-normal-seed7` | 7 | 12/8 | 2400 | 9.65 | 36 / 24 / 3 | 0 | 0 |
| `complete-normal-seed11` | 11 | 12/8 | 2400 | 12.66 | 36 / 24 / 3 | 0 | 0 |
| `continuous-small-seed7` | 7 | 3/2 | 3000 | 11.74 | 49 / 30 / 15 | 7 | 0 |
| `full-storage-recovery` | 7 | 3/2 | 3600 | 10.63 | 9 / 6 / 3 | 0 | 0 |
| `loaded-delivery-outage` | 3 | 3/2 | 1500 | 3.74 | 9 / 6 / 3 | 0 | 0 |

The full normal runs achieved 26.88–27.12 gross moves per crane-hour, 31.05–31.71% gross STS waiting and 3.40–3.58% estimated scheduler delay. Evidenced scheduler delay was 0% in those runs. Productive AGV fleet time was 20.84–21.00%, assigned parking 3.33–3.38%, traffic wait 0.87–1.00%, and empty distance 60.61–61.46%. Each recorded 20–22 opposite-direction assignments. The scenario JSON and traces contain per-STS and wait-cause totals, fleet partitions, and latency distributions. This run's reports and event traces are in `/tmp/portgrid-slowdown-evidence/`. Re-run the commands to regenerate them under `reports/`.

The extended Chromium smoke harness observed AGVs at parking exits, quay stands and yard junctions, and trucks in their corridor through 910 simulated seconds at seed 3. It reported zero console errors, JavaScript exceptions and sampled safety failures. A temporary CDP probe of the same scene measured 133–150 ms median frame intervals, 0.61–0.72 ms mean per physics tick and 1.95–2.07 simulated seconds per real second at a 4× setting under SwiftShader. The four six-second windows covered the inventory modal open and closed, with ordinary history and with 1,000 extra orders plus 2,000 departed containers. The frame clamp limited simulation speed under software rendering. Simulation speed was similar across the four windows.

Serializing the existing 2.27 MB, 77-sample progress file took a 6.49 ms median and writing it locally took 0.98 ms over seven repeats. The measured cost per sample supports deferring incremental reporting. Longer browser profiling remains open, including retained container and vessel records. The small continuous pass leaves normal-workload continuous throughput and truck recovery qualification open.

## Expanded quay and yard grids — 2026-11-22

The focused grid fixture checks section lengths against the inflated AGV body and turn sweep, verifies that terminal crossings are shared graph nodes, and checks all four parking connectors. It stalls a downstream AGV on a real graph section in both zones and observes a loaded follower at the intermediate stop line while two other vehicles turn at its bounding junctions. It also verifies section exclusivity in opposing traffic, aligned loaded reverse from an RTG bay, and release to a second vehicle.

`npm test` passed all 14 checks and scenarios on the expanded layout. The expanded graph has 323 travel sections measuring 36–54 m. The 18 m stop line leaves about 1.8 m of additional clearance beyond the code’s combined chassis and junction-sweep envelope. The existing acceptance horizons and KPI gates apply. The full normal-load gate requires 36 imports, 24 exports, three departures, zero safety violations, at least 25 gross moves per crane-hour and under 10% for both scheduler-delay shares. The reports include per-crane counts and waiting causes, fleet-time partitions, transport latencies and every physical safety counter.

### Runs on the expanded layout

Use `node tests/integration.acceptance.js SCENARIO` for each row. Each starts with three vessels, nine STSs, twelve RTGs, 24 AGVs and twelve trucks. D/L is the manifest per vessel. These runs used Node.js 26.13.1. Wall time includes contention from concurrent verification.

| Scenario | Seed | D/L | Simulated s | Wall s | Imports / exports | Departures | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `complete-small-seed3` | 3 | 3/2 | 900 | 10.69 | 9 / 6 | 3 | PASS |
| `complete-small-seed7` | 7 | 3/2 | 900 | 13.96 | 9 / 6 | 3 | PASS |
| `normal-load-first-service` | 3 | 12/8 | 300 | 10.38 | 15 / 0 | 0 | PASS |
| `complete-normal-seed3` | 3 | 12/8 | 2400 | 57.66 | 36 / 24 | 3 | PASS |
| `complete-normal-seed7` | 7 | 12/8 | 2400 | 47.44 | 36 / 24 | 3 | PASS |
| `complete-normal-seed11` | 11 | 12/8 | 2400 | 42.11 | 36 / 24 | 3 | PASS |
| `temporary-yard-outage` | 3 | 3/2 | 1200 | 51.08 | 9 / 6 | 3 | PASS |
| `blocked-parking-release` | 7 | 3/2 | 1200 | 11.86 | 9 / 6 | 3 | PASS |
| `loaded-delivery-outage` | 3 | 3/2 | 1500 | 24.41 | 9 / 6 | 3 | PASS |
| `full-storage-recovery` | 7 | 3/2 | 3600 | 100.90 | 9 / 6 | 3 | PASS |
| `complete-high-seed3` | 3 | 18/12 | 3600 | 159.68 | 54 / 36 | 3 | PASS |
| `continuous-small-seed7` | 7 | 3/2 | 3000 | 67.61 | 49 / 30 | 15 | PASS |
| `continuous-normal-seed3` | 3 | 12/8 | 8580 | 1468.34 | 287 / 183 | 22 | WATCHDOG_FAILURE |
| `continuous-normal-seed7` | 7 | 12/8 | 8640 | 1400.00 | 290 / 184 | 23 | WATCHDOG_FAILURE |
| `continuous-normal-seed11` | 11 | 12/8 | 9660 | 1778.75 | 294 / 189 | 23 | Stopped at capacity bound |

The temporary yard outage takes three inbound AGV-side RTGs out of service for 90 seconds. The loaded delivery outage interrupts a loaded AGV's destination service. The parking release case stalls an AGV until 90 seconds. Full-storage recovery starts with the AGV-side inbound inventory filled to capacity. The runner checks route and body safety, crane rail and handoff authority, manifest ordering, progress watchdogs, and the KPI arithmetic.

| Scenario | Gross moves / crane-hour | Post-warmup moves / crane-hour | Gross STS waiting (%) | Estimated scheduler delay (%) | Evidenced scheduler delay (%) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `complete-normal-seed3` | 26.97 | — | 31.05 | 3.50 | 0.00 |
| `complete-normal-seed7` | 27.12 | — | 31.71 | 3.40 | 0.00 |
| `complete-normal-seed11` | 26.88 | — | 31.37 | 3.58 | 0.00 |

The scene passed `node tests/browser.smoke.js --extended` with Chromium at seed 3 through 908.7 simulated seconds. It observed AGVs at the parking exits, STS stands and yard junctions, and trucks in their separate corridor. The top-down and quayside captures were inspected. The smoke test reported zero console and JavaScript errors or sampled safety failures.

Extended results come from independent scenario runs. The duplicate serial suite was stopped. The continuous suite remains unqualified. The JSON reports and per-run event traces are under `reports/` in the verification copies. Reports include source hashes, the last physical cargo event, per-STS counts, wait causes, fleet time and latency distributions.

### Reproduced conditions

- Unconstrained bidirectional quay approaches formed a wait-for cycle around the parking gateway and later along the z = 72 m travel row. For example, AGV-20 and AGV-14 held successive sections while each waited for the other's section. The quay travel rows and columns now have assigned directions, with the parking feeder admitting traffic southbound and the STS approach columns carrying traffic northbound.
- An initial full run completed every move with zero safety violations and fell short of the throughput gate. All 24 exports were booked in the same block. The other two outbound AGV-side RTGs completed zero exports while the booked block's four transfer reservations accumulated waiting. Export booking now distributes eligible cargo over all three outbound blocks before assigning container identities to a work list.
- The full-storage case initially reached the 600-second vessel watchdog with no cargo moves. Its relay buffer and crane retreat positions still referenced the old yard origin. They now follow the translated rail and storage coordinates. The rerun completed all 15 moves and three departures.

### Sustained inbound capacity

The three inbound AGV-side zones can hold 504 containers in total. Their initial occupied counts are 271, 272 and 286 for seeds 3, 7 and 11. Terminal trucks retrieve from the truck-side zone. The 240-second inbound relay admission interval permits at most 45 freed AGV-side container positions per simulated hour across the three blocks once the initial free space is consumed, before crane contention. The continuous traces record increasing `NO_SAFE_YARD_DESTINATION` time as the initial space fills.

Two extended runs reached the vehicle watchdog. In seed 3 at 8,580 seconds, inbound TRK-08 spent 353.4 seconds waiting for a journey permit held by TRK-01. In seed 7 at 8,640 seconds, returning TRK-07 waited 300.7 seconds for the same truck at the yard 5 transfer apron. Both runs reported zero safety or ownership violations. The next truck-traffic investigation is permit fairness among journeys converging on the same trunk.

Seed 11 was stopped after its 9,660-second sample because it could no longer reach the throughput gate within the planned 10,800-second horizon. The trace recorded 77 inbound storage releases, with a generous upper bound of 18 further releases. With 218 initially free positions, this bounds imports at 313 and exports at 208 under the vessel phase rule. Even if no additional working crane-seconds accrued after the sample, the resulting upper bound would be 23.89 gross moves per crane-hour against the required 25. The run completed 23 departures and reported zero route failures, overlaps, rail, manifest, ownership, or job errors through that sample.

## Prior qualification — 2026-11-21

This qualification evaluates the new implementation against deterministic acceptance conditions, without a legacy benchmark. Results below are actual runs on the source hashes in `reports/qualification-summary.json`. A source mismatch is not current certification. Historical `tests/result-*.json` files remain historical evidence.

### Source and focused checks

Passed on the final source:

```bash
node tests/source-parity.test.js
node tests/control.unit.test.js
node tests/reliability.unit.test.js
node tests/traffic.test.js
node tests/physical-faults.test.js
```

These cover all embedded/source copies and JavaScript syntax (including the Three.js module), persistent demands, fair first admission across nine STSs, mission states, parking-row independence, yard capacity rules, wait-for cycles, watchdogs unaffected by rerouting, actual graph-backed quay/parking escapes, AGV versus truck bay envelopes, truck permit transfer and reverse-route construction. Physical fault fixtures also fill all real inbound AGV-side stacks to capacity before dispatch, and suspend/resume an actual attached-container lift during a crane outage. Full storage preserves all nine initial crane demands and admits zero unsafe pickups.

### Physical acceptance

Run each row with `node tests/integration.acceptance.js SCENARIO`. Initial fleet/resources: three working vessels, nine STSs, twelve RTGs, 24 AGVs and twelve trucks. No crane outage unless specified. D/L is the work list per vessel. Wall runtimes reflect concurrent local test execution and are not a browser frame-rate benchmark.

| Scenario | Seed | D/L | Simulated s | Wall s | Imports / exports | Departures | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `complete-small-seed3` | 3 | 3/2 | 900 | 3.27 | 9 / 6 | 3 | PASS |
| `complete-small-seed7` | 7 | 3/2 | 900 | 2.82 | 9 / 6 | 3 | PASS |
| `normal-load-first-service` | 3 | 12/8 | 300 | 35.19 | 15 / 0 | 0 | PASS |
| `complete-normal-seed3` | 3 | 12/8 | 2400 | 55.44 | 36 / 24 | 3 | PASS |
| `complete-normal-seed7` | 7 | 12/8 | 2400 | 61.48 | 36 / 24 | 3 | PASS |
| `complete-normal-seed11` | 11 | 12/8 | 2400 | 54.68 | 36 / 24 | 3 | PASS |
| `temporary-yard-outage` | 3 | 3/2 | 1200 | 9.21 | 9 / 6 | 3 | PASS |
| `blocked-parking-release` | 7 | 3/2 | 1200 | 3.27 | 9 / 6 | 3 | PASS |
| `complete-high-seed3` | 3 | 18/12 | 3600 | 136.25 | 54 / 36 | 3 | PASS |
| `continuous-small-seed7` | 7 | 3/2 | 3000 | 20.26 | 61 / 38 | 19 | PASS |

Full normal runs use 12 discharge + 8 load per vessel, no replacements, and a 2,400-second observation horizon. Each asserts all 36 imports, 24 exports, three departures and no live vessel missions at the end. Small completion runs have 3 discharge + 2 load each. Early service asserts actual completed service at all nine STSs; it does not assert full cargo completion at 300 seconds.

`temporary-yard-outage` sets all three inbound AGV-side RTGs unavailable until simulation second 90. `blocked-parking-release` stalls AGV-01 at zero speed until second 90 and restores its speed without changing position. `complete-high-seed3` uses 18 discharge + 12 load per vessel. `continuous-small-seed7` continuously replaces vessels with 3 discharge + 2 load manifests and keeps ordinary truck operations enabled; active missions at its observation boundary are expected. This is not a continuous **normal-load** qualification.

All currently passing rows report zero route failures, AGV body overlaps, crane-rail violations, manifest violations, job errors, sampled duplicate assignments and premature loading. Passing full normal/small completion rows end with zero live missions and zero zero-progress AGVs. Passing continuous operation has no wait-for cycle or AGV with 60 seconds without physical progress at its observation boundary. Traffic cycles may occur transiently and recover; the claim is no unresolved cycles under the tested acceptance gates, not that no transient waits ever occur.

The runner saves progress every 60 simulated seconds. It fails on a 300-second physical-progress watchdog for AGVs/travelling trucks or 600 seconds without vessel cargo progress while work remains. Gate-queued trucks still emit no-progress diagnostics with their crane-capacity blocker, but stationary gate resource waiting alone does not trigger the travelling-truck gate. Duplicate-assignment and load-phase checks are sampled every 60 seconds alongside the engine's continuous manifest interlocks; this is not exhaustive formal verification of every transient state.


The final high-load run completed all cargo by 2070.80 s and its last departure by 2125.77 s; gross crane throughput was 21.09 moves/crane-hour, gross STS waiting 59.05%, and estimated scheduler share 15.26%. The continuous small run completed 61 imports and 38 exports with 19 departures in 3,000 s, no terminal wait-for cycle and zero AGVs above the 60-second physical-progress threshold. Its four active missions belong to ongoing replacement calls.

### Full-normal KPIs

Gross crane rate uses moves divided by working-vessel crane-hours. Gross waiting is the historical AGV-related waiting subset; **it is not proven scheduler-avoidable delay**. Scheduler share below divides the existing state-based delay estimate by the same working-vessel crane-seconds. Observation continues after vessels depart, so terminal throughput over the complete 2,400-second horizon is 90 completed vessel moves/hour; the last physical cargo and departure timestamps give a more useful completion horizon.

| Seed | Last cargo s | Last departure s | Gross crane MPH | Gross waiting % | Estimated scheduler share % | Assignment→done median / p95 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1327.67 | 1382.63 | 21.90 | 46.47 | 11.37 | 160.70 / 378.60 |
| 7 | 1329.57 | 1384.53 | 21.58 | 46.06 | 11.49 | 170.87 / 367.50 |
| 11 | 1307.77 | 1362.73 | 23.37 | 48.55 | 9.93 | 174.10 / 277.20 |

| Seed | Productive fleet % | Parked assigned % | Traffic wait % | Queued assigned % | Empty distance % | Opposite-direction assignments / cross-vessel |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 15.83 | 4.39 | 0.49 | 1.26 | 58.77 | 13 / 10 |
| 7 | 16.14 | 4.34 | 0.35 | 1.27 | 59.18 | 13 / 10 |
| 11 | 16.52 | 3.13 | 0.49 | 1.03 | 59.05 | 13 / 10 |

Fleet state percentages partition a common observation denominator; productive time is a derived sum of moving and handling states. The large unassigned stationary fraction at the end of finite workloads includes legitimate idle time after departure. It must not be advertised as a sustained fleet efficiency measurement. No valid waiting category was removed from the denominator. Latency here is assignment-to-completion, not a complete request/departure/pickup/delivery latency distribution. Double-cycle counts are real consecutive opposite-direction assignments; distance savings and complete manifest-order eligibility certification remain outstanding.

The initial sub-10% estimated scheduler-delay goal is **not met across the normal seeds**: seeds 3 and 7 exceed it. State-based attribution is insufficient to conclude that this amount is truly avoidable. We do not claim a quantified physical-capacity explanation for every scheduler delay.

Per-STS completed moves and gross rates (each crane's own working-vessel exposure):

| STS | Seed 3 moves / MPH | Seed 7 moves / MPH | Seed 11 moves / MPH |
| --- | ---: | ---: | ---: |
| QC-01 | 7 / 36.36 | 7 / 35.44 | 7 / 35.12 |
| QC-02 | 7 / 36.36 | 7 / 35.44 | 7 / 35.12 |
| QC-03 | 6 / 31.17 | 6 / 30.38 | 6 / 30.10 |
| QC-04 | 7 / 18.99 | 7 / 18.95 | 7 / 23.86 |
| QC-05 | 7 / 18.99 | 7 / 18.95 | 7 / 23.86 |
| QC-06 | 6 / 16.27 | 6 / 16.25 | 6 / 20.45 |
| QC-07 | 7 / 19.89 | 7 / 19.44 | 7 / 19.27 |
| QC-08 | 7 / 19.89 | 7 / 19.44 | 7 / 19.27 |
| QC-09 | 6 / 17.05 | 6 / 16.66 | 6 / 16.52 |

Gross STS wait breakdown in crane-seconds (unrounded source values are in each report):

| Cause | Seed 3 | Seed 7 | Seed 11 |
| --- | ---: | ---: | ---: |
| `AGV_IN_TRANSIT` | 2682.17 | 2729.83 | 2606.27 |
| `DOWNSTREAM_YARD_CAPACITY` | 542.67 | 541.57 | 759.37 |
| `PARKING_DISPATCH_WAIT` | 939.03 | 931.70 | 695.93 |
| `STS_UNSERVED_DEMAND` | 171.60 | 218.90 | 152.90 |
| `TRAFFIC_OBSTRUCTION` | 10.27 | 0.00 | 68.93 |
| `YARD_CRANE_BUSY` | 221.47 | 173.43 | 183.70 |
| `YARD_DELIVERY_CAPACITY_FULL` | 16.13 | 15.77 | 20.17 |

### Reproductions and corrections

- `reports/reproduction-quay-turn-seed3.json`: AGV-03 at (-275,-72) could not rotate west beside loaded AGV-15 at (-264,-72). Both repeatedly replanned without displacement for more than 300 seconds. First-edge body feasibility and a graph-backed empty-vehicle escape address this class; replanning does not reset the physical watchdog.
- `reports/reproduction-export-access-seed7.json` and `reports/export-access-diagnosis.json`: vessel-booked containers remained physically on the truck side of outbound yard 4, while repeated truck admissions starved the two-RTG relay. Urgent active-vessel relay admission now precedes new truck admission when both cranes are free. Relay destination/buffer reservations also exclude unrelated placement.
- `reports/reproduction-parking-return-seed7.json`: a tight parking-return cycle could not escape a fixed final route suffix. Bounded adjacent-edge recovery preserves physical movement and the original intent.
- `reports/reproduction-truck-reverse-seed7.json`, `reports/reproduction-truck-permit-wait-seed3.json` and `reports/reproduction-truck-wrong-direction-seed3.json`: truck permits could imprison a physical blocker; denied permits hid waiting duration; an unconditional gate reversal crossed unrelated parking pockets or moved toward another truck. Permit transfer, denied-permit accounting and route-prefix reversal with a direction check replace those behaviors. Truck bays retain their 13 m traffic separation; the narrower AGV bay rule is not applied to trucks.
- `reports/reproduction-high-yard-wait-seed3.json`: the earlier high-load scenario tripped the per-AGV watchdog. The circular AGV bay occupancy rule disagreed with the actual parallel body envelope. Bay authorization now shares the physical envelope. The final-source high-load rerun passed after the long-connector correction described below.

- `reports/reproduction-long-parking-connector-seed3.json`: high load stopped at 960.1 seconds with 47 imports, three exports and no departures. Empty AGV-15 at (-319.5,-36) could not reverse because the previous waypoint on its 106 m parking connector was more than 50 m away. Loaded AGV-05 at (-304.5,-36) could not pass. The arbitrary distance rejection was removed; reversing still follows the traversed edge and all body/road guards. The focused long-connector fixture and final full high-load scenario pass.

These archives intentionally preserve failed earlier revisions. They are diagnosis evidence, not current pass results.

### Browser evidence

`node tests/browser.smoke.js` passed using Chromium, a loopback-only server and a disposable profile. The ordinary browser-access host was unavailable; the executable browser smoke test provided the fallback. The sandbox initially denied localhost listening; the authorized local test ran outside that restriction. No browser security interstitial or certificate bypass was used.

The test loaded the real HTML and CDN Three.js, checked actual AGV displacement, operated top-down and quayside camera controls and asserted no JavaScript exceptions/console errors or sampled AGV/route/manifest violations. `reports/browser-smoke.json`, `reports/browser-top.png` and `reports/browser-quay.png` contain the result and inspected screenshots. Layout and graph meshes were preserved. This short smoke test does not certify frame rate, every parking/yard junction, all UI interactions or long-run rendered handling. Software-rendered screenshot FPS is not a throughput KPI.

### Open qualification and capacity analysis

- Full normal-load continuous-vessel pipelines across multiple seeds; high load across multiple seeds and larger horizons.
- Exhaustive blocked-route/stalled-vehicle combinations, scarce storage and recovery after actual full storage clears. Full-storage admission and a mid-lift outage are focused fixtures, not a full congestion recovery matrix.
- Exact causal accounting for **all** STS idle states, including ship phase barriers, inaccessible export cargo and waits outside the historical gross-wait subset. Arithmetic for that subset and fleet partition passes; causal attribution is still an estimate.
- A sub-10% scheduler-delay target across normal seeds. Three inbound AGV-side RTGs serve nine STSs, but this fact alone is not a quantified capacity proof. Next work should use reservation/traffic/cargo traces to separate dispatch delay from actual service capacity.
- Complete request→allocation→departure→arrival→pickup→delivery latency distributions and actual double-cycle distance savings. Reports provide assignment latency and per-minute throughput samples.
- Some aggregate admission rejections still lack individual storage/stand owner identities; expand those wait-for edges before claiming complete resource-level attribution. Legacy UI event-derived counters also require cumulative-counter conversion before much longer runs can exceed the 7,000-event ring; final report trace totals are streamed independently, and the tested full-normal/continuous double-cycle totals agree with the UI values.
- Further independent extraction of traffic/resource/crane internals, and proof or broader experimental coverage of bounded recovery. Safety guards can reject every escape, in which case the watchdog must fail explicitly.
- Longer rendered browser operation and close inspection at parking exits, quay stands, yard junctions and truck corridors. No claim of arbitrary deadlock freedom or production certification.

Run `node scripts/summarize-reports.js` to regenerate machine-readable qualification summaries and check source-hash currency. Run `npm test` or `npm run test:extended` to rerun the suite; a historical JSON file is never a substitute for execution after edits.
