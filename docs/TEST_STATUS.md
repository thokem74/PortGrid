# Verification status — 2026-11-21

This qualification evaluates the new implementation against deterministic acceptance conditions, without a legacy benchmark. Results below are actual runs on the source hashes in `reports/qualification-summary.json`. A source mismatch is not current certification. Historical `tests/result-*.json` files remain historical evidence.

## Source and focused checks

Passed on the final source:

```bash
node tests/source-parity.test.js
node tests/control.unit.test.js
node tests/reliability.unit.test.js
node tests/traffic.test.js
node tests/physical-faults.test.js
```

These cover all embedded/source copies and JavaScript syntax (including the Three.js module), persistent demands, fair first admission across nine STSs, mission states, parking-row independence, yard capacity rules, wait-for cycles, watchdogs unaffected by rerouting, actual graph-backed quay/parking escapes, AGV versus truck bay envelopes, truck permit transfer and reverse-route construction. Physical fault fixtures also fill all real inbound AGV-side stacks to capacity before dispatch, and suspend/resume an actual attached-container lift during a crane outage. Full storage preserves all nine initial crane demands and admits zero unsafe pickups.

## Physical acceptance

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

## Full-normal KPIs

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

## Reproductions and corrections

- `reports/reproduction-quay-turn-seed3.json`: AGV-03 at (-275,-72) could not rotate west beside loaded AGV-15 at (-264,-72). Both repeatedly replanned without displacement for more than 300 seconds. First-edge body feasibility and a graph-backed empty-vehicle escape address this class; replanning does not reset the physical watchdog.
- `reports/reproduction-export-access-seed7.json` and `reports/export-access-diagnosis.json`: vessel-booked containers remained physically on the truck side of outbound yard 4, while repeated truck admissions starved the two-RTG relay. Urgent active-vessel relay admission now precedes new truck admission when both cranes are free. Relay destination/buffer reservations also exclude unrelated placement.
- `reports/reproduction-parking-return-seed7.json`: a tight parking-return cycle could not escape a fixed final route suffix. Bounded adjacent-edge recovery preserves physical movement and the original intent.
- `reports/reproduction-truck-reverse-seed7.json`, `reports/reproduction-truck-permit-wait-seed3.json` and `reports/reproduction-truck-wrong-direction-seed3.json`: truck permits could imprison a physical blocker; denied permits hid waiting duration; an unconditional gate reversal crossed unrelated parking pockets or moved toward another truck. Permit transfer, denied-permit accounting and route-prefix reversal with a direction check replace those behaviors. Truck bays retain their 13 m traffic separation; the narrower AGV bay rule is not applied to trucks.
- `reports/reproduction-high-yard-wait-seed3.json`: the earlier high-load scenario tripped the per-AGV watchdog. The circular AGV bay occupancy rule disagreed with the actual parallel body envelope. Bay authorization now shares the physical envelope. The final-source high-load rerun passed after the long-connector correction described below.

- `reports/reproduction-long-parking-connector-seed3.json`: high load stopped at 960.1 seconds with 47 imports, three exports and no departures. Empty AGV-15 at (-319.5,-36) could not reverse because the previous waypoint on its 106 m parking connector was more than 50 m away. Loaded AGV-05 at (-304.5,-36) could not pass. The arbitrary distance rejection was removed; reversing still follows the traversed edge and all body/road guards. The focused long-connector fixture and final full high-load scenario pass.

These archives intentionally preserve failed earlier revisions. They are diagnosis evidence, not current pass results.

## Browser evidence

`node tests/browser.smoke.js` passed using Chromium, a loopback-only server and a disposable profile. The ordinary browser-access host was unavailable; the executable browser smoke test provided the fallback. The sandbox initially denied localhost listening; the authorized local test ran outside that restriction. No browser security interstitial or certificate bypass was used.

The test loaded the real HTML and CDN Three.js, checked actual AGV displacement, operated top-down and quayside camera controls and asserted no JavaScript exceptions/console errors or sampled AGV/route/manifest violations. `reports/browser-smoke.json`, `reports/browser-top.png` and `reports/browser-quay.png` contain the result and inspected screenshots. Layout and graph meshes were preserved. This short smoke test does not certify frame rate, every parking/yard junction, all UI interactions or long-run rendered handling. Software-rendered screenshot FPS is not a throughput KPI.

## Open qualification and capacity analysis

- Full normal-load continuous-vessel pipelines across multiple seeds; high load across multiple seeds and larger horizons.
- Exhaustive blocked-route/stalled-vehicle combinations, scarce storage and recovery after actual full storage clears. Full-storage admission and a mid-lift outage are focused fixtures, not a full congestion recovery matrix.
- Exact causal accounting for **all** STS idle states, including ship phase barriers, inaccessible export cargo and waits outside the historical gross-wait subset. Arithmetic for that subset and fleet partition passes; causal attribution is still an estimate.
- A sub-10% scheduler-delay target across normal seeds. Three inbound AGV-side RTGs serve nine STSs, but this fact alone is not a quantified capacity proof. Next work should use reservation/traffic/cargo traces to separate dispatch delay from actual service capacity.
- Complete request→allocation→departure→arrival→pickup→delivery latency distributions and actual double-cycle distance savings. Reports provide assignment latency and per-minute throughput samples.
- Some aggregate admission rejections still lack individual storage/stand owner identities; expand those wait-for edges before claiming complete resource-level attribution. Legacy UI event-derived counters also require cumulative-counter conversion before much longer runs can exceed the 7,000-event ring; final report trace totals are streamed independently, and the tested full-normal/continuous double-cycle totals agree with the UI values.
- Further independent extraction of traffic/resource/crane internals, and proof or broader experimental coverage of bounded recovery. Safety guards can reject every escape, in which case the watchdog must fail explicitly.
- Longer rendered browser operation and close inspection at parking exits, quay stands, yard junctions and truck corridors. No claim of arbitrary deadlock freedom or production certification.

Run `node scripts/summarize-reports.js` to regenerate machine-readable qualification summaries and check source-hash currency. Run `npm test` or `npm run test:extended` to rerun the suite; a historical JSON file is never a substitute for execution after edits.
