# AGENTS.md — PORTGRID engineering instructions for Codex

> Scope: This file applies to the entire `PORTGRID_Rewrite/` project. Treat it as the repository-level working agreement for autonomous coding agents. The **goal is a reliable, throughput-efficient, physically valid terminal simulation**, not a cosmetic improvement to headline KPI numbers.

## 1. Mission and authority

PORTGRID simulates an automated container terminal with **three vessel berths, nine STS cranes (three per berth), six yard blocks with twelve RTG yard cranes, 24 AGVs, and twelve external trucks**. The application includes 3D visualization, ship work lists, physical container transfers, multiple route networks, a scheduler, and a KPI dashboard.

Your task is to continue the **STS-demand-driven scheduling / mission / resource-authorization rewrite** and finish the parts that are not yet certified. Favor root-cause correction over repeated heuristic or parameter tweaks. You may redesign modules and data flows when necessary, but preserve physical realism, collision safety, the terminal's intended layout, container ownership, and observable user features.

**Do not perform an old-versus-new legacy benchmark.** Validate the new implementation against reproducible acceptance criteria and absolute KPI targets, with correct measurement definitions. Do not claim that an unfinished or timed-out test has passed. Continue iterating within the active Codex work session as resources permit; leave explicit next steps and evidence for anything unresolved.

## 2. Project files and ground truth

The source package contains:

| Path | Purpose |
| --- | --- |
| `PORTGRID_Standalone.html` | Runnable browser simulation. Embeds a copy of the control layer, the physical engine, and the Three.js/UI module. |
| `portgrid-engine.js` | DOM-free physical engine source; CommonJS factory and generated browser embed. |
| `portgrid-monitor.js` | Deterministic progress watchdog and resource wait-for diagnostics. |
| `portgrid-control.js` | CommonJS-compatible, DOM-free controller for STS demands, mission decisions, fairness, parking and yard authorization. |
| `tests/control.unit.test.js` | Controller-level tests; no browser or physical simulation. |
| `tests/integration.acceptance.js` | Deterministic headless scenarios using the engine source module; source parity independently checks the HTML embed. |
| `tests/result-small-seed3.json`, `tests/result-small-seed7.json`, `tests/result-normal-first-service.json` | Historical evidence from accepted test runs; **not a substitute for running tests after edits**. |
| `docs/ARCHITECTURE.md` | Current module/adapter boundaries and invariants. |
| `docs/TEST_STATUS.md` | Certified checks, known gaps, and qualification of KPI interpretation. |
| `README.md` | Startup and package overview. |

**Read `README.md`, `docs/ARCHITECTURE.md`, `docs/TEST_STATUS.md`, and the code before making broad changes.** This AGENTS.md expresses development policy; actual source code and passing tests determine current behavior. If sources disagree, diagnose and correct the inconsistency and update documentation.

### Generated embedded modules

The controller exists both in `portgrid-control.js` and in the `<script id="control-layer">` element of `PORTGRID_Standalone.html`. Edit the external source modules and run `node scripts/embed.js` to synchronize the HTML. The same rule applies to `portgrid-engine.js` and `portgrid-monitor.js`. `node tests/source-parity.test.js` asserts all three copies match and parses every embedded script, including the scene module. Do not edit generated copies independently; preserve direct single-HTML use.

The HTML also contains `<script id="engine">` (physical engine) and `<script type="module" id="sceneModule">` (Three.js visuals and UI). Do not replace this with a server-dependent app merely to facilitate tests. The Three.js import currently requires Internet access to load from its CDN.

## 3. How to run and verify

Use Node.js **22+**. From the project root:

```bash
node tests/control.unit.test.js
node tests/integration.acceptance.js complete-small-seed3
node tests/integration.acceptance.js complete-small-seed7
node tests/integration.acceptance.js normal-load-first-service
```

List available scenarios using:

```bash
node tests/integration.acceptance.js list
```

Open `PORTGRID_Standalone.html` in a modern desktop browser with Internet access for the Three.js scene. Headless tests evaluate the engine, **not** browser rendering, interaction, or frame-rate behavior. Add automated browser tests (e.g. Playwright) when feasible; verify console errors, visuals and actual AGV movement at parking exits, quay transfer positions, yard junctions and truck corridors.

After changes, at minimum:

1. Run the unit tests and all three shipped acceptance scenarios.
2. Run JavaScript syntax/static checks on both embedded script blocks and standalone `portgrid-control.js`.
3. Verify synchronization of the embedded control layer and the external module.
4. Run the newly affected targeted tests, plus at least one deterministic physical simulation including the impacted feature.
5. Check invariant counters and KPI arithmetic (no invalid negative durations, no misclassified parked AGVs, no hidden waiting time).
6. Report the actual command, seed, workload, simulated duration, runtime outcome, and failure details. Different seeds/workload horizons are separate scenarios.
7. Update `docs/TEST_STATUS.md` with what passed, failed, timed out, or remains untested.

Avoid changing production behavior solely to make a test pass; fix the corresponding real-world inconsistency.

## 4. Non-negotiable business behavior

- **STS cranes initiate demand.** Each working STS generates a persistent request for accessible manifest cargo, even when a suitable AGV or downstream RTG is temporarily unavailable.
- **Strict ship-level phase rule.** While any discharge entry for a given vessel is not physically `DONE`, that vessel is not eligible to begin export loading. Different vessels may concurrently be in different phases.
- **Discharge flow:** empty AGV → assigned STS → physical ship pickup → loaded AGV to correct inbound yard → physical RTG handover.
- **Loading flow:** correct container selected from ship work list → AGV arrives at its actual yard location → RTG loads AGV → loaded AGV to assigned STS → physical ship stowage.
- **Double cycling:** when another vessel is in a compatible phase, prefer an eligible opposite-direction follow-up mission where it saves travel **without starving active STS cranes, violating manifest order, or bypassing safety**. Count only actual qualifying consecutive transport assignments.
- Vessel departure requires all manifest entries physically `DONE`, no conflicting active crane work and no incomplete associated transport jobs.
- Preserve container identifiers, movements, histories and uniqueness. No teleporting, fictitious handovers or completing manifests by elapsed time alone.

## 5. Architecture and ownership boundaries

Maintain clear, independently testable components, even if their implementations are progressively extracted from the HTML:

1. **Demand manager:** STS and vessel work-list state → durable requests. Never suppress *demand visibility* because resources are busy.
2. **Fleet dispatcher:** demand priority, fair allocation across all three vessels/nine STSs, estimated arrival time, double cycling, assignment and dispatch eligibility. Assignment is not proof of movement.
3. **Mission manager:** explicit lifecycle (`WAITING`, `PREPOSITIONING`, `READY_FOR_STS`, `RUNNING`, `BLOCKED`, `DONE`, `CANCELLED`, or a better clearly documented state model). Mission state and physical transport order must remain consistent.
4. **Resource authorizer:** atomic reservations/release for STS transfer stands, yard transfer bays, safe destination storage, crane capacities and parking exits. Physical crane occupancy must not be reserved unnecessarily for the entire end-to-end AGV journey.
5. **Traffic authority:** the actual route graph, rolling-section permissions, intersection conflict checks, parking egress/ingress, deadlock diagnosis and safe recovery. Never bypass geometric collision/rail interlocks.
6. **Execution adapter:** existing physical AGV movement, container pickup/drop-off, STS/RTG animations, vessel state progression and truck operations. The physical engine confirms completion.
7. **KPI / event monitor:** time-based, cause-classified monitoring and actionable diagnostics. No KPI should be “improved” by hiding or redefining valid delays.

The current controller adapter interface includes `now`, `demands`, `availableVehicles`, `isVehicleFree`, `pickup`, `stsWaiting`, `canReserve`, `reserve`, `progress`, `start`, `preposition`, and `waitReason`. Maintain or version this contract deliberately and add tests when changing it.

Current pure helpers include `authorizeParkingDeparture(vehicle, vehicles)` and `authorizeImportYard(capacityState)`; test these independently of Three.js.

## 6. Geometry and visualization invariants

- The terminal retains three berths and nine STS cranes, with three STSs per vessel.
- The quay has eight evenly spaced lanes; existing longitudinal pitch is **12 m** and regular STS cross-grid pitch is **11 m**.
- The yard has **eight** parallel guide lanes at **12 m** pitch: the first four incoming (quay → yard), the next four outgoing (yard → quay).
- Parking comprises two distinct AGV parking rows and their graph-backed exit/return paths, with four explicit connectors to the quay network.
- Truck movement remains a separate route network with its own gate, parking, transfer and yard-side connections.
- Keep visual roads derived from logical graph edges. Do not add duplicate decorative slabs, unused grids, gaps, overlapping coplanar surfaces, or disconnected paths. Parking uses dark gray, yard dark cyan, and quay a distinct cyan; preserve unified zone coloring unless intentionally redesigned.
- Geometry, turning, collision envelopes, lane direction, queue spots and crane transfer positioning must agree between engine logic and rendered visualization.
- Visual changes require actual browser inspection in top-down and quayside views. Headless route tests cannot validate pixels.

## 7. Safety and consistency rules

Treat these as hard assertions; never sacrifice them to improve throughput:

- At most one active transport order for any container/work-list entry.
- No STS loading before the same vessel's entire discharge phase is physically complete.
- No AGV loaded without a feasible authorized destination, or a proven safe holding/recovery plan.
- No AGV body collision, unsafe overlap, invalid routing, unsafe rotation, or unrecoverable head-on conflict.
- No RTG rail-envelope collision or out-of-range pick/place.
- No unowned/duplicated crane transfer-bay reservation, stale reservation that cannot be expired/recovered, or mission that silently disappears.
- No departure with unfinished physical cargo work.
- Every parked/staged/blocked assigned AGV has a known active mission and machine-readable reason.
- If safety and progress conflict, **safety wins** and the system must surface the reason and recovery action.

## 8. KPI-first optimization — definitions and cautions

Use **correct, comparable units and sample windows**. Track both aggregate and individual STS performance; fairness matters across all three vessels. Measure at minimum:

- Completed vessel discharge/load moves, full vessel departures and throughput (moves/crane-hour and per simulated hour).
- Gross STS waiting (crane-seconds and share of working-vessel crane-time).
- **Scheduler-attributed avoidable delay**, distinguished from AGV transit, true yard capacity, crane outage, no eligible work and other physical constraints.
- Time from STS request → mission allocation → AGV departure → STS arrival → physical pickup → yard delivery.
- AGV fleet-time by **mutually exclusive** state: moving empty, moving loaded, physical handover, parking with/without order, traffic wait, staged/crane wait. Percentages must have a defined common denominator.
- AGV empty-distance share (distance-based), idle/blocked counts, consecutive double cycles and actual distance saved.
- Per-STS pending requests and per-yard RTG utilization/queue length.
- Blocker identity and durations for parking egress, road section, STS stand, yard stand, storage and RTG.
- Safety counters: route failures, body overlaps, rail violations, invalid manifests, job errors.

**Historical naming trap:** `getKPI().avoidableSTSPercent` currently represents a *legacy gross waiting share*, not pure avoidable scheduler delay. `getKPI().stsWaitBreakdown` provides cause-coded crane-seconds, and `getKPI().schedulerDelaySeconds` is an estimated subset. Do not report gross waiting as proven avoidable time. Keep metric names/labels honest and improve causal attribution with trace evidence before changing definitions.

KPIs must drive fixes, not cosmetic UI changes. Success requires safe full cargo completion and stable sustained throughput; reducing assigned-but-parked AGVs alone is insufficient.

## 9. Required tests and acceptance gates

### Already demonstrated in the provided package

- Independent control tests: persistent demand without yard capacity, fair first assignments across all nine STSs, admission limits, mission completion/block reasons, parking-row independence, and yard authorizer constraints.
- Small full-cycle scenarios (`seed3`, `seed7`): three vessels, **3 discharge + 2 load each**, 900 simulated seconds; **9 imports, 6 exports, 3 departures**; zero reported route failures, AGV body overlaps, manifest or rail violations, and job errors.
- Normal first-service scenario (`seed3`): three vessels, **12 discharge + 8 load each**, 300 simulated seconds; **14 imports** observed and nonzero completed service at all nine STSs; zero reported safety/manifest errors.

These are observed validations, **not** full-scale certification.

### Mandatory outstanding gates

1. Full **12 discharge + 8 load** cargo per vessel, all three vessels fully discharged, loaded and departed, without timeout.
2. Repeat the full workload across multiple deterministic seeds, and a continuous-vessel pipeline over several vessel replacements.
3. Run congested parking/quay/yard scenarios, blocked routes, stalled vehicles, crane outages, scarce and full yard storage, and truck interference.
4. Demonstrate absence of indefinite silent stalls, and actionable recovery from tested deadlocks (including wait-for-resource cycles).
5. Validate browser-rendered movements and grid connections, not just engine statistics.
6. Verify exact per-STS waiting-cause accounting and a meaningful, attainable scheduler-delay KPI target; distinguish true physical capacity limits from scheduling defects.
7. Confirm double-cycle eligibility, correct vessel sequencing and no starvation of urgent cranes.
8. Record throughput and latency distributions, not only one cumulative end value.

**Engineering targets**: zero unresolved deadlocks, zero unexplained STS waiting, zero unsafe overlaps, zero manifest duplication, and every tested normal-workload vessel eventually departing. A **sub-10% scheduler-attributed avoidable idle share** may be used as an initial *goal*, not an assertion about gross STS waiting; refine it only with documented physical-capacity analysis. Never guarantee zero gross idle under finite travel/crane capacity.

### Expected next test development

Create scenario fixtures and automated assertions for: parking-exit conflict/release, each berth receiving service, RTG saturation/queue recovery, loaded AGV unable to deliver, zero-progress AGV watchdog, grid/visual graph parity, emergency replan and multi-ship mixed load/discharge operations. Ensure simulator errors fail CI, not merely appear as log events.

## 10. Instrumentation, watchdog and deadlock recovery

Implement a deterministic trace/event system for every important transition. Minimum event fields: `simulationTime`, `vehicleId`, `vesselCallId`, `stsId`, `missionId`, `containerId`, `fromState`, `toState`, `blockingReason`, `blockingResourceId`, `routeOrReservationId` (when present).

- Store last progress time and planned next action per AGV and per mission.
- After a configurable no-progress threshold, produce a blocker trace showing precisely which AGV, road section, crane, transfer stand or reservation prevents movement.
- Build wait-for dependencies and detect cycles, not just stalled counts.
- Recover safely by releasing stale reservations, safe rerouting, or mission replanning; do not teleport or force vehicles through occupied zones.
- Add tests that intentionally trigger deadlocks and assert bounded recovery or explicit unresolved-condition failure.
- Distinguish available-but-unassigned parked AGVs (often valid) from mission-assigned AGVs stuck at parking (a likely defect).
- Ensure a request cannot be lost from the demand registry when a resource authorization attempt fails.

## 11. Development workflow and change discipline

1. Reproduce a failing scenario with a seed and store a machine-readable trace.
2. Identify the *first causal blocker*, not just the last vehicle waiting.
3. Write a focused failing unit or integration test for that condition.
4. Fix the relevant component, keep resource ownership explicit and eliminate duplicate authority.
5. Re-run targeted tests and the whole shipped suite.
6. Add extended multi-seed and long-run acceptance results, with actual runtimes and simulated durations.
7. Update `README.md`, `docs/ARCHITECTURE.md`, `docs/TEST_STATUS.md`, and this file if contracts change.
8. Summarize behavior changes, evidence, known risks, and remaining failures in the final report.

Keep changes reviewable and leave the repository runnable. Do not silently remove public diagnostics, UI features, manifests, trucks, cranes or safety checks. Avoid invented data and made-up test outcomes. Prefer code-level interfaces and tests over screenshot-based inference, but inspect browser visuals when graphics are changed.

## 12. Immediate next actions for Codex

1. Run all supplied tests; confirm standalone and embedded controller parity.
2. Add deterministic normal-load full-cycle tests with progress/watchdog reporting so long runs yield useful diagnosis rather than simply timing out.
3. Instrument parking exit, quay feeder, yard docking and RTG capacity wait-for chains.
4. Trace any stranded AGV and each STS with eligible work but no promptly arriving empty AGV.
5. Refactor mission/reservation authority only where the trace proves a circular or over-broad dependency; keep physical crane execution authoritative.
6. Run multi-seed full-cycle completion tests, then sustained continuous-vessel tests; iterate until all acceptance gates pass or a quantified physical-capacity blocker is demonstrated.
7. Verify render/route consistency with browser automation, including parking and road junction visuals.

## 13. Reporting format

For every major test or milestone, provide:

- **Change:** files and interfaces changed, why, and what risk they address.
- **Scenario:** seed, number of vessels, discharge/load counts, crane availability and run length.
- **Outcome:** pass/fail/timeout, completed moves and departures, mission counts, zero-progress AGVs.
- **KPIs:** per-STS and overall throughput, gross idle and cause breakdown, scheduler-delay estimate, AGV productive/parked/blocked time, double cycles and empty distance.
- **Safety:** route failures, AGV overlaps, crane-rail errors, manifest violations, job errors.
- **Evidence:** command output, JSON report path and relevant trace examples.
- **Remaining:** open acceptance gates and next root-cause action.

No old-versus-new legacy comparison is required. Never label an untested browser appearance, a timed-out scenario or a small-only success as full production certification.
