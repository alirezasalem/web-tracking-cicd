# `.github/workflows/` — The Orchestration Layer

Every workflow in this folder is a small, focused unit of the pipeline. Together they form the **complete automation chain** from a PM's feature brief all the way to a ready to import GTM container json — with quality gates at every step.

This document explains what each workflow does, when it fires, what secrets it needs, what files it writes, and the design decisions behind it.

---

## Table of contents

- [The five categories](#the-five-categories)
- [The full automation chain](#the-full-automation-chain)
- [Workflow reference](#workflow-reference)
  - [Generate Spec from Brief](#1-generate-spec-from-brief--generate-specyml)
  - [Spec Lint](#2-spec-lint--spec-lintyml)
  - [Schema Drift Detection](#3-schema-drift-detection--schema-driftyml)
  - [Update Schema Baseline](#4-update-schema-baseline--update-baselineyml)
  - [Index Specs for RAG](#5-index-specs-for-rag--index-specsyml)
  - [Generate Tracking Concept for Devs](#6-generate-tracking-concept-for-devs--generate-tracking-conceptyml)
  - [Generate Playwright dataLayer Test](#7-generate-playwright-datalayer-test--generate-testsyml)
  - [Generate GTM Config](#8-generate-gtm-config--generate-gtmyml)
  - [Bot Path Guard](#9-bot-path-guard--bot-path-guardyml)
  - [Validate dataLayer](#10-validate-datalayer--validate-datalayeryml)
  - [Deploy to Staging](#11-deploy-to-staging--deploy-stagingyml-placeholder)
- [Secrets matrix](#secrets-matrix)
- [Trigger matrix](#trigger-matrix)
- [Design decisions](#design-decisions)

---

## The five categories

The 11 workflows fall into five conceptual groups:

| Category | Workflows | Purpose |
|---|---|---|
| **Generators** | `generate-spec`, `generate-tracking-concept`, `generate-tests`, `generate-gtm` | AI agents that turn input (brief/spec) into output (spec/docs/tests/config) |
| **Gates** | `spec-lint`, `schema-drift` | Required status checks that block PRs with bad specs |
| **Governance** | `bot-path-guard`, `update-baseline` | Enforce that bot writes stay in scope; control schema baseline promotion |
| **Memory** | `index-specs` | Maintain the RAG vector index so future generations stay consistent |
| **Validation** | `validate-datalayer` | Run generated Playwright tests against a live URL |
| **Deploy** *(placeholder)* | `deploy-staging` | Future hook for sGTM deployment |

---

## The full automation chain

```
                    ┌─────────────────────────────────────┐
                    │  PM commits feature-briefs/FB-NNN.md│
                    │  (via GitHub web UI — no Git needed)│
                    └──────────────────┬──────────────────┘
                                       │ PR opened
                                       │
              ┌────────────────────────┴──────────────────────────┐
              │  Spec Lint + Schema Drift  (smart-skip — no spec  │
              │  yet, so they report ✓ and let the PR through)    │
              └────────────────────────┬──────────────────────────┘
                                       │ analyst merges brief PR
                                       ▼
              ┌─────────────────────────────────────────────────┐
              │  Generate Spec from Brief                       │
              │  • Reads brief, queries RAG, calls Claude       │
              │  • Opens auto-spec PR with YAML spec            │
              └────────────────────────┬────────────────────────┘
                                       │
              ┌────────────────────────┴────────────────────────┐
              │  Spec Lint + Schema Drift on the auto-spec PR   │
              │  (now they actually validate the new spec)      │
              └────────────────────────┬────────────────────────┘
                                       │ analyst reviews + merges spec PR
                                       ▼
        ┌──────────────────────────────┴──────────────────────────────┐
        │                                                             │
        ▼                                                              ▼
  ┌────────────────┐                                            ┌──────────────┐
  │ Bot Path Guard │                                            │ Update       │
  │ (on every push)│                                            │ Schema       │
  └────────────────┘                                            │ Baseline     │
                                                                 └──────┬───────┘
                                                                        │ workflow_run
                                                                        ▼
                                                          ┌──────────────────────────┐
                                                          │ Generate Tracking        │
                                                          │ Concept for Devs         │
                                                          │ → tracking-concepts/     │
                                                          └────────────┬─────────────┘
                                                                       │ workflow_run
                                                                       ▼
                                                          ┌──────────────────────────┐
                                                          │ Generate Playwright      │
                                                          │ dataLayer Test           │
                                                          │ → playwright-datalayer-  │
                                                          │   tests/                 │
                                                          └────────────┬─────────────┘
                                                                       │ workflow_run
                                                                       ▼
                                                          ┌──────────────────────────┐
                                                          │ Generate GTM Config      │
                                                          │ → gtm-assets/            │
                                                          └──────────────────────────┘

  And in parallel, triggered by the spec merge:
  ┌────────────────────────────────────────────────────┐
  │ Index Specs for RAG → data/spec-index.json updated │
  └────────────────────────────────────────────────────┘
```

Every arrow is a real GitHub Actions trigger. Every box produces a committed artifact.

---

## Workflow reference

### 1. Generate Spec from Brief — `generate-spec.yml`

**Purpose** — The entry point of the pipeline. Takes a PM-written feature brief and produces a structured YAML spec via Claude (with RAG-injected context from past specs).

**Triggers**
- `push` to `main` when any `feature-briefs/FB-*.md` file changes
- Manual `workflow_dispatch` with a `brief_file` input

**What it does**
1. Determines which brief file changed (`HEAD~1..HEAD` diff)
2. Calls `agents/spec-generator/run.js`, which:
   - Reads the brief
   - Queries `data/spec-index.json` via Voyage AI for the 3 most similar past specs
   - Calls Claude with the brief + retrieved specs as context
   - Returns YAML to stdout
3. Renames the temp file to `specs/SPEC-{YEAR}-{NNN}-{event_name}.yaml`
4. Patches `spec_id` to match the filename
5. Opens a PR on branch `auto-spec/<brief_filename>` using `peter-evans/create-pull-request@v6`
6. Runs `agents/schema-guardian/diff.js` against the new spec and comments the result on the PR

**Required secrets**
- `ANTHROPIC_API_KEY` — powers the Claude call
- `VOYAGE_API_KEY` — powers the RAG retrieval step (graceful skip if missing)
- `WORKFLOW_PAT` — used by `peter-evans/create-pull-request` because `GITHUB_TOKEN`-created PRs cannot trigger downstream workflows (anti-recursion safeguard)

**Writes to**
- A new branch `auto-spec/<brief_filename>`
- A PR commenting the drift report

**Key gotcha** — The PAT must be in the ruleset bypass list so it can push the new branch when branch protection is on.

---

### 2. Spec Lint — `spec-lint.yml`

**Purpose** — Required status check. Validates every spec in `specs/` against `conventions.yaml`.

**Triggers** — `pull_request` (every PR)

**What it does**
1. Runs a smart-skip check: looks at the diff for changes under `specs/`, `conventions/conventions.yaml`, or the linter script itself
2. If no relevant changes: reports ✅ immediately and exits (this is the *path-filter deadlock fix* — see Design Decisions)
3. If relevant changes detected: runs `scripts/linter/spec-linter.js` against every `.yaml` in `specs/`
4. Any single spec failure → workflow fails → PR cannot merge

**Required secrets** — None

**Writes to** — Nothing (read-only check)

**Listed in branch protection as** — `Validate tracking specs`

---

### 3. Schema Drift Detection — `schema-drift.yml`

**Purpose** — Required status check. Compares the current spec set against `schema-baseline.json` to detect breaking changes (removed events, renamed parameters, type changes).

**Triggers** — `pull_request` targeting `main`

**What it does**
1. Smart-skips if no `specs/` files changed in the PR
2. Runs `agents/schema-guardian/diff.js` which:
   - Loads `schema-baseline.json`
   - Snapshots the current `specs/` directory
   - Recursively flattens both to dot-notation keys (so `ecommerce.items` vs `ecommerce.products` is caught)
   - Reports added, removed, and modified paths
3. Posts the drift report as a sticky PR comment (updates the existing comment if re-run)
4. Fails the workflow if breaking changes are detected — PR is blocked until either the spec is fixed or `Update Schema Baseline` is run

**Required secrets** — `GITHUB_TOKEN` (built-in, for PR commenting)

**Writes to** — A PR comment

**Listed in branch protection as** — `Schema Drift Check`

---

### 4. Update Schema Baseline — `update-baseline.yml`

**Purpose** — The escape hatch for intentional breaking changes. Promotes the current `specs/` state to be the new baseline that Schema Drift compares against.

**Triggers**
- `push` to `main` when `specs/**` changes (auto-promotes on every spec merge)
- Manual `workflow_dispatch` with a required `reason` input (for audit trail)

**What it does**
1. Mints a GitHub App token via `actions/create-github-app-token@v1`
2. Runs `agents/schema-guardian/snapshot.js` to regenerate `schema-baseline.json`
3. Commits the new baseline directly to main with a message including the approver and reason

**Required secrets**
- `BOT_APP_ID` — the GitHub App's identifier
- `BOT_PRIVATE_KEY` — the App's private key (multiline PEM)

**Writes to** — `schema-baseline.json` on main

**Key gotcha** — After force-resetting `main`, you must manually run this workflow via `workflow_dispatch` before creating any new test briefs. Otherwise the drift check will report `[SPEC_REMOVED]` for every spec that's no longer in the stale baseline.

---

### 5. Index Specs for RAG — `index-specs.yml`

**Purpose** — Keeps `data/spec-index.json` in sync with `specs/`. Every merged spec gets embedded by Voyage AI and added to the vector store, so the next spec generation can reference it.

**Triggers**
- `push` to `main` when `specs/SPEC-*.yaml` changes
- Manual `workflow_dispatch` with optional `--force` to re-embed everything

**What it does**
1. Skips if the commit was made by `github-actions[bot]` (avoids triggering itself when the bot commits other artifacts)
2. Runs `agents/spec-generator/rag/index.js`, which:
   - Hashes each spec
   - Skips re-embedding unchanged specs
   - Calls Voyage AI to embed only new or modified specs (or all, if `--force`)
   - Merges into existing index
3. Commits the updated index back to main if it changed

**Required secrets**
- `VOYAGE_API_KEY` — for embedding calls
- `WORKFLOW_PAT` — used as the `actions/checkout` token so the push back to main works

**Writes to** — `data/spec-index.json` on main

**Cost note** — Voyage's `voyage-3-lite` is cheap (~$0.02 per 1M tokens). Even a busy repo with 100 specs costs cents per month.

---

### 6. Generate Tracking Concept for Devs — `generate-tracking-concept.yml`

**Purpose** — Produces engineer-facing Markdown documentation for every spec. Sits in `tracking-concepts/` — these are the docs an engineer reads when implementing tracking on the frontend.

**Triggers**
- `workflow_run` after `Update Schema Baseline` completes (chains off the spec merge)
- Manual `workflow_dispatch` with a `spec_file` input

**What it does**
1. Mints a GitHub App token
2. Resolves which spec to process (from `workflow_dispatch` input, or by detecting the most recent added spec)
3. Calls `agents/tracking-concept-generator/run.js --spec <file>`, which sends the spec to Claude with a docs-oriented prompt
4. Commits the result to `tracking-concepts/<event_name>.md` on main (force-push with lease)

**Required secrets**
- `ANTHROPIC_API_KEY`
- `BOT_APP_ID` + `BOT_PRIVATE_KEY`

**Writes to** — `tracking-concepts/<event_name>.md`

---

### 7. Generate Playwright dataLayer Test — `generate-tests.yml`

**Purpose** — Generates a `.spec.js` Playwright test for every spec. The test asserts that the dataLayer event matches the spec when the trigger condition is met.

**Triggers**
- `workflow_run` after `Generate Tracking Concept for Devs` completes
- Manual `workflow_dispatch` with optional `spec_file`

**What it does**
1. Mints a GitHub App token
2. Resolves spec file (newest added, or from manual input)
3. Calls `agents/test-generator/run.js <spec>` which generates the Playwright test
4. Commits to `playwright-datalayer-tests/<event_name>.spec.js`

**Required secrets**
- `ANTHROPIC_API_KEY`
- `BOT_APP_ID` + `BOT_PRIVATE_KEY`

**Writes to** — `playwright-datalayer-tests/<event_name>.spec.js`

**Current limitation** — The generator handles page-load events well but produces stubs for interaction events (clicks, form submits). Interaction-event support is on the roadmap.

---

### 8. Generate GTM Config — `generate-gtm.yml`

**Purpose** — Generates a GTM client-side container export (JSON) ready to import into Google Tag Manager.

**Triggers**
- `workflow_run` after `Generate Playwright dataLayer Test` completes
- Manual `workflow_dispatch` with optional `spec_file`

**What it does**
1. Mints a GitHub App token
2. Resolves spec file
3. Calls `agents/gtm-generator/run.js <spec>` which produces tags, triggers, and variables in GTM's container-export JSON format
4. Commits to `gtm-assets/<event_name>-gtm-export.json`

**Required secrets**
- `BOT_APP_ID` + `BOT_PRIVATE_KEY`

**Writes to** — `gtm-assets/<event_name>-gtm-export.json`

**Note** — This is **client-side** GTM only. Server-side container support is on the roadmap.

---

### 9. Bot Path Guard — `bot-path-guard.yml`

**Purpose** — Defense in depth. If the bot ever writes to a path outside its allowlist, this workflow fails loudly so you notice immediately.

**Triggers** — `push` to `main` (every push)

**What it does**
1. Inspects the commit's author name and email
2. If the author is the bot (`web-tracking-cicd-bot`), runs the path check
3. If the author is a human, exits silently (humans are gated by PR review)
4. For bot commits, validates every changed file matches one of:
   - `tracking-concepts/`
   - `playwright-datalayer-tests/`
   - `gtm-assets/`
   - `schema-baseline.json`
5. Any path outside the allowlist → workflow fails + GitHub Issue-style summary on the run

**Required secrets** — None

**Writes to** — Nothing (read-only check)

**Why this exists** — See the "detection-not-prevention" architectural decision below.

---

### 10. Validate dataLayer — `validate-datalayer.yml`

**Purpose** — Runs the Playwright tests in `playwright-datalayer-tests/` against a live URL (staging or preview). Used for actual tracking validation, not synthetic CI.

**Triggers**
- `workflow_dispatch` — manual, with inputs:
  - `test_url` (required) — the live URL to test against
  - `event_name` (optional) — to run only one event's tests
  - `test_username` / `test_password` (optional) — for basic-auth-protected URLs
- *Also designed for `pull_request` mode* — when triggered by a PR, it parses `TEST_URL:`, `TEST_USERNAME:`, `TEST_PASSWORD:` from the PR body

**What it does**
1. Extracts inputs (from `workflow_dispatch` or PR body)
2. Resolves the test target (single spec file or all tests)
3. Installs Playwright + Chromium
4. Runs `npx playwright test <target>`
5. Uploads the HTML report as an artifact on failure (7-day retention)
6. Posts a Job Summary with pass/fail status

**Required secrets** — None

**Writes to** — Job summary + uploaded artifacts on failure

**Current scope** — This is the "regression" workflow, designed to be run manually before promoting to production. The roadmap includes a scheduled-run mode for "Live Truth" monitoring.

---

### 11. Deploy to Staging — `deploy-staging.yml` *(placeholder)*

**Purpose** — Future hook for automated GTM container deployment.

**Triggers** — `workflow_run` after `Generate GTM Config` completes

**What it does** — Currently echoes a placeholder message. Reserved for future Cloud Run + sGTM deployment work (see Live Truth monitoring on the roadmap).

**Status** — Intentional placeholder. Not in active use.

---

## Secrets matrix

Which secrets each workflow needs. Set these under **Settings → Secrets and variables → Actions**.

| Workflow | `ANTHROPIC_API_KEY` | `VOYAGE_API_KEY` | `WORKFLOW_PAT` | `BOT_APP_ID` | `BOT_PRIVATE_KEY` |
|---|---|---|---|---|---|
| Generate Spec from Brief | ✓ | ✓ | ✓ | | |
| Spec Lint | | | | | |
| Schema Drift Detection | | | | | |
| Update Schema Baseline | | | | ✓ | ✓ |
| Index Specs for RAG | | ✓ | ✓ | | |
| Generate Tracking Concept | ✓ | | | ✓ | ✓ |
| Generate Playwright Test | ✓ | | | ✓ | ✓ |
| Generate GTM Config | | | | ✓ | ✓ |
| Bot Path Guard | | | | | |
| Validate dataLayer | | | | | |

**The two governance models:**

- **`WORKFLOW_PAT`** (Personal Access Token) — used by workflows that need to create PRs or trigger downstream workflow runs. Lives on a human's account.
- **GitHub App** (`BOT_APP_ID` + `BOT_PRIVATE_KEY`) — used by the four artifact generator workflows that commit directly to main. The App acts as an explicit "bot" identity that the path guard can detect.

Both models bypass the `protect-main` ruleset (via bypass list). This is documented in the root README's setup section.

---

## Trigger matrix

A quick reference for *when* each workflow fires.

| Workflow | Trigger | Frequency |
|---|---|---|
| Generate Spec from Brief | Push to main: `feature-briefs/FB-*.md` | On every brief merge |
| Spec Lint | Every PR | On every PR (smart-skip for irrelevant) |
| Schema Drift Detection | Every PR to main | On every PR to main (smart-skip for irrelevant) |
| Update Schema Baseline | Push to main: `specs/**` + manual | On every spec merge + manual |
| Index Specs for RAG | Push to main: `specs/SPEC-*.yaml` + manual | On every spec merge + manual |
| Generate Tracking Concept | After Update Schema Baseline | Chained |
| Generate Playwright Test | After Generate Tracking Concept | Chained |
| Generate GTM Config | After Generate Playwright Test | Chained |
| Bot Path Guard | Every push to main | Every push (silent for humans) |
| Validate dataLayer | Manual (or PR with `TEST_URL:` in body) | On demand |
| Deploy to Staging | After Generate GTM Config (placeholder) | Chained (no-op) |

---

## Design decisions

A handful of non-obvious choices that shaped this folder, in case you're building something similar.

### Path-filter deadlock fix → smart-skip everywhere

A required status check with `paths:` filters creates a deadlock: the check **never reports status** on PRs that don't touch matching files. GitHub branch protection then blocks the PR forever waiting for a check that will never run.

**Solution:** every required check (Spec Lint, Schema Drift) runs on *every* PR but uses a runtime "Detect relevant changes" step that short-circuits to success when the diff doesn't include relevant files. The check name still reports to GitHub, so branch protection sees a green status. PR merges. Sanity preserved.

### `GITHUB_TOKEN` anti-recursion → use `WORKFLOW_PAT`

GitHub deliberately prevents `GITHUB_TOKEN`-created commits or PRs from triggering further workflows (to stop infinite loops). But our pipeline *needs* that chain: brief merge → spec generation → spec PR → spec merge → artifact generation.

**Solution:** any workflow that creates a PR or push that needs to trigger downstream workflows uses `WORKFLOW_PAT` (a fine-grained Personal Access Token) instead of `GITHUB_TOKEN`. The PAT is in the ruleset bypass list so it can push under branch protection.

### Two governance models — PAT for chains, App for direct-to-main

The four artifact generators (concept, tests, GTM, baseline update) commit directly to main without opening PRs. We use a **GitHub App identity** for these so they show up as `web-tracking-cicd-bot` in commit history.

This matters because the **Bot Path Guard** can then specifically detect "the bot wrote something" and verify it stayed in scope. If we used `WORKFLOW_PAT` everywhere, all bot commits would be authored by the PAT owner (a human), and the path guard couldn't distinguish bot writes from human writes.

### Detection-not-prevention for bot writes

We deliberately gave the GitHub App **broad write access** to main and rely on the path guard to catch violations after the fact, rather than trying to scope its permissions tightly upfront.

Why? GitHub Apps don't have native per-path write restrictions. Implementing one at the permission layer would mean a complex CODEOWNERS + branch-restriction setup that becomes unmaintainable. The path guard runs after every push, takes 10 seconds, and produces a clear audit trail.

If the bot ever misbehaves, you'll see a red ❌ on the commit immediately. Easier to debug, easier to evolve. The decision is documented in the root README's architectural-decisions section.

### Chained `workflow_run` triggers for artifact generators

The artifact pipeline is **strictly sequential** — Update Schema Baseline → Tracking Concept → Tests → GTM. We chose `workflow_run` triggers (each fires when the previous completes) instead of a single monolithic workflow because:

- **Failure isolation** — if test generation breaks, GTM generation doesn't get blamed
- **Observability** — each step is its own job in the Actions UI
- **Retriability** — you can re-run any single step via `workflow_dispatch` without redoing the others
- **Parallelism, when it matters** — Index Specs for RAG runs in parallel (it doesn't `workflow_run`-chain) because it doesn't depend on artifact generation finishing

The downside is more files. The upside is much simpler debugging.

### `[skip ci]` on bot commits

Every bot commit's message ends with `[skip ci]`. This prevents the bot's own commits from re-triggering workflows that watch the same paths — which would otherwise create infinite loops (artifact gen → commit → re-trigger artifact gen → commit → ...).

Combined with `if: github.actor != 'github-actions[bot]'` guards in each generator, this gives us belt-and-braces loop protection.

---

For the agents themselves (`spec-generator`, `tracking-concept-generator`, `test-generator`, `gtm-generator`, `schema-guardian`), see [`agents/README.md`](../../agents/README.md).
