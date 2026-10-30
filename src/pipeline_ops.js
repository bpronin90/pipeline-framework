/**
 * pipeline_ops.js — Generic pipeline utilities: retry loop, bounded validation, sleep.
 *
 * No persistence dependencies. All persistence operations are injected via a PersistenceAdapter
 * (see run_pipeline.js and docs/adapter-guide.md).
 */

const RETRY_DELAY_MS = 1500;

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate that a value falls within [min, max] (inclusive).
 * Throws a descriptive error if the value is out of bounds or non-finite.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} label  — shown in the error message
 */
export function ensureBounded(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${label}: ${value} (expected ${min}..${max})`);
  }
}

/**
 * Run a single pipeline step with automatic retries and persistence logging.
 *
 * @param {string|number|null} runId   — Opaque run identifier from PersistenceAdapter.createRun().
 *                                       Pass null to skip all persistence calls.
 * @param {object} stepCtx
 * @param {string}   stepCtx.stepName
 * @param {number}   stepCtx.stepIndex   — 1-based position in the step array
 * @param {number}   stepCtx.totalSteps
 * @param {Function} stepCtx.fn          — Async step function, returns a metrics object or void
 * @param {object} options
 * @param {number}   options.maxRetries  — Max retry count (0 = run once, no retries)
 * @param {object|null} persistence      — PersistenceAdapter or null for no-op
 * @returns {Promise<object>}             — The metrics object returned by fn(), or {}
 */
export async function runStepWithRetries(runId, stepCtx, options, persistence = null) {
  const { stepName, stepIndex, totalSteps, fn } = stepCtx;
  let lastErr = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    const startedAt = new Date().toISOString();

    if (persistence && runId) {
      await persistence.updateRun(runId, {
        current_step: stepName,
        step_index: stepIndex,
        total_steps: totalSteps,
      });
    }

    try {
      const result = await fn();
      const completedAt = new Date().toISOString();
      if (persistence && runId) {
        await persistence.logStep(runId, stepName, attempt, 'completed', startedAt, completedAt, result || {}, null);
      }
      return result || {};
    } catch (err) {
      lastErr = err;
      const completedAt = new Date().toISOString();
      if (persistence && runId) {
        await persistence.logStep(
          runId,
          stepName,
          attempt,
          'failed',
          startedAt,
          completedAt,
          {},
          String(err?.message || err)
        );
      }
      if (attempt <= options.maxRetries) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastErr || new Error(`Unknown failure in step ${stepName}`);
}
