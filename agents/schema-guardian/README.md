# `agents/schema-guardian/` — Schema Drift Detection

Two deterministic scripts that protect the analytics data schema from accidental breakage. **No AI involved** — pure JavaScript that compares spec snapshots and reports the difference.

This is the **governance layer** of the pipeline. Every other agent produces something new; these two scripts make sure those new things don't quietly break what already exists. They are the JD's stated *"Anti-Corruption release gates"* — implemented in 200 lines of Node.

---

## Table of contents

- [What it does](#what-it-does)
- [Why no AI](#why-no-ai)
- [The two scripts and their roles](#the-two-scripts-and-their-roles)
- [Inputs and outputs](#inputs-and-outputs)
- [Classification: BREAKING vs ADDITIVE](#classification-breaking-vs-additive)
- [The flatten-keys trick](#the-flatten-keys-trick)
- [The baseline file](#the-baseline-file)
- [File-by-file walkthrough](#file-by-file-walkthrough)
- [How a PR gets blocked or passed](#how-a-pr-gets-blocked-or-passed)
- [Configuration](#configuration)
- [Local development](#local-development)
- [The bootstrap edge case](#the-bootstrap-edge-case)
- [Known issues](#known-issues)

---

## What it does

Imagine your team has 50 specs in `specs/`, each defining events tracked across web and app. Downstream of those specs, real GTM containers, dashboards, and BigQuery views depend on the parameter names being stable.

Now an analyst opens a PR that renames `product_id` to `productId` in one spec. Without protection, the rename silently merges. Dashboards break weeks later when someone notices `product_id` is null. The blame meeting happens.

The schema-guardian catches this **at PR time**:

```
## 🛡️ Schema Drift Report

Baseline snapshot taken: `2026-06-04T18:45:18.086Z`

### ❌ Breaking Changes (1)

> These changes remove or rename existing parameters.
> This PR is blocked until changes are reverted or the baseline is intentionally updated.

- **[PARAMETER_REMOVED]** Parameter `product_id` removed from `SPEC-2026-002-add_to_cart → add_to_cart`

### ⚠️ Additive Changes (1) — non-blocking

- **[PARAMETER_ADDED]** Parameter `productId` added to `SPEC-2026-002-add_to_cart → add_to_cart`

🚫 **Result: BLOCKED** — 1 breaking change(s) detected.
```

The PR is blocked. The analyst either reverts the rename, or intentionally promotes the new schema by running the `Update Schema Baseline` workflow (which requires an explicit reason for audit).

That's the entire system. Two scripts, a baseline file, a workflow gate.

---

## Why no AI

The same reasoning as `gtm-generator`:

**1. The transformation is fully deterministic.** Given two spec sets, the diff between them is mathematically defined. There's nothing to interpret.

**2. Stochasticity is a liability here.** A drift detector that "usually" catches breaks is worse than one that always catches them. Reliability is the whole product.

**3. Schema changes are high-stakes.** A false negative means a real schema break ships to production. A false positive means a legitimate change gets blocked. Both are expensive. Deterministic logic gives exact, reproducible behavior every time.

This is governance code. It should read like governance code: explicit, traceable, auditable. Set logic and tree traversal, not LLM calls.

---

## The two scripts and their roles

```
schema-guardian/
├── snapshot.js     ← The promoter — writes a new baseline
└── diff.js         ← The detector — compares current vs baseline
```

| Script | Run by | Purpose | Output |
|---|---|---|---|
| `snapshot.js` | `update-baseline.yml` (auto on spec merge, or manually with reason) | Capture the current state of all specs into `schema-baseline.json` | Updated `schema-baseline.json` |
| `diff.js` | `schema-drift.yml` (every PR to main) | Compare current specs against the baseline, fail on breaking changes | Markdown report to stdout, exit code 0 or 1 |

They share their logic but never run in the same workflow:

- **`snapshot.js`** sets what *should be true*
- **`diff.js`** checks whether the current PR violates that

This separation is critical. If they ran together, every PR would silently promote its own changes to the baseline — defeating the entire purpose.

---

## Inputs and outputs

### `snapshot.js`

| Input | Source |
|---|---|
| All spec YAMLs | `specs/*.yaml` |
| Pipeline config | `pipeline.config.yaml` (for the specs path) |

| Output | Destination |
|---|---|
| Baseline JSON | `schema-baseline.json` (repo root) |
| Status logs | `stdout` |

### `diff.js`

| Input | Source |
|---|---|
| Existing baseline | `schema-baseline.json` |
| Current spec YAMLs | `specs/*.yaml` |
| Pipeline config | `pipeline.config.yaml` |

| Output | Destination | Format |
|---|---|---|
| Drift report | `stdout` | Markdown — posted as a PR comment by the workflow |
| Exit code | Process | `0` if PR passes, `1` if blocked |

---

## Classification: BREAKING vs ADDITIVE

Every change between baseline and current falls into one of two buckets:

### Breaking changes (exit 1, PR blocked)

| Type | When |
|---|---|
| `SPEC_REMOVED` | A spec file that was in the baseline is no longer present |
| `EVENT_REMOVED` | An event in a known spec was deleted |
| `PARAMETER_REMOVED` | A parameter on a known event was deleted |
| `DATALAYER_KEY_REMOVED` | A dataLayer key on a known event was deleted |

These break downstream consumers because something they relied on is gone.

### Additive changes (exit 0, PR passes)

| Type | When |
|---|---|
| `SPEC_ADDED` | An entirely new spec file |
| `EVENT_ADDED` | A new event in a known spec |
| `PARAMETER_ADDED` | A new parameter on a known event |
| `DATALAYER_KEY_ADDED` | A new dataLayer key on a known event |

These extend the schema without breaking existing consumers.

### The rename trap

A rename — say `product_id` → `productId` — is **not** classified as a single rename event. The diff sees it as:

```
[PARAMETER_REMOVED]  product_id
[PARAMETER_ADDED]    productId
```

This is **intentional**. Treating renames as a first-class concept would require name-matching heuristics that could miss a genuine rename or invent one. The current classification is correct without being clever — a removal is a removal, even if it happens at the same time as a similarly-named addition. The breaking flag fires, the PR blocks, the analyst sees both changes side by side and decides.

---

## The flatten-keys trick

The single non-obvious piece of logic in this module.

Specs have nested structure:

```yaml
dataLayer:
  event: purchase
  ecommerce:
    currency: "{{DL - currency}}"
    value: "{{DL - value}}"
    items: "{{DL - items}}"
```

A naive flat-key comparison would only see top-level keys: `event`, `ecommerce`. The whole `ecommerce` object would be treated as one opaque blob. A change from `ecommerce.items` to `ecommerce.products` would not be caught — both versions just have an `ecommerce` key.

The `flattenKeys` function fixes this by recursively converting nested objects to dot-notation paths:

```javascript
flattenKeys({ event: 'purchase', ecommerce: { items: '...', value: '...' } })
// → ['ecommerce.items', 'ecommerce.value', 'event']
```

Now `ecommerce.items` → `ecommerce.products` is correctly detected as one removal and one addition.

### Edge cases the flattener handles

- **Empty objects** — `{ foo: {} }` flattens to `['foo']` (the parent path is preserved so the field doesn't vanish from the schema)
- **Arrays** — treated as leaves, not descended into. `{ items: [{...}, {...}] }` flattens to `['items']`, not `['items.0.id']`. This is intentional: per-array-element schema tracking would be noisy and rarely useful
- **Primitives** — strings, numbers, booleans, null — all leaves
- **Sorted output** — keys are sorted alphabetically so baseline diffs are stable across runs

Fixing the flattener to handle nested renames was tracked as Bug #6 earlier in the project. It now matters because real-world ecommerce specs nest deeply.

---

## The baseline file

`schema-baseline.json` at the repo root. Structure:

```json
{
  "generated_at": "2026-06-04T18:45:18.086Z",
  "generated_by": "agents/schema-guardian/snapshot.js",
  "specs_dir": "specs/",
  "specs": {
    "SPEC-2026-002-add_to_cart": {
      "filename": "SPEC-2026-002-add_to_cart.yaml",
      "spec_id": "SPEC-2026-002-add_to_cart",
      "version": null,
      "events": {
        "add_to_cart": {
          "parameters": ["currency", "product_id", "product_name", "value"],
          "dataLayer": ["ecommerce.currency", "ecommerce.items", "ecommerce.value", "event"]
        }
      }
    }
  }
}
```

The structure is intentionally minimal — only what's needed for drift detection. Specifically, it captures:

- **Parameter key names** but not types, descriptions, or examples
- **dataLayer key paths** (flattened) but not values
- **Event names** but not triggers or business rules

Why so minimal? **Because schema drift is about names, not metadata.** A description change is not a breaking change. A type change *could* be breaking but is rare and better caught by the spec linter. Tight scope keeps the diff signal-to-noise ratio high.

The file is committed to the repo. Every PR includes the baseline that was current when the PR was opened, which means drift detection is **deterministic across re-runs** of the same PR.

---

## File-by-file walkthrough

```
schema-guardian/
├── snapshot.js     ← Writes schema-baseline.json
└── diff.js         ← Compares current vs baseline, fails on breaks
```

**No `package.json`.** Like `gtm-generator`, this folder is two single-file scripts using the root repo's `yaml` package via Node's module resolution.

### `snapshot.js`

Six functional sections:

1. **Config load** — directly reads `pipeline.config.yaml` to find the specs directory
2. **`flattenKeys()`** — the recursive key-flattener
3. **`extractParamKeys()` / `extractDataLayerKeys()`** — thin wrappers around `flattenKeys`
4. **`serializeSpec()`** — reads one YAML file, sanitizes `NEEDS_CLARIFICATION:` placeholders, extracts the per-event key sets
5. **`run()`** — walks `specs/`, calls `serializeSpec()` on each, writes the baseline JSON

The output is sorted and stable — the same input set produces byte-identical output on every run. This makes the file diff-friendly in git history.

### `diff.js`

Same shape as `snapshot.js` plus the diff logic:

1. **Config load + helpers** — duplicated from `snapshot.js`
2. **`loadCurrentSpecs()`** — same as `snapshot.js` but returns the data in memory instead of writing to disk
3. **`diffSchemas(baseline, current)`** — the core comparison:
   - For each spec in the baseline: check if it still exists; if so, check every event and parameter
   - For each spec in current: check if it's a new addition
   - Returns `{ breaking: [...], additive: [...] }`
4. **`buildComment()`** — formats the result as a Markdown PR comment with breaking/additive sections, instructional text, and a final pass/blocked verdict
5. **`run()`** — handles the missing-baseline edge case, runs the diff, prints the comment, exits 0 or 1

The two scripts deliberately share `flattenKeys()`, `extractParamKeys()`, and `extractDataLayerKeys()` — the **same** logic must serialize for both the baseline and the comparison. If the snapshot and the diff disagreed on how to flatten, drift detection would be broken.

---

## How a PR gets blocked or passed

Step-by-step, what happens when a PR opens against main:

1. `schema-drift.yml` triggers on the PR
2. The workflow runs `node agents/schema-guardian/diff.js`
3. The script reads `schema-baseline.json` (the version committed to main when the PR opened)
4. The script reads current `specs/*.yaml` (the PR's version)
5. It computes the diff via `diffSchemas()`
6. It prints a Markdown report to stdout
7. The workflow captures the output and posts it as a sticky PR comment
8. The script exits 0 (passes) or 1 (blocks)
9. GitHub reports the workflow status as the required check `Schema Drift Check`
10. If the check fails, branch protection blocks merge

The PR comment gets **updated** on subsequent runs (e.g., when the analyst pushes new commits) — the workflow uses `actions/github-script` to find the existing bot comment and update it, rather than creating a fresh one each time. Same comment ID, always shows the latest report.

### Intentionally breaking changes

When a breaking change is genuinely intended (renaming a parameter as part of a planned migration), the flow is:

1. Analyst opens the PR, schema-drift blocks it
2. Analyst gets approval from another reviewer on the breaking-change rationale
3. Analyst runs the `Update Schema Baseline` workflow manually with a `reason` input (mandatory audit trail)
4. `snapshot.js` regenerates `schema-baseline.json` on main
5. The original PR re-runs schema-drift, now passes (the baseline now includes the rename)
6. PR merges

The friction is the point. Breaking changes should be deliberate, justified, and documented.

---

## Configuration

Neither script accepts CLI arguments. Both read everything from `pipeline.config.yaml`.

### Values read from `pipeline.config.yaml`

| Config key | Used for |
|---|---|
| `paths.specs_output_dir` | Where to find spec YAMLs (typically `specs/`) |

### Hardcoded

| Constant | Value | Why |
|---|---|---|
| `BASELINE_PATH` | `schema-baseline.json` at repo root | Convention; never changes |

No environment variables. No model selection. No prompts. The agent's behavior is fully determined by its inputs.

---

## Local development

```bash
cd web-tracking-cicd

# No npm install needed — uses the root yaml package

# Generate a fresh baseline (overwrites schema-baseline.json)
node agents/schema-guardian/snapshot.js

# Check current specs against the existing baseline
node agents/schema-guardian/diff.js

# diff.js exits 0 if PR would pass, 1 if blocked
echo "Exit code was: $?"
```

### Testing a breaking change locally

Useful when developing changes that touch the diff logic:

```bash
# 1. Take a fresh baseline of current state
node agents/schema-guardian/snapshot.js

# 2. Edit a spec to introduce a breaking change
# e.g., rename `product_id` to `productId` in some spec

# 3. Run diff — should report PARAMETER_REMOVED + PARAMETER_ADDED, exit 1
node agents/schema-guardian/diff.js

# 4. Revert the spec change
git checkout specs/

# 5. Run diff again — should pass, exit 0
node agents/schema-guardian/diff.js
```

This loop is the fastest way to verify changes to the flattener or diff logic without going through CI.

---

## The bootstrap edge case

What happens the very first time the pipeline runs, before any baseline exists?

`diff.js` handles this gracefully:

```javascript
if (!existsSync(BASELINE_PATH)) {
  console.log('## 🛡️ Schema Drift Report');
  console.log('');
  console.log('⚠️ **No baseline found** (`schema-baseline.json` does not exist).');
  console.log('Run the `Update Schema Baseline` workflow to create the initial baseline.');
  console.log('This PR is **not blocked** — baseline is required before drift detection is active.');
  process.exit(0);
}
```

The PR is **not** blocked. The check passes with an informative message instructing the analyst to bootstrap the baseline. This means a freshly forked repo can merge PRs immediately; drift protection becomes active the moment the first baseline is created.

### Force-reset recovery

After running `git push --force` on main (rare but possible during major refactors), the baseline may be out of sync with reality. The recovery sequence:

1. Run the `Update Schema Baseline` workflow manually with `reason: "rebase after main force-reset"`
2. `snapshot.js` regenerates the baseline against current `specs/`
3. Future PRs now compare against the corrected baseline

This is documented in the workflows README under `update-baseline.yml`.

---

## Known issues

- **`flattenKeys()` is duplicated** in both `snapshot.js` and `diff.js`. They must stay in sync — a divergence would silently break drift detection. Should be extracted to a shared module
- **`extractParamKeys` and `extractDataLayerKeys`** are similarly duplicated — both are thin wrappers around `flattenKeys`
- **Stale docstring in `snapshot.js`** says *"dataLayer keys flattened one level"* — but the code actually flattens recursively. Comment should be updated
- **No type-change detection** — a parameter changing from `string` to `number` is not caught (the diff is name-based only). For analytics purposes this matters less than it sounds, but worth knowing
- **No "rename" classification** — renames appear as `REMOVED` + `ADDED` of different names. Intentional design choice (no fragile name-matching heuristics) but can be confusing in the PR comment
- **Doesn't use `lib/config-reader.js`** — direct YAML read, same inconsistency as `gtm-generator`

None block the pipeline. The duplicated-helpers issue is the only one worth fixing soon because divergence would silently break the gate.

---

## Related documentation

- [`../README.md`](../README.md) — overview of all 5 agents
- [`../../.github/workflows/README.md`](../../.github/workflows/README.md) — `schema-drift.yml` (runs `diff.js`) and `update-baseline.yml` (runs `snapshot.js`)
- [`../../schema-baseline.json`](../../schema-baseline.json) — the live baseline file
- [`../../pipeline.config.yaml`](../../pipeline.config.yaml) — where the specs path is configured
