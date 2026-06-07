# `scripts/` — The Linter and Supporting Scripts

This folder holds **non-agent infrastructure code** that the pipeline depends on. The most important file is the spec linter — the script that enforces every rule defined in `conventions/conventions.yaml` on every pull request.

If `agents/` is the AI layer and `conventions/` is the rulebook, this folder is the **enforcement layer**.

---

## Table of contents

- [What's in this folder](#whats-in-this-folder)
- [The spec linter](#the-spec-linter)
  - [How it works](#how-it-works)
  - [What it checks](#what-it-checks)
  - [Errors vs warnings](#errors-vs-warnings)
  - [Exit codes](#exit-codes)
  - [Local usage](#local-usage)
- [The local generate-spec wrapper](#the-local-generate-spec-wrapper)
- [Related documentation](#related-documentation)

---

## What's in this folder

```
scripts/
├── linter/
│   └── spec-linter.js          ← The runtime enforcer (used by CI)
└── generate-spec.sh            ← Local convenience wrapper (not CI)
```

Two files, both doing real work. The linter is the heavyweight; the shell wrapper is a thin convenience for local testing.

---

## The spec linter

`scripts/linter/spec-linter.js` is the **runtime enforcer** of the entire conventions system. It runs on every PR via the [`Spec Lint`](../.github/workflows/README.md#2-spec-lint--spec-lintyml) workflow and blocks merge if any spec violates the rules.

### How it works

The linter is a single ES module that takes one or more spec file paths as CLI arguments, validates each against the union of `pipeline.config.yaml` and `conventions/conventions.yaml`, and exits with `0` (pass) or `1` (fail).

It reads from two configuration sources, exactly as documented in [`conventions/README.md → Source of truth precedence`](../conventions/README.md#source-of-truth-precedence):

- **`pipeline.config.yaml`** — for structural rules: required fields, allowed statuses, spec_id format, version format
- **`conventions/conventions.yaml`** — for naming rules: event/parameter patterns, length limits, forbidden suffixes

It also reads the linter's own behavior config from `pipeline.config.yaml → ci`:

```yaml
ci:
  linter_fail_on_error: true     # exit 1 if any error found
  linter_fail_on_warning: false  # warnings are non-blocking by default
```

### What it checks

Six categories of checks, in order:

| # | Check | Source | Severity |
|---|---|---|---|
| 1 | **Required fields present** | `pipeline.config.yaml → spec.required_fields` | Error |
| 2 | **Status is allowed** | `pipeline.config.yaml → spec.allowed_statuses` | Error |
| 3 | **`spec_id` format** | Built from `pipeline.config.yaml → spec.*` | Error |
| 4 | **Version is semver** | `pipeline.config.yaml → versioning.format` | Error |
| 5 | **Event-level validation** | `conventions.yaml` | Error / Warning |
| 6 | **`NEEDS_CLARIFICATION` placeholders** | Detected by JSON-stringify scan | Warning only |

The event-level validation (check 5) has five sub-checks:

| Sub-check | What it does | Severity |
|---|---|---|
| 5a — Event name pattern | Matches `^[a-z][a-z0-9_]*[a-z0-9]$` (snake_case) | Error |
| 5b — Name length | Within min/max bounds from `conventions.yaml` | Error |
| 5c — Forbidden suffixes | No `_v2`, `_new`, `_old`, `_temp`, `_test` | Error |
| 5d — Parameter names | Match the parameter pattern (when structured notation is used) | Error |
| 5e — Interaction-trigger selector required | `button_click` or `form_submit` events must have `trigger.selector` | Error |
| 5f — `page_path` recommended | Non-page_load events should have `trigger.page_path` | Warning |

The interaction-selector rule (5e) is especially important — it ensures the test-generator agent has a real selector to call `page.locator(...).click()` against. Without it, generated tests would be useless.

### Errors vs warnings

The linter treats violations at two levels:

- **Errors** — fail the workflow, block PR merge, must be fixed
- **Warnings** — print to the workflow log but don't fail by default

The split lets analysts ship work with minor issues (e.g. unresolved `NEEDS_CLARIFICATION:` placeholders that they intend to resolve in review) while still flagging them clearly. To make warnings blocking, set `pipeline.config.yaml → ci.linter_fail_on_warning: true`.

In strict-mode shops, both should be `true`. In permissive-mode shops, both can be `false` and the linter just reports.

### Exit codes

```
0 → All checks passed (or only warnings present, when fail_on_warning is false)
1 → At least one error (or warning, when fail_on_warning is true)
```

The CI workflow uses these exit codes directly. No parsing required — exit 0 means merge can proceed, exit 1 means it cannot.

### Local usage

The linter is a regular Node script. Run it locally before opening a PR to avoid CI back-and-forth:

```bash
# Lint a single spec
node scripts/linter/spec-linter.js specs/SPEC-2026-005-remove_from_cart.yaml

# Lint all specs
node scripts/linter/spec-linter.js specs/*.yaml

# Lint inside CI runs across every spec automatically — no glob magic needed
```

Output looks like this when everything passes:

```
✓ SPEC-2026-001-page_view.yaml
✓ SPEC-2026-002-add_to_cart.yaml
...

Linter summary: 5 file(s) checked, 0 error(s), 0 warning(s)
```

When something fails, the linter is verbose about exactly what's wrong:

```
✗ SPEC-2026-006-newsletter_signup.yaml — 2 error(s)
    ERROR:   Missing required field: "owner"
    ERROR:   Event name "newsletterSignup" doesn't match pattern ^[a-z][a-z0-9_]*[a-z0-9]$ (snake_case only)

Linter summary: 1 file(s) checked, 2 error(s), 0 warning(s)
```

This output is also what gets posted into the GitHub Actions log on PR runs. Analysts and PMs can read the error directly and know what to fix.

---

## The local generate-spec wrapper

`scripts/generate-spec.sh` is a **local convenience wrapper** around the spec-generator agent. It's not used by CI — CI calls `agents/spec-generator/run.js` directly via the [`Generate Spec from Brief`](../.github/workflows/README.md#1-generate-spec-from-brief--generate-specyml) workflow.

### When to use it

For local testing of the spec-generator without going through GitHub:

```bash
# Generate from a brief text string
./scripts/generate-spec.sh "Track newsletter signup form submissions"

# Generate from a brief file
./scripts/generate-spec.sh --file feature-briefs/FB-005.md

# Save the output to a file
./scripts/generate-spec.sh --file feature-briefs/FB-005.md --out /tmp/test-spec.yaml
```

Requires `ANTHROPIC_API_KEY` set in your environment. Optionally `VOYAGE_API_KEY` for RAG to fire (otherwise the script generates without retrieval — same graceful degradation as CI).

### Known issues with the wrapper

The script has two known bugs to be aware of:

**1. Stale path in the help comment.** The header references `specs/briefs/FB-002.md` — that's the old path. Briefs now live in `feature-briefs/`. Cosmetic only; the script accepts any path you pass.

**2. The `BRIEF_TEXT` mode doesn't work.** The script's positional-arg branch calls `run.js --brief "$BRIEF_TEXT"`, but `run.js` only accepts `--brief-file <path>`. So `./scripts/generate-spec.sh "some text"` will silently fail with an unhelpful error. Use `--file` mode instead.

Both are on the cleanup list. The script remains useful in `--file` mode.

---

## Related documentation

- [`../.github/workflows/README.md`](../.github/workflows/README.md) — the workflows that invoke these scripts
- [`../conventions/README.md`](../conventions/README.md) — the rulebook the linter enforces
- [`../specs/README.md`](../specs/README.md) — the spec format the linter validates
- [`../pipeline.config.yaml`](../pipeline.config.yaml) — the structural rules the linter reads
- [`../agents/spec-generator/README.md`](../agents/spec-generator/README.md) — the agent the local `generate-spec.sh` wraps
