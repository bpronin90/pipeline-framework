/**
 * smoke_test.js — Framework-level smoke test.
 *
 * Runs a minimal in-memory pipeline with a mock domain adapter and no persistence.
 * Verifies: exports, step execution, retry behavior, preflight abort, step validation abort.
 */

import { runPipeline, sleep, ensureBounded } from '../src/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function makeDomainAdapter(overrides = {}) {
  return {
    async preflight() {},
    buildSteps(runnerOptions, domainConfig, state, context) {
      return [
        {
          stepName: 'step_one',
          fn: async () => {
            state.stepOneDone = true;
            return { rows: 42 };
          },
        },
        {
          stepName: 'step_two',
          fn: async () => ({ rows: 10 }),
        },
      ];
    },
    async validateStep() {},
    async finalizeRun() {},
    ...overrides,
  };
}

// ── Test 1: Happy path ──────────────────────────────────────────────────────
console.log('\nTest 1: Happy path');
{
  const state = {};
  const adapter = makeDomainAdapter({
    buildSteps(runnerOptions, domainConfig, s, context) {
      return [
        { stepName: 'step_one', fn: async () => { s.touched = true; return { rows: 5 }; } },
        { stepName: 'step_two', fn: async () => ({ rows: 3 }) },
      ];
    },
  });
  const result = await runPipeline(
    { execution_mode: 'test', maxRetries: 0, opsEnabled: false },
    adapter,
    null
  );
  assert(result.status === 'completed', 'status is completed');
  assert(result.run_id === null, 'run_id is null without persistence');
  assert(result.metrics.step_one.rows === 5, 'step_one metrics recorded');
  assert(result.metrics.step_two.rows === 3, 'step_two metrics recorded');
}

// ── Test 2: Preflight abort ─────────────────────────────────────────────────
console.log('\nTest 2: Preflight abort');
{
  const adapter = makeDomainAdapter({
    async preflight() { throw new Error('preflight_failed'); },
  });
  let threw = false;
  try {
    await runPipeline({ execution_mode: 'test', maxRetries: 0, opsEnabled: false }, adapter, null);
  } catch (err) {
    threw = true;
    assert(err.message === 'preflight_failed', 'preflight error propagated');
  }
  assert(threw, 'preflight abort throws');
}

// ── Test 3: Step failure with retries ───────────────────────────────────────
console.log('\nTest 3: Step failure + retry exhaust');
{
  let attempts = 0;
  const adapter = makeDomainAdapter({
    buildSteps() {
      return [
        {
          stepName: 'flaky_step',
          fn: async () => {
            attempts++;
            throw new Error('step_error');
          },
        },
      ];
    },
  });
  let threw = false;
  try {
    await runPipeline({ execution_mode: 'test', maxRetries: 1, opsEnabled: false }, adapter, null);
  } catch (err) {
    threw = true;
    assert(err.message === 'step_error', 'step error propagated');
  }
  assert(threw, 'step failure throws after retries exhausted');
  assert(attempts === 2, `step attempted ${attempts} times (maxRetries=1 → 2 total attempts)`);
}

// ── Test 4: Validation abort ────────────────────────────────────────────────
console.log('\nTest 4: validateStep abort');
{
  const adapter = makeDomainAdapter({
    async validateStep(stepName) {
      if (stepName === 'step_one') throw new Error('validation_failed');
    },
  });
  let threw = false;
  try {
    await runPipeline({ execution_mode: 'test', maxRetries: 0, opsEnabled: false }, adapter, null);
  } catch (err) {
    threw = true;
    assert(err.message === 'validation_failed', 'validation error propagated');
  }
  assert(threw, 'validation abort throws');
}

// ── Test 5: Missing execution_mode ──────────────────────────────────────────
console.log('\nTest 5: Missing execution_mode');
{
  let threw = false;
  try {
    await runPipeline({ maxRetries: 0 }, makeDomainAdapter(), null);
  } catch (err) {
    threw = true;
    assert(err.message.includes('execution_mode'), 'error mentions execution_mode');
  }
  assert(threw, 'missing execution_mode throws');
}

// ── Test 6: Utility functions ───────────────────────────────────────────────
console.log('\nTest 6: Utility functions');
{
  const t0 = Date.now();
  await sleep(10);
  assert(Date.now() - t0 >= 10, 'sleep(10) waits at least 10ms');

  let boundErr = null;
  try { ensureBounded(999, 0, 100, 'myVal'); } catch (e) { boundErr = e; }
  assert(boundErr !== null, 'ensureBounded throws on out-of-range');
  assert(boundErr.message.includes('myVal'), 'ensureBounded error mentions label');

  ensureBounded(50, 0, 100, 'ok'); // should not throw
  assert(true, 'ensureBounded passes for in-range value');
}

// ── Test 7: dryRun passed to domain ─────────────────────────────────────────
console.log('\nTest 7: dryRun flag passed through');
{
  let seenDryRun = null;
  const adapter = makeDomainAdapter({
    buildSteps(runnerOptions) {
      seenDryRun = runnerOptions.dryRun;
      return [{ stepName: 'noop', fn: async () => ({}) }];
    },
  });
  await runPipeline({ execution_mode: 'test', maxRetries: 0, dryRun: true, opsEnabled: false }, adapter, null);
  assert(seenDryRun === true, 'dryRun: true passed to buildSteps');
}

// ── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
