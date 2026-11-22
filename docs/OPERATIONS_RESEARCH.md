# Operational basis for STS supply scheduling

Research consulted on 2026-11-22. These sources motivate coordination principles; they do not certify PORTGRID's equipment capacities or its numerical targets.

## Evidence from terminals and research

- [HHLA: Container Terminal Altenwerder](https://hhla.de/en/the-power-of-networks/automation/cta-hamburg-the-container-terminal-altenwerder) describes integrated control of AGV routes, quay cranes and block storage, including equipment monitoring. The relevant lesson is to coordinate the whole transfer chain rather than allocate vehicles independently of crane and yard work.
- [Coordinated scheduling optimization of quay cranes and AGVs](https://doi.org/10.1016/j.cor.2025.107147) formulates joint scheduling with crane safety intervals and task relationships, minimizing makespan. It supports treating arrival timing and equipment interactions as scheduling inputs, rather than equating assignment with service.
- [Scheduling AGVs for tandem quay cranes](https://doi.org/10.1016/j.cor.2023.106505) explicitly includes traffic conflicts and limited yard buffers. PORTGRID has ordinary single-container transport, so tandem capacity figures are not transferable; finite stands and traffic constraints remain relevant.
- [APM Terminals Algeciras productivity report](https://akamai.apmterminals.com/en/algeciras/about/news/2025/251124-APM-Terminals-Algeciras-breaks-its-productivity-record-with-Maastricht-Maersk) reports a 2025 target of 28.5 crane moves/hour and a vessel call with 251 port moves/hour. Crane and terminal rates are different denominators, and that terminal differs from this simulation. PORTGRID's agreed 25 gross moves/crane-hour is a project acceptance target, not an industry-wide minimum.
- [World Bank: Container Port Performance Index](https://www.worldbank.org/en/topic/transport/publication/cppi) emphasizes vessel time in port. This motivates retaining complete vessel departure and turnaround measures alongside crane rates; high instantaneous crane activity alone is insufficient.

## Application to this simulation

The engineering interpretation is predictive supply: dispatch an empty AGV or prepare an accessible export early enough for the next crane cycle, while respecting the ship-wide discharge barrier. Use a small physical stand buffer, share the fleet fairly, release crane execution after physical handling, and distinguish a future arrival reservation from current crane occupancy. A vehicle outside its transfer slot cannot own STS/RTG execution.

Real terminals may also use dual-trolley cranes, lift-AGVs or physical container buffers. Those would change equipment capabilities. They are not assumed here: container transfers still require the existing physical STS/RTG, and no unattended rack or fictitious handover is introduced.

Capacity analysis must use consistent units. For example, an average transport cycle of `T` seconds supporting a move rate of `lambda` moves/second requires at least `lambda × T` vehicles before congestion and variability. Likewise, a crane cycle of `C` seconds gives an idealized upper rate of `3600/C` moves/hour. These are analytical bounds, not measured outcomes or guarantees.

## Honest acceptance

The normal-load gates use completed physical moves, all working-vessel crane-hours, both scheduler-delay shares below 10%, and safe full cargo completion. Gross waiting remains reported, including transport and physical resource constraints. `stateSeconds` covers phase barriers and work exhaustion as well as handling and waiting. Witness-based delay identifies omitted feasible actions; it does not establish globally optimal dispatch or prove every other delay unavoidable.

Refer to [TEST_STATUS.md](TEST_STATUS.md) for actual source-qualified runs, failures and remaining limits. No old-versus-new legacy benchmark is used.
