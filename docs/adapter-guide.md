# Adapter Guide

This document defines the two adapter interfaces that `pipeline-framework` depends on:

1. **DomainAdapter** — the only thing you *must* implement to use the framework
2. **PersistenceAdapter** — optional; enables run locking, run records, and step logging

---

## DomainAdapter

The DomainAdapter encapsulates everything that is specific to your application's data domain. The framework runner calls your adapter hooks at specific points in the pipeline lifecycle.

### Interface

```js
const myDomainAdapter = {
  /**
   * Called before any steps run. Use this to validate preconditions:
   * required tables are empty, configs are valid, external APIs are reachable, etc.
   *
   * Throw to abort the pipeline before it starts.
   *
   * @param {RunnerOptions} runnerOptions  — normalized runner config (mode, dryRun, force, …)
   * @param {object}        domainConfig   — your raw domain config, passed through unchanged
   */
  async preflight(runnerOptions, domainConfig) {},

  /**
   * Build and return the ordered array of pipeline steps.
   *
   * Each step is a plain object: { stepName: string, fn: async () => object }.
   * The fn() return value is recorded as the step's metrics. Return {} if there is nothing to record.
   * Throw inside fn() to signal step failure (triggers retry, then pipeline abort).
   *
   * @param {RunnerOptions} runnerOptions
   * @param {object}        domainConfig
   * @param {object}        state    — mutable object for passing data between steps (starts as {})
   * @param {object}        context  — immutable run context: { execution_mode }
   * @returns {Array<{ stepName: string, fn: () => Promise<object> }>}
   */
  buildSteps(runnerOptions, domainConfig, state, context) {
    return [];
  },

  /**
   * Called after each step completes successfully. Use this for post-step assertions,
   * row-count checks, or any guardrails that should abort the pipeline if violated.
   *
   * Throw to abort the pipeline. Return a metrics object (or undefined) to be recorded.
   *
   * @param {string}        stepName
   * @param {RunnerOptions} runnerOptions
   * @param {object}        domainConfig
   * @returns {Promise<object|undefined>}
   */
  async validateStep(stepName, runnerOptions, domainConfig) {},

  /**
   * Called in the `finally` block after the pipeline succeeds or fails.
   * Use this for cleanup, visibility logging, or post-run notifications.
   * Errors here are suppressed by convention (log, don't throw).
   *
   * @param {RunnerOptions} runnerOptions
   * @param {object}        domainConfig
   */
  async finalizeRun(runnerOptions, domainConfig) {},
};
```

### RunnerOptions shape

The framework normalizes your raw `config` before passing it to adapter hooks:

```js
{
  mode: 'full_rebuild' | 'incremental',
  executionMode: string,   // mirrors config.execution_mode
  maxRetries: number,      // 0–5
  force: boolean,
  dryRun: boolean,
  opsEnabled: boolean,
}
```

---

## PersistenceAdapter

The PersistenceAdapter is **optional**. If you pass `null` (or omit it), the framework runs with no persistence: no run lock, no run record, no step logging.

Pass a PersistenceAdapter when you want to:
- prevent concurrent runs (run lock)
- record run history and step timing (ops tables)
- enable heartbeat / stale-run detection

### Interface

```js
const myPersistenceAdapter = {
  /**
   * Acquire a run lock. Throw if a run is already in progress (and force=false).
   * This is the correct place to implement stale-lock detection and auto-cancellation.
   *
   * @param {RunnerOptions} runnerOptions  — includes force: boolean
   */
  async createRunLock(runnerOptions) {},

  /**
   * Create a run record and return its opaque ID.
   * Return null to disable per-run persistence for this run.
   *
   * @param {object} params
   * @param {string} params.execution_mode
   * @param {string} params.mode
   * @param {number} params.total_steps
   * @param {object} params.domainConfig
   * @returns {Promise<string|number|null>}  — runId passed to all subsequent calls
   */
  async createRun(params) {},

  /**
   * Update the run record with the given fields (e.g. current_step, status, metrics).
   * Also update a heartbeat timestamp if your implementation supports it.
   *
   * @param {string|number} runId
   * @param {object}        patch
   */
  async updateRun(runId, patch) {},

  /**
   * Append a step log entry. Called for every attempt (including retried failures).
   *
   * @param {string|number} runId
   * @param {string}        stepName
   * @param {number}        attempt       — 1-based attempt index
   * @param {'completed'|'failed'} status
   * @param {string}        startedAt     — ISO timestamp
   * @param {string}        completedAt   — ISO timestamp
   * @param {object}        metrics       — step return value (or {})
   * @param {string|null}   errorMessage
   */
  async logStep(runId, stepName, attempt, status, startedAt, completedAt, metrics, errorMessage) {},
};
```

---

## Wiring It Together

```js
import { runPipeline } from 'pipeline-framework';
import { myDomainAdapter } from './my_domain_adapter.js';
import { myPersistenceAdapter } from './my_persistence_adapter.js'; // optional

const result = await runPipeline(
  {
    execution_mode: 'cli',
    mode: 'incremental',
    maxRetries: 2,
    dryRun: false,
    domainConfig: {
      // anything your domain adapter needs
      dataDirectory: '/data',
      batchSize: 100,
    },
  },
  myDomainAdapter,
  myPersistenceAdapter  // pass null to skip all persistence
);

console.log(result);
// { run_id: 42, status: 'completed', metrics: { step_one: { rows: 100 }, ... } }
```

---

## Step Retry Behavior

Each step is retried up to `maxRetries` times on failure (default: 2 retries = 3 total attempts).

Retry backoff: `1500ms × attempt_number` (linear, not exponential).

- Attempt 1 fails → wait 1500ms
- Attempt 2 fails → wait 3000ms
- Attempt 3 fails → throw and abort pipeline

The framework records every attempt (including failures) via `PersistenceAdapter.logStep()`, so retry history is preserved in run logs.

---

## Lifecycle Diagram

```
runPipeline()
│
├── persistenceAdapter.createRunLock()         ← throws if concurrent run detected
├── domainAdapter.preflight()                  ← throws to abort before steps
├── domainAdapter.buildSteps()                 ← returns ordered step array
├── persistenceAdapter.createRun()
│
├── for each step:
│   ├── persistenceAdapter.updateRun()         ← heartbeat + current_step
│   ├── step.fn()   [with retry loop]
│   ├── persistenceAdapter.logStep()
│   └── domainAdapter.validateStep()           ← throws to abort pipeline
│
├── persistenceAdapter.updateRun(status: 'completed' | 'failed')
│
└── domainAdapter.finalizeRun()                ← always runs (finally block)
```