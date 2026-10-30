# pipeline-framework

Generic data pipeline orchestration framework. Provides a retry-aware sequential step runner with
injectable domain and persistence adapters. Start a new data project here instead of copying from
an app that has domain assumptions baked in.

See [docs/portability-matrix.md](docs/portability-matrix.md) for the boundary between
reusable orchestration and application-specific adapters.

---

## What the Core Runner Does

`runPipeline()` orchestrates a sequential list of steps with:

- **Run locking** — prevents concurrent runs (via PersistenceAdapter, optional)
- **Preflight checks** — domain-defined precondition assertions before any step runs
- **Retry loop** — each step retried up to `maxRetries` times with linear backoff (1500ms × attempt)
- **Step logging** — every attempt (including retried failures) recorded via PersistenceAdapter
- **Post-step validation** — domain-defined guardrails that can abort the pipeline after any step
- **Finalization** — always-runs cleanup/visibility hook in the `finally` block
- **`dryRun` support** — domain steps opt into dry-run skipping; the framework passes the flag through

The runner itself has no knowledge of your domain, your database, or your external APIs.

---

## What a DomainAdapter Must Provide

You must implement four hooks:

| Hook | Called when | Throw to |
|------|-------------|----------|
| `preflight(runnerOptions, domainConfig)` | Before any steps | Abort before the pipeline starts |
| `buildSteps(runnerOptions, domainConfig, state, context)` | Once, before step loop | — |
| `validateStep(stepName, runnerOptions, domainConfig)` | After each step | Abort the pipeline |
| `finalizeRun(runnerOptions, domainConfig)` | Always (finally block) | — (catch internally) |

`buildSteps` returns an ordered array of `{ stepName: string, fn: async () => object }`. The `fn`
return value is recorded as step metrics. Throw inside `fn` to fail the step (triggers retry).

`state` is a mutable object you control — use it to pass data from one step to the next.

See [docs/adapter-guide.md](docs/adapter-guide.md) for the full interface and lifecycle diagram.

---

## What a PersistenceAdapter Provides (Optional)

The PersistenceAdapter is entirely optional. Pass `null` to run with no persistence.

When provided, it enables:

| Method | Purpose |
|--------|---------|
| `createRunLock(runnerOptions)` | Prevent concurrent runs; detect and cancel stale locks |
| `createRun(params)` | Create a run record; return an opaque `runId` |
| `updateRun(runId, patch)` | Update run status, current step, heartbeat, metrics |
| `logStep(runId, stepName, attempt, status, startedAt, completedAt, metrics, errorMessage)` | Append a step attempt log entry |

You write the persistence adapter for your storage backend (Postgres, SQLite, file, etc.).
The framework makes no assumptions about how data is stored.

---

## How to Wire a New Project

### 1. Install

Requires Node.js 18+ and Git. No runtime dependencies or private configuration are
needed. To develop from source:

```bash
git clone https://github.com/bpronin90/pipeline-framework.git
cd pipeline-framework
npm test
npm run check
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. To use it from a
separate project:

```bash
# From GitHub (no npm publish yet):
npm install github:bpronin90/pipeline-framework
```

### 2. Implement your DomainAdapter

```js
// my_domain_adapter.js
export const myDomainAdapter = {
  async preflight(runnerOptions, domainConfig) {
    // Assert preconditions or throw.
  },

  buildSteps(runnerOptions, domainConfig, state, context) {
    return [
      {
        stepName: 'fetch_records',
        fn: async () => {
          if (runnerOptions.dryRun) return { skipped: true };
          const records = await myApi.fetch(domainConfig.batchSize);
          state.records = records;
          return { fetched: records.length };
        },
      },
      {
        stepName: 'store_records',
        fn: async () => {
          if (runnerOptions.dryRun) return { skipped: true };
          const result = await myDb.upsert(state.records);
          return { upserted: result.count };
        },
      },
    ];
  },

  async validateStep(stepName, runnerOptions, domainConfig) {
    // Return metrics or undefined. Throw to abort.
  },

  async finalizeRun(runnerOptions, domainConfig) {
    // Cleanup or logging. Catch your own errors here.
  },
};
```

### 3. Run

```js
import { runPipeline } from 'pipeline-framework';
import { myDomainAdapter } from './my_domain_adapter.js';

const result = await runPipeline(
  {
    execution_mode: 'cli',
    mode: 'incremental',
    maxRetries: 2,
    dryRun: false,
    domainConfig: { batchSize: 100 },
  },
  myDomainAdapter,
  null  // no persistence adapter
);

console.log(result);
// { run_id: null, status: 'completed', metrics: { fetch_records: { fetched: 100 }, ... } }
```

See [examples/example_domain_adapter.js](examples/example_domain_adapter.js) for an annotated
skeleton with inline guidance.

---

## Runner Config Reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `execution_mode` | string | **required** | Who triggered this run: `'cli'`, `'job'`, `'maintenance'`, etc. |
| `mode` | string | `'incremental'` | `'full_rebuild'` or `'incremental'` |
| `maxRetries` | number | `2` | Retry count per step (0–5). 0 = run once, no retries. |
| `force` | boolean | `false` | Skip run-lock check. |
| `dryRun` | boolean | `false` | Passed to domain hooks; domain steps opt into skipping side effects. |
| `opsEnabled` | boolean | `true` | If false, PersistenceAdapter is disabled even if provided. |
| `domainConfig` | object | `{}` | Passed as-is to all domain adapter hooks. |

---

## Persistence Assumptions

The framework makes **no persistence assumptions**. It does not import any database client.

If you want run locking and step logging, implement a `PersistenceAdapter` for your storage backend.
Keep deployment-specific connection details and storage relationships in the
consuming application's private configuration.

---

## Project boundaries

This repository owns the runner, retry loop, and adapter contracts. Consuming
applications own their domain steps, schemas, serving layers, and persistence
implementations. The framework does not require access to another repository.

See [docs/portability-matrix.md](docs/portability-matrix.md) for the portability
boundary.

## License

[MIT](LICENSE), copyright 2026 Ben Pronin. The notice from the MIT-licensed
orchestration code on which this framework is based is retained in full. This
license covers the framework; adapters and external datasets retain their own
licenses and terms.
