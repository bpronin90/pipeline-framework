# Contributing

Thanks for contributing to `bpronin90/pipeline-framework`. This guide covers the contributor-facing process:
how work is tracked, how changes are scoped and reviewed, and what must be verified
before a change lands.

## Issue And PR Workflow

| Work | Contract | Branch |
| --- | --- | --- |
| Substantive change: behavior, interfaces, data, security, CI, dependencies | GitHub issue with **Goal, Allowed Files, Acceptance Criteria, Verification** | `issue/<n>-<scope>` |
| Doc correction or small maintenance with no behavior change | PR body with `Issue: none` and the same four headings (one line each is fine) | `chore/<scope>` or `docs/<scope>` |

If you are unsure whether work is substantive, treat it as substantive.

- Branch off `main` and open the pull request against `main`. Never commit or
  push to `main` directly, and never force-push a shared branch.
- One issue has one PR. Every non-Dependabot PR body contains exactly one standalone
  line `Issue: #<n>` or `Issue: none`.
- Change only the issue's Allowed Files, plus docs your change makes untrue. If necessary
  work falls outside them, ask for a scope amendment first.
- No adjacent refactors, cleanup, renames, dependency upgrades, or redesigns. Never
  silently change requirements; raise the conflict in the issue instead.
- Stage explicit paths only (no `git add -A`, `git add .`, or `git commit -a`), and keep
  commits focused.
- In the PR, summarize what changed, why, and exactly how it was verified.

## Testing And Verification

- `npm test` (smoke tests) and `npm run check` (export check). No dependencies to install.
- Pull requests run `.github/workflows/ci.yml`; report local and CI results at the exact head.
- Test failure modes, not only happy paths.
- Report exactly which checks ran and which did not. If you cannot run a check that
  would normally apply, say so in the PR and explain why. Never describe unexecuted
  integration, deployment, or live/native validation as proven.

## Review And Merge

- Substantive changes need an independent review of the exact PR head before merge;
  the author of a head cannot approve it. For issue-free doc or maintenance PRs, review
  is at the owner's discretion.
- Review findings cite `file:line` and a concrete failing input or state, and separate
  blocking defects from optional suggestions. A new commit makes earlier reviews stale.
- An agent may merge a PR only when CI passes on the exact head; for substantive changes,
  an independent reviewer who is not the head's author has posted `VERDICT=APPROVED` on
  that exact head with no unresolved blocking findings; and the PR does not deploy,
  release, migrate data, touch credentials, secrets, or repository settings, or cause
  external side effects. Green CI alone is not permission to merge.
- Only the owner merges Dependabot PRs, merges with `--admin`, or closes issues other
  than through a merged PR's `Closes #n`.
- Only the owner authorizes deploys and releases; production data, migrations, and
  schedules; credentials, secrets, and access; repository settings and branch
  protection; new paid services; and external side effects. Ambiguous
  approval such as "looks good" is not authorization.

## Project Rules

- **Public interface:** the exports of `src/index.js`, `runPipeline` options, the
  DomainAdapter hooks (`preflight`, `buildSteps`, `validateStep`, `finalizeRun`), and
  the PersistenceAdapter methods (`createRunLock`, `createRun`, `updateRun`, `logStep`).
  Changing any of them is substantive: the issue states the compatibility impact, the PR
  updates `docs/adapter-guide.md`, and review checks compatibility explicitly.
- **Runner semantics are contracts:** run locking; preflight before any step; bounded
  retries (`maxRetries`, linear backoff); every attempt logged, including failures;
  post-step validation that can abort; `dryRun` passed through; `finalizeRun` attempted
  in `finally` once execution starts. Changes need tests for the failure path.
- **Generic only.** No application-specific logic in `src/` or `examples/`; application
  behavior belongs in adapters in the consuming repository.
- No runtime dependencies without an issue that justifies them.

## Public source and private configuration

The tracked `AGENTS.md`, `CLAUDE.md`, guard hook, and this guide are the complete
contributor baseline for a fresh checkout. Private agent overrides are optional;
contributors do not need the maintainer's environment or operating protocols.
Keep personal settings, service identifiers, infrastructure relationships, real
data, and full private protocols in ignored local files or a separate private
backup. Review staged content: ignore rules do not remove sensitive text inside
tracked files or earlier commits.

Use a GitHub noreply email for commits intended for publication. Keep review and
handoff examples free of personal paths and instance identifiers.

For a solo maintainer, branch protection should require PRs and passing CI with
zero required GitHub approving reviews; an author cannot approve their own PR.
This does not waive the independent agent-review and exact-head handoff rules
above. The owner may review and merge their own PR after the applicable checks;
agents must still follow the agent merge conditions. Repository protection and
visibility changes require separate owner approval.
