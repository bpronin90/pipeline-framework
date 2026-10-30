/**
 * example_domain_adapter.js — Skeleton DomainAdapter showing how to wire a new project.
 *
 * Copy this file into your project and fill in the domain-specific logic.
 * See docs/adapter-guide.md for the full interface contract.
 *
 * Usage:
 *   import { runPipeline } from 'pipeline-framework';
 *   import { myDomainAdapter } from './example_domain_adapter.js';
 *
 *   const result = await runPipeline(
 *     { execution_mode: 'cli', mode: 'incremental', domainConfig: { batchSize: 100 } },
 *     myDomainAdapter,
 *     null  // no persistence adapter — runs without run locking or step logging
 *   );
 */

export const myDomainAdapter = {
  /**
   * Pre-run checks. Throw to abort the pipeline before any steps run.
   *
   * Good uses: verify required configs, check external service health,
   * assert that tables/files are empty for a full_rebuild run.
   *
   * @param {object} runnerOptions  — { mode, executionMode, maxRetries, force, dryRun, opsEnabled }
   * @param {object} domainConfig   — your raw config from runPipeline({ domainConfig: ... })
   */
  async preflight(runnerOptions, domainConfig) {
    if (runnerOptions.mode === 'full_rebuild') {
      // Example: assert that your data store is empty before a full rebuild.
      // const count = await myDb.countRecords('my_table');
      // if (count > 0) throw new Error('full_rebuild requires empty my_table');
    }
  },

  /**
   * Build the ordered array of pipeline steps.
   *
   * Each step is { stepName: string, fn: async () => object }.
   * fn() should return a metrics object (or {}). Throw inside fn() to fail the step.
   *
   * Use `state` to pass data between steps (e.g. a list fetched in step 1 used in step 2).
   * Use `context.execution_mode` if you need to vary behavior by execution context.
   *
   * @param {object} runnerOptions
   * @param {object} domainConfig
   * @param {object} state    — mutable, starts as {}
   * @param {object} context  — { execution_mode }
   * @returns {Array<{ stepName: string, fn: () => Promise<object> }>}
   */
  buildSteps(runnerOptions, domainConfig, state, context) {
    const steps = [];
    const { batchSize = 50 } = domainConfig;

    // Step 1: Fetch source records
    steps.push({
      stepName: 'fetch_source_records',
      fn: async () => {
        if (runnerOptions.dryRun) return { skipped: true, reason: 'dry_run' };

        // Replace with real fetch logic:
        // const records = await mySourceApi.fetchBatch({ limit: batchSize });
        // state.records = records;
        state.records = [];

        return { fetched: state.records.length };
      },
    });

    // Step 2: Transform and store records
    steps.push({
      stepName: 'transform_and_store',
      fn: async () => {
        if (runnerOptions.dryRun) return { skipped: true, reason: 'dry_run' };

        // Replace with real transform + store logic:
        // const results = await myDb.upsertBatch(state.records.map(transform));
        const results = { inserted: 0, updated: 0, failed: 0 };

        return results;
      },
    });

    // Step 3: Post-build quality check (optional gate step)
    steps.push({
      stepName: 'quality_check',
      fn: async () => {
        // Replace with real quality metric computation:
        // const coverage = await myDb.computeCoverage();
        const coverage = 1.0;

        const minCoverage = domainConfig.minCoverage ?? 0.9;
        if (coverage < minCoverage) {
          throw new Error(`Coverage ${coverage} below minimum ${minCoverage}`);
        }

        return { coverage, threshold: minCoverage, passed: true };
      },
    });

    return steps;
  },

  /**
   * Called after each step completes. Use this for post-step assertions.
   * Throw to abort the pipeline. Return a metrics object (or undefined) to record.
   *
   * @param {string} stepName
   * @param {object} runnerOptions
   * @param {object} domainConfig
   * @returns {Promise<object|undefined>}
   */
  async validateStep(stepName, runnerOptions, domainConfig) {
    // Example: after the store step, assert that records actually landed.
    if (stepName === 'transform_and_store' && !runnerOptions.dryRun) {
      // const count = await myDb.countRecords('my_table');
      // if (count === 0) throw new Error('transform_and_store produced no rows');
    }
    // Return undefined to skip validation for this step.
  },

  /**
   * Called in the finally block after the pipeline succeeds or fails.
   * Use for cleanup, notification, or post-run visibility logging.
   * Errors here should be caught and logged, not re-thrown.
   *
   * @param {object} runnerOptions
   * @param {object} domainConfig
   */
  async finalizeRun(runnerOptions, domainConfig) {
    try {
      // Example: log final record counts for observability.
      // const counts = await myDb.getVisibilityCounts();
      // console.log('[pipeline] final counts:', counts);
    } catch (err) {
      console.warn('[pipeline] finalizeRun error (non-fatal):', String(err?.message || err));
    }
  },
};