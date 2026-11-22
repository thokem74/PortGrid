# PORTGRID — STS-driven terminal simulation

PORTGRID simulates three berths, nine STS cranes, six yard blocks with twelve RTGs, 24 AGVs and twelve external trucks. Open `PORTGRID_Standalone.html` in a modern desktop browser. Three.js requires Internet access to its CDN; no local server is required for normal use.

The DOM-free controller, physical engine and reliability monitor are source modules embedded into the HTML. After editing a source module, rebuild the standalone file:

```bash
node scripts/embed.js
node tests/source-parity.test.js
```

Use Node.js 22+. There are no npm dependencies for headless acceptance:

```bash
npm test
npm run test:extended
node tests/integration.acceptance.js list
node tests/integration.acceptance.js complete-normal-seed3
```

`npm test` includes source/syntax checks, controller/monitor/traffic/physical-fault/supply/transfer-ownership tests, both shipped small scenarios, early normal service and full normal seeds 3, 7 and 11. Full normal acceptance additionally requires at least 25 gross moves per crane-hour and under 10% estimated and evidenced scheduler delay. These are project targets, not guaranteed results. The extended suite also runs temporary yard outage, blocked parking release, loaded-delivery outage, physical full-storage recovery, high load, and small and normal continuous-vessel pipelines. Normal continuous scenarios use seeds 3, 7 and 11 over 10,800 simulated seconds. A failed acceptance returns a nonzero exit code; inspect the actual report rather than assuming every listed scenario is certified.

Reports in `reports/` contain scenario configuration, source hashes, actual simulated/wall time, result, cumulative safety counts, per-STS/yard/fleet KPIs, physical stage latency summaries and progress snapshots. Each run streams a unique `reports/runs/SCENARIO-RUN_ID.events.ndjson` referenced by its report, preventing concurrent runs from mixing event traces. `*.progress.json` remains useful during a long run. Suite reports record each command and exit status. `reproduction-*.json` preserves earlier failing conditions and must not be read as current certification.

Optional browser smoke testing uses Chromium and Node's built-in WebSocket/CDP support, a loopback-only server and a disposable browser profile:

```bash
node tests/browser.smoke.js
node tests/browser.smoke.js --extended
```

Set `BROWSER_BIN` if Chromium is installed elsewhere. The smoke test checks Three.js rendering, actual AGV movement, top/quay camera controls, JavaScript console errors and sampled safety counters, and saves screenshots. The extended mode advances 900 simulated seconds with rendered frames and requires observations at parking exits, STS stands, yard junctions and truck corridors. It needs permission to bind localhost and access the CDN. This is browser smoke coverage, not full rendered long-run certification.

The engine can also be used directly:

```js
const createEngine = require('./portgrid-engine');
const sim = createEngine({rng: seededRandom, continuousVessels: false,
  dischargePerCall: 12, loadPerCall: 8, onEvent: event => save(event)});
sim.tick(0.1);
console.log(sim.getKPI(), sim.reliabilityDiagnostics());
```

STS demand persists without yard capacity. Physical crane transfers confirm cargo completion; discharge-before-load and collision/rail interlocks remain authoritative. Diagnostics expose blockers and bounded recovery attempts. Gross STS waiting is distinct from the estimated scheduler-delay subset.

An AGV or truck outside its transfer slot cannot occupy STS/RTG execution. `resources.craneOccupancy()` exposes each physical crane owner and alignment; `status().transferOwnershipViolations` is a cumulative hard-failure counter. Storage and arrival-slot reservations remain separate from crane execution. Trucks release the RTG after yard pickup, before travelling to the gate.

See [architecture](docs/ARCHITECTURE.md), [operational research](docs/OPERATIONS_RESEARCH.md), and [verified results and limitations](docs/TEST_STATUS.md). Sustained operation, exact causal KPI targets and arbitrary deadlock freedom require separate evidence.
