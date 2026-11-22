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

The controller adapter retains `now`, `demands`, `availableVehicles`, `isVehicleFree`, `pickup`, `stsWaiting`, `canReserve`, `reserve`, `progress`, `start`, `preposition`, and `waitReason`. Its optional predictive extension adds `serviceStatus(mission)` (`SUPPLYING`, `HANDLING`, `SERVED`), `serviceForecast(crane)` (`readyIn`, `cycleSeconds`) and `estimateArrival(request, vehicle)` (`seconds`, `distance`). `reserve` accepts an optional third context argument carrying `requestedAt`. Adapters without the extension retain the previous behavior; unit fixtures exercise compatibility.

Transport lifetime is separate from STS supply coverage: an import delivering to the yard after STS pickup is `SERVED` for supply accounting while its transport mission remains active. The dispatcher bounds supply to two vehicles per STS, leaving two of its four lanes for current handling and clearance. Hard first-coverage fairness and oldest allocation time prevent a repeatedly available crane from overtaking an unserved crane. Arrival estimates use cached directed graph distances, physical parking-exit paths, exit queues, observed service cycles and local traffic. Forecasts grant no movement permissions and consume no RNG.

Request identity is `vesselCall|direction|container`. Absence of storage or a free RTG does not remove demand. Failed admission now retains the adapter's concrete rejection reason rather than replacing it with a generic capacity label. Missions retain `WAITING`, `PREPOSITIONING`, `READY_FOR_STS`, `RUNNING`, `BLOCKED`, `DONE`, and `CANCELLED` states.

Only real lifts confirm work-list completion. A vessel cannot load before every discharge entry is physically DONE, and cannot depart with unfinished cargo/jobs. Import admission reserves concrete exclusive storage before pickup. Pending empty supply is bounded by the fleet and STS stands; the separate limit of three active import deliveries per yard remains in force. Destination selection balances commitments before comparing estimated delivery completion. Storage reservations survive prepositioning and cannot be reused by relays or other containers.

`crane.job` means physical execution, never a vehicle's approach reservation. A shared acquisition check requires the AGV or truck to be stationary, parallel to the container, centered in its actual assigned STS/RTG slot and authorized against crane outage/occupancy. No AGV or truck outside a slot can acquire execution. A misaligned empty AGV requests a gradual guarded turn before acquisition; loaded vehicles are not forced to pivot. Direct two-crane yard relays are physical storage jobs without a vehicle handover and retain their own crane ownership.

All pickup cranes release after the physical lift and spreader clearance, including truck pickups before gate travel. Export yard-bay reservations release after pickup; import STS-lane reservations stop claiming the stand after pickup. The departing vehicle's actual body remains protected by the movement guards. Long background inbound relays defer while committed imports need that block; deferral does not assign a crane to an approaching vehicle. `resources.craneOccupancy()` and the cumulative `transferOwnershipViolations` counter expose execution ownership. Every physics step stops on an invalid vehicle-related crane claim, and acceptance asserts zero such violations.

Booked exports physically stored on the truck side require a two-RTG relay. When the crane pair is free, an urgent relay gets admission before another truck job. Relay final storage and buffer slots are excluded from other storage admission throughout the relay.

## Traffic and recovery

The existing quay bypass at z=0 is westbound and z=12 eastbound. Road positions, lane pitches and colors are unchanged; the renderer uses corresponding logical edge styles. Loaded discharge egress reaches the westbound bypass before westward travel. Yard-to-STS trips use the eastbound bypass and the assigned crane's local approach column. Routes between nonnegative-z travel points cannot cut through STS handover rows. Parking is excluded as a shortcut between terminal destinations. Replanning preserves actual parking-exit/return geometry and never treats a connector vehicle as if it were in a stall.

Turning approaches check the complete swept chassis envelope before entering a junction. Temporary turn reservations exclude conflicting movements until the owner has cleared that footprint. A reservation is published only after actual movement or waypoint advancement; a failed body/section check cannot create phantom turn ownership. Route-version changes and physical clearance release the reservation. This prevents two loaded vehicles from entering a merge that neither can subsequently turn through. Turn ownership is a traffic permission and never a crane claim.

Immediate intermediate out-and-back connector spurs are removed. The final approach edge is retained because it establishes chassis alignment. Empty return vehicles may be reassigned only at actual terminal graph nodes. A correctly reserved next pickup at the same yard bay no longer triggers an unnecessary parking trip.

AGVs use rolling section permissions, downstream lookahead and the existing inflated body collision envelopes. AGV bay admission uses those same envelopes: parallel bay centers are 7 m apart and AGV inflated width is 5.3 m. A circular 8 m occupancy test incorrectly denied safe neighboring AGV bays. Truck bay admission separately preserves its existing 13 m traffic separation, including reservations for approaching trucks.

Routing penalizes a first edge whose required body orientation is immediately blocked. Replanning checks its time eligibility before scanning graph nodes. The movement guard remains authoritative even when a planner proposes a route.

For a detected wait-for cycle or an empty AGV blocked for over 30 seconds, bounded recovery may use a clear adjacent graph edge. Ordinary escape edges are at most 20 m; retreat along an actually traversed connector may be longer. Approaching traffic is considered before selecting an escape. There are at most three escape attempts per completed-job count. Loaded AGVs are excluded. A dynamically blocked escape or reverse can abort back to its origin. A following empty vehicle backs off only far enough to clear the leading vehicle's swept turn envelope; if its traversed straight prefix is too short, at most two adjacent real graph sections may extend that reverse under exclusive section/body guards. Sideways reverse movement is forbidden. Normal following traffic preserves turn-envelope headway. All movement, section, body and pivot guards remain authoritative; there are no position jumps.

Truck journeys retain conservative full-route permits. A stopped holder can transfer admission to a truck physically blocking its next movement; conflicting journey permits are revoked first and the existing truck separation guard remains active. Denied truck permits accumulate waiting time. Truck recovery reverses the actual traversed approach prefix for detected inbound/inbound or return/return cycles, then resumes the original intent when the opponent clears. General deadlock freedom is not proven.

Crane outage checks also apply during `performLift`, preserving a suspended container and spreader until recovery.

## Diagnostics and traces

`sim.reliabilityDiagnostics()` returns vehicle observations, wait-for dependencies/cycles, per-STS work/request/assigned-vehicle information, current gross waiting cause/duration, throughput, and cargo-location diagnostics for outstanding requests. `sim.diagnostics()` includes this information alongside the existing diagnostics.

Each vehicle record includes vehicle/mission/vessel/STS/container identity, state, physical position and next waypoint, blocker/resource, route reservation identity, traffic permission, last physical progress, waiting duration, planned action and recovery attempts. Truck observations extend dependency chains through yard-crane owners. Idle trucks queued at their gate receive a crane-capacity reason.

Progress is cumulative displacement greater than 0.1 m, physical job/handling phase or container-history advancement, or a completed-job change. A route-version change alone is never progress. Default no-progress event threshold is 60 simulated seconds (`noProgressSeconds` option). The monitor reports cycles; the engine retains recovery authority.

`onEvent(event)` streams events without the UI's 7,000-event ring limit. Events have normalized identity/state/blocker fields, null when inapplicable. Event `type` cannot be overwritten by a payload's cargo direction; that value is exposed as `operationType`. `eventCounts` and double-cycle counts are cumulative. The runner streams a unique run-ID NDJSON file and writes progress snapshots every 60 simulated seconds. It fails on 300 seconds without physical progress for an AGV or travelling truck, and on 600 seconds without vessel cargo progress while work remains. Queued gate trucks still produce diagnostics; known gate resource waits alone do not fail the travelling-truck gate.

## KPI definitions and limits

`avoidableSTSPercent` and `avoidableSTSSecs` retain their historical meanings: gross AGV-related STS waiting, not proven avoidable delay. `stsWaitBreakdown` partitions that gross waiting. Unassigned demands now retain the adapter's actual rejection cause, so a known full yard stand is no longer mislabeled as unserved scheduling demand. Gross waiting and its denominator remain visible. `schedulerDelaySeconds` retains its named-category estimate and is not a proof of avoidability. Crane-seconds are kept unrounded so arithmetic can be checked.

Every working-vessel crane-second also enters `stateSeconds`, including handling, travel, parking, traffic, yard service, authorization, discharge-delivery/ship-phase barriers, inaccessible cargo and exhausted crane work. State transitions carry resource/mission context. `evidencedSchedulerSeconds` counts an observed omitted feasible allocation or aligned handover and includes a trace witness; it does not prove that earlier planning was optimal. `unclassifiedSTSSeconds` checks partition arithmetic, not complete causal optimality. Full normal and continuous-normal gates require at least 25 gross moves/crane-hour and less than 10% for both scheduler shares. All waiting remains in gross crane exposure. These thresholds are engineering targets; a report with failed gates remains a failure even if cargo completes.

Fleet percentages share `observationVehicleSeconds` and partition moving loaded, moving empty, handling, parked assigned, queued assigned, traffic wait and unassigned stationary time. Productive time overlaps the moving/handling categories intentionally and is not an additional partition category. Observation sampling can lag simulation time by less than 0.35 seconds. Empty share is distance-based.

Fleet handling requires actual crane ownership, a physical handling phase and a stationary vehicle; waiting at an occupied RTG is queued time. Reports include per-STS rates, per-yard queue lengths, RTG occupied/hook-motion seconds, fleet fractions, per-minute KPI samples and physical stage min/median/p95/max latencies. Departure is the first physical displacement after allocation, not route assignment. STS arrival and handling start are separate timestamps. Request latency starts when eligible demand becomes visible, while ship phase barriers remain in crane-time accounting.

Double-cycle assignment counts distinguish cross-vessel opposite directions and survive ring rollover. `doubleCycleDistance` compares actual empty distance since the prior transport completion with an explicit unpaired graph-distance route via home parking. Negative savings are retained; this counterfactual is not a replay of alternative traffic and is not proof of globally optimal routing. Complete eligibility/distance-optimality certification remains open. No KPI was validated against a legacy implementation.

All working-vessel intervals have a state category. Full counterfactual causal attribution remains incomplete: resource ownership and current feasibility identify immediate blockers, while proving every earlier dispatch alternative would require additional analysis. `blockedSeconds`, `noWorkSeconds`, outages and `stateSeconds` must also be considered. Low gross waiting cannot be promised from nine STSs sharing three inbound AGV-side RTGs.
