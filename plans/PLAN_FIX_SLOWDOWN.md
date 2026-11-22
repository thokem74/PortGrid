# Keep PortGrid responsive during long runs

## What the investigation found

**Completed records are making live scheduling more expensive.** In a controlled headless test, the same seeded 60-second simulation window took **0.84–0.85 seconds** with its original history and **1.84–2.09 seconds** after adding 1,000 completed jobs and orders in memory. Moves and event counts matched. The CPU profile pointed to yard availability and reservation checks, especially `freeSlot` and `topYard`, which scan retained jobs for each candidate storage slot. This slowdown reproduced without Chromium or report-file writes. [Engine hot paths](portgrid-engine.js)

**The browser can amplify the slowdown.** Building container-table data took **0.94 ms** at baseline, **21.11 ms** with 1,000 extra retained orders, and **45.47 ms** after also adding 2,000 departed containers. Those timings exclude rendering and DOM updates. The scene also scans retained cargo and updates the full 4,400-instance buffer every third frame. Once FPS drops far enough, the frame loop’s 70 ms clamp reduces how much simulated time advances per real second. The browser contribution still needs a frame profile. [Browser update loop](PORTGRID_Standalone.html)

The simulator keeps its data in memory. Recent events are capped at 7,000, and the monitor keeps one record per vehicle. A separate headless-test cost comes from rewriting the entire progress report every minute. The last seed 11 progress file exceeded **5 MB**. [Acceptance reporting](tests/integration.acceptance.js)

## Recommended fixes, in order

1. **Index live work and yard reservations first.** Use ID lookups and active collections for jobs, orders, requests, and missions. Track which active job owns each storage slot, relay buffer, or destination. Make yard availability, dispatch, and physics read those indexes. Update them at assignment, stage changes, completion, and cancellation. Preserve record ordering, reservation rules, seeded selection, and the existing audit history.
2. **Reduce repeated browser work.** Use the order-by-ID lookup when building inventory rows. Keep search and record counts intact while building only the displayed rows. Render from current cargo, reuse instance buffers, and update changed transforms. Measure frame time and simulated seconds per real second before changing the clock.
3. **Make progress reporting incremental.** Append each sample once and keep a small latest-status file for monitoring. Preserve the final report and event trace formats. Defer event-buffer changes until profiling shows that rollover is a material cost.

## Verification

- Repeat the seeded headless probe with zero and 1,000 retained completed records. Aim for no more than **25% additional tick time** with the larger archive, with identical assignments, physical completions, safety counters, and audit output.
- Profile Chromium with the inventory modal closed and open. Record frame time, tick time, and simulation speed separately. Compare report serialization and write time in the headless runner.
- Run the core suite and a continuous-vessel scenario. Report runtime performance separately from cargo throughput and storage-capacity limits.

The investigation used temporary in-memory fixtures. Repository files were left unchanged during the investigation.
