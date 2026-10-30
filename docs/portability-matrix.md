# Portability / Rewrite Matrix

Use this boundary when adapting an existing pipeline to `pipeline-framework`.
Application names, database layouts, and deployment relationships belong in the
consuming application's private documentation.

| Bucket | Meaning |
| --- | --- |
| **A — Portable as-is** | Generic orchestration already provided by the framework |
| **B — Portable with light adaptation** | Connect the existing concept through an adapter |
| **C — Concept portable, implementation rewrite** | Reuse the pattern with a storage- or domain-specific implementation |
| **D — Application-specific, do not extract** | Keep the implementation in the consuming application |

## Orchestration and persistence

| Component | Bucket | Boundary |
| --- | --- | --- |
| `sleep`, `ensureBounded`, sequential step loop | **A** | Framework helpers and runner |
| Step array, mutable state, execution context | **A** | `DomainAdapter.buildSteps()` supplies steps |
| Bounded retries with linear backoff | **A** | Framework runs and logs each attempt |
| Run lock acquisition | **B** | `PersistenceAdapter.createRunLock()` |
| Run records and heartbeat updates | **B** | `PersistenceAdapter.createRun()` and `updateRun()` |
| Per-attempt step logging | **B** | `PersistenceAdapter.logStep()` |
| Optional persistence | **A** | Pass `null` or disable `opsEnabled` |
| Stale-lock detection and cancellation | **C** | Implement for the selected persistence backend |
| Run and step-log storage schemas | **C** | Application owns tables, privileges, and migrations |
| Database-specific error handling | **D** | Persistence adapter owns backend-specific behavior |

## Domain behavior

| Component | Bucket | Boundary |
| --- | --- | --- |
| `preflight`, `buildSteps`, `validateStep`, `finalizeRun` interfaces | **A** | See [adapter guide](adapter-guide.md) |
| Preconditions and post-step assertions | **B** | Domain adapter supplies checks |
| Quality gates, coverage thresholds, and event-log patterns | **C** | Reuse the pattern; retain domain-specific metrics and storage locally |
| Source registries and fan-out | **C** | Domain adapter selects and coordinates its sources |
| External API ingestion and health checks | **D** | Application owns providers, credentials, and data terms |
| Identity resolution, transforms, and overrides | **D** | Application owns domain contracts |
| Serving schemas, public API, and frontend | **D** | Application owns its user-facing behavior |

The adapter seam separates framework execution from application behavior. Nothing
in this matrix changes the runner interfaces or guarantees. Initialization runs
before the execution `try/finally`; once execution starts, `finalizeRun` is
attempted in `finally`. It is not guaranteed after an initialization failure.
