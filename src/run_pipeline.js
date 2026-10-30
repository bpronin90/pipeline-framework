/**
 * run_pipeline.js — Generic pipeline runner.
 *
 * Orchestrates the full lifecycle of a pipeline run:
 *   lock → preflight → build steps → execute (with retries) → complete/fail → finalize
 *
 * All domain behavior is delegated to a DomainAdapter.
 * All persistence (run records, step logs) is delegated to an optional PersistenceAdapter.
 *
 * See docs/adapter-guide.md for the full adapter interface contracts.
 */

import { ensureBounded, runStepWithRetries } from './pipeline_ops.js';

const DEFAULT_MAX_RETRIES = 2;

/**
 * Run a pipeline.
 *
 * @param {object} config
 * @param {string}  config.execution_mode — Required. Identifies who triggered this run
 *                                          (e.g. 'cli', 'maintenance', 'job').
 * @param {string}  [config.mode]         — 'full_rebuild' | 'incremental' (default: 'incremental')
 * @param {number}  [config.maxRetries]   — Retry count per step, 0–5 (default: 2)
 * @param {boolean} [config.force]        — Skip run-lock check (default: false)
 * @param {boolean} [config.dryRun]       — Skip side-effectful steps (default: false)
 * @param {boolean} [config.opsEnabled]   — Enable persistence (default: true)
 * @param {object}  [config.domainConfig] — Opaque; passed to all DomainAdapter hooks as-is.
 *
 * @param {object} domainAdapter
 * @param {Function} domainAdapter.preflight    — async (runnerOptions, domainConfig) => void
 * @param {Function} domainAdapter.buildSteps   — (runnerOptions, domainConfig, state, context) => Step[]
 * @param {Function} domainAdapter.validateStep — async (stepName, runnerOptions, domainConfig) => object|void
 * @param {Function} domainAdapter.finalizeRun  — async (runnerOptions, domainConfig) => void
 *
 * @param {object|null} [persistenceAdapter]
 * @param {Function} persistenceAdapter.createRunLock — async (runnerOptions) => void
 * @param {Function} persistenceAdapter.createRun     — async (params) => runId|null
 * @param {Function} persistenceAdapter.updateRun     — async (runId, patch) => void
 * @param {Function} persistenceAdapter.logStep       — async (runId, stepName, attempt, status,
 *                                                            startedAt, completedAt, metrics, errorMessage) => void
 *
 * @returns {Promise<{ run_id: *, status: string, metrics: object }>}
 */
export async function runPipeline(config = {}, domainAdapter, persistenceAdapter = null) {
  if (!domainAdapter) throw new Error('domainAdapter is required');
  if (config.execution_mode == null) throw new Error('execution_mode is required');

  const runnerOptions = normalizeRunnerOptions(config);
  const domainConfig = config.domainConfig ?? {};
  const persistence = runnerOptions.opsEnabled ? (persistenceAdapter ?? null) : null;

  // Acquire run lock (prevents concurrent runs).
  if (persistence) {
    await persistence.createRunLock(runnerOptions);
  }

  // Domain-specific pre-run checks (e.g. require tables empty for full_rebuild).
  await domainAdapter.preflight(runnerOptions, domainConfig);

  const state = {};
  const context = { execution_mode: runnerOptions.executionMode };
  const steps = domainAdapter.buildSteps(runnerOptions, domainConfig, state, context);

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('domainAdapter.buildSteps() must return a non-empty array of steps');
  }

  const runId = persistence
    ? await persistence.createRun({
        execution_mode: runnerOptions.executionMode,
        mode: runnerOptions.mode,
        total_steps: steps.length,
        domainConfig,
      })
    : null;

  const metrics = {};

  try {
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const result = await runStepWithRetries(
        runId,
        { stepName: step.stepName, stepIndex: i + 1, totalSteps: steps.length, fn: step.fn },
        runnerOptions,
        persistence
      );
      metrics[step.stepName] = result;

      // Post-step validation hook. Failures abort the pipeline.
      try {
        const validation = await domainAdapter.validateStep(step.stepName, runnerOptions, domainConfig);
        metrics[`${step.stepName}__validation`] = validation ?? {};
      } catch (validationError) {
        metrics[`${step.stepName}__validation`] = {
          status: 'failed',
          error: String(validationError?.message || validationError),
        };
        throw validationError;
      }
    }

    if (persistence && runId) {
      await persistence.updateRun(runId, {
        status: 'completed',
        current_step: null,
        step_index: steps.length,
        completed_at: new Date().toISOString(),
        metrics,
      });
    }

    return { run_id: runId, status: 'completed', metrics };
  } catch (err) {
    if (persistence && runId) {
      await persistence.updateRun(runId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: String(err?.message || err),
        metrics,
      });
    }
    throw err;
  } finally {
    await domainAdapter.finalizeRun(runnerOptions, domainConfig);
  }
}

function normalizeRunMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'full_rebuild' || raw === 'full') return 'full_rebuild';
  return 'incremental';
}

function normalizeRunnerOptions(config) {
  const maxRetries = Number(config.maxRetries ?? DEFAULT_MAX_RETRIES);
  ensureBounded(maxRetries, 0, 5, 'maxRetries');
  return {
    mode: normalizeRunMode(config.mode || 'incremental'),
    executionMode: config.execution_mode,
    maxRetries,
    force: Boolean(config.force || false),
    dryRun: Boolean(config.dryRun || false),
    opsEnabled: config.opsEnabled !== false,
  };
}
