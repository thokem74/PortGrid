# PORTGRID architecture

The standalone browser application and Node runner use the same source modules. No server or adjacent JavaScript files are needed to open the HTML; Three.js still loads from its existing CDN.

| Source | Responsibility |
| --- | --- |
| `portgrid-control.js` | Persistent STS requests, fair mission admission, vehicle scoring, mission lifecycle, pure parking/yard authorization. |
| `portgrid-engine.js` | Physical engine, inventories, manifests, crane execution, routing, resource ownership, traffic authority, trucks, vessel pipeline and KPI sampling. CommonJS entry point exports `makeEngine(options)`. |
| `portgrid-monitor.js` | DOM-free physical progress tracking, state transitions, no-progress events and wait-for cycle detection. Observation does not authorize movement. |
| `PORTGRID_Standalone.html` | Generated copies of these modules plus the preserved Three.js scene and operational interface. |
| `scripts/embed.js` | Reproducible embedding; `--check` fails when any embedded module differs. |
| `tests/integration.acceptance.js` | Seeded scenario runner with periodic progress snapshots, cumulative error assertions, event traces and KPI reports. |

The physical engine remains a large module with internal traffic, inventory and crane closures. These have not all been extracted into independent services. This preserves physical ownership while providing a Node entry point without HTML extraction or `eval`.

## Demand, missions and physical authority

The controller adapter remains `now`, `demands`, `availableVehicles`, `isVehicleFree`, `pickup`, `stsWaiting`, `canReserve`, `reserve`, `progress`, `start`, `preposition`, and `waitReason`.

Request identity is `vesselCall|direction|container`. Absence of storage or a free RTG does not remove demand. Failed admission now retains the adapter's concrete rejection reason rather than replacing it with a generic capacity label. Missions retain `WAITING`, `PREPOSITIONING`, `READY_FOR_STS`, `RUNNING`, `BLOCKED`, `DONE`, and `CANCELLED` states.

Only real lifts confirm work-list completion. A vessel cannot load before every discharge entry is physically DONE, and cannot depart with unfinished cargo/jobs. Admission reserves destination storage and transfer positions, but import RTGs are acquired at the actual handover rather than throughout AGV transit.

Booked exports physically stored on the truck side require a two-RTG relay. When the crane pair is free, an urgent relay gets admission before another truck job. Relay final storage and buffer slots are excluded from other storage admission throughout the relay.

## Traffic and recovery

AGVs use rolling section permissions, downstream lookahead and the existing inflated body collision envelopes. AGV bay admission uses those same envelopes: parallel bay centers are 7 m apart and AGV inflated width is 5.3 m. A circular 8 m occupancy test incorrectly denied safe neighboring AGV bays. Truck bay admission separately preserves its existing 13 m traffic separation, including reservations for approaching trucks.

Routing penalizes a first edge whose required body orientation is immediately blocked. Replanning checks its time eligibility before scanning graph nodes. The movement guard remains authoritative even when a planner proposes a route.

For a detected wait-for cycle, an empty AGV may make a bounded escape onto a clear adjacent graph edge of at most 20 m. It retains its original route intent and resumes planning after physically reaching the escape node. There are at most three such attempts per completed-job count. Loaded AGVs are excluded from this escape. The existing empty-vehicle reverse also supports a long parking connector: its distance from the previous waypoint alone is not a reason to reject physically guarded reversal along the traversed edge. The existing movement/section/body guards execute every step; there is no position jump or collision bypass.

Truck journeys retain conservative full-route permits. A stopped holder can transfer admission to a truck physically blocking its next movement; conflicting journey permits are revoked first and the existing truck separation guard remains active. Denied truck permits accumulate waiting time so they can trigger recovery. Truck gate recovery now reverses the actual traversed approach prefix instead of cutting laterally across occupied gate parking pockets. General deadlock freedom is not proven.

Crane outage checks also apply during `performLift`, preserving a suspended container and spreader until recovery.

## Diagnostics and traces

`sim.reliabilityDiagnostics()` returns vehicle observations, wait-for dependencies/cycles, per-STS work/request/assigned-vehicle information, current gross waiting cause/duration, throughput, and cargo-location diagnostics for outstanding requests. `sim.diagnostics()` includes this information alongside the existing diagnostics.

Each vehicle record includes vehicle/mission/vessel/STS/container identity, state, physical position and next waypoint, blocker/resource, route reservation identity, traffic permission, last physical progress, waiting duration, planned action and recovery attempts. Truck observations extend dependency chains through yard-crane owners. Idle trucks queued at their gate receive a crane-capacity reason.

Progress is cumulative displacement greater than 0.1 m, physical job/handling phase or container-history advancement, or a completed-job change. A route-version change alone is never progress. Default no-progress event threshold is 60 simulated seconds (`noProgressSeconds` option). The monitor reports cycles; the engine retains recovery authority.

`onEvent(event)` streams events without the UI's 7,000-event ring limit. Events have normalized identity/state/blocker fields, null when inapplicable. `eventCounts` is cumulative, so an old JOB_ERROR cannot disappear from acceptance results when the ring rolls over. The runner writes NDJSON transitions and JSON snapshots every 60 simulated seconds, even before final completion. It fails on 300 seconds without progress for an AGV or travelling truck, and on 600 seconds without vessel cargo progress while work remains. Queued gate trucks still produce watchdog diagnostics; known gate resource waits alone do not fail the travelling-vehicle gate.

## KPI definitions and limits

`avoidableSTSPercent` and `avoidableSTSSecs` retain their historical meanings: gross AGV-related STS waiting, not proven avoidable delay. `stsWaitBreakdown` partitions that gross waiting. `schedulerDelaySeconds` remains a state-based estimate. Crane-seconds are kept unrounded internally and in reports so arithmetic can be checked.

Fleet percentages share `observationVehicleSeconds` and partition moving loaded, moving empty, handling, parked assigned, queued assigned, traffic wait and unassigned stationary time. Productive time overlaps the moving/handling categories intentionally and is not an additional partition category. Observation sampling can lag simulation time by less than 0.35 seconds. Empty share is distance-based.

Reports include per-STS rates, per-yard counts, fleet fractions, per-minute KPI samples and assignment-to-completion min/median/p95/max. This latency is not a complete request-to-physical-stage distribution. Existing double-cycle events distinguish cross-vessel opposite-direction assignments; actual distance saved and full eligibility qualification remain open. No KPI was validated against a legacy implementation.

All gross wait intervals have a recorded category, but exact causal attribution for phase-barrier/accessibility waits outside the historical gross-wait subset is still incomplete. `blockedSeconds`, `noWorkSeconds` and outage counters must also be considered. Low gross waiting cannot be promised from nine STS cranes sharing three inbound AGV-side RTGs.
