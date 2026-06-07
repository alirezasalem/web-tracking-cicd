# `lib/` — The Shared Config Layer

A single utility module that every other script in the repo imports from. It loads `pipeline.config.yaml` once, resolves all paths to absolute, and exports a handful of typed helpers.

If you change a config value anywhere — a model name, a path, a spec_id format — this module is what makes that change visible to every script that depends on it. Nothing else reads `pipeline.config.yaml` directly.

---

## Table of contents

- [What's in this folder](#whats-in-this-folder)
- [Why this module exists](#why-this-module-exists)
- [How scripts use it](#how-scripts-use-it)
- [Exported interface](#exported-interface)
- [Path resolution](#path-resolution)
- [Helper functions](#helper-functions)
- [Adding to a new script](#adding-to-a-new-script)
- [Known issues](#known-issues)

---

## What's in this folder

```
lib/
└── config-reader.js   ← The only file
```

A single module. Deliberately. The whole point is that there's exactly one place that knows how to read `pipeline.config.yaml`.

---

## Why this module exists

Before this module existed, several scripts each had their own copy of the config-loading logic:

- `agents/spec-generator/run.js` parsed YAML inline
- `scripts/linter/spec-linter.js` parsed YAML inline
- Each agent had its own hardcoded paths

This created three problems:

**1. Config changes had to be propagated by hand.** Changing the default Claude model meant editing N files.

**2. Path resolution was inconsistent.** Scripts in different folders resolved relative paths differently. Some worked from `process.cwd()`, others from `__dirname`. Subtle bugs when run from CI vs locally.

**3. There was no canonical "what does config X mean?" reference.** Each script implemented its own interpretation.

`lib/config-reader.js` solves all three. It:

- **Loads once** — config is parsed once at module-load time
- **Resolves paths absolutely** — every path in `pipeline.config.yaml` gets resolved against the repo root, so scripts work the same regardless of working directory
- **Exports typed helpers** — instead of digging into `config.spec.required_fields`, scripts import `requiredFields` directly

The module is the **single source of truth** for runtime config. Every other module in the repo imports from here.

---

## How scripts use it

The typical pattern:

```javascript
// At the top of any script that needs config:
import {
  config,           // full parsed pipeline.config.yaml
  paths,            // all paths resolved to absolute
  buildSpecId,      // helper for spec_id format
  agentModel,       // current Claude model
  requiredFields,   // for linter / validators
  allowedStatuses,  // for linter / validators
} from '../../lib/config-reader.js';
```

The relative path (`../../`) depends on the importing file's depth. Two levels deep is typical (`agents/X/run.js`, `scripts/X/run.js`). One level deep would be `../lib/`. Three levels (`agents/spec-generator/rag/index.js`) becomes `../../../lib/`.

### Real examples in the codebase

| File | Import path |
|---|---|
| `agents/spec-generator/run.js` | `'../../lib/config-reader.js'` |
| `agents/tracking-concept-generator/run.js` | `'../../lib/config-reader.js'` |
| `agents/spec-generator/rag/query.js` | `'../../../lib/config-reader.js'` |
| `scripts/linter/spec-linter.js` | `'../../lib/config-reader.js'` |

The agents folder uses `'../../'` consistently. The RAG submodule needs the extra `..` because it's nested one level deeper.

---

## Exported interface

The module exports 11 things, grouped by purpose:

### Core

| Export | Type | Source | Use |
|---|---|---|---|
| `config` | object | parsed `pipeline.config.yaml` | When you need a config field that has no dedicated helper. Prefer the helpers below. |
| `paths` | object | `config.paths` resolved to absolute | `paths.specs_output_dir`, `paths.conventions_file`, etc. |

### Spec helpers

| Export | Type | Use |
|---|---|---|
| `buildSpecId(sequence, eventSlug?)` | function | Produces `SPEC-2026-003-view_cart` from `(3, 'view_cart')` |
| `buildSpecFilename(specId)` | function | Produces `SPEC-2026-003-view_cart.yaml` from a spec_id |

### Linter helpers

| Export | Type | Use |
|---|---|---|
| `requiredFields` | array | Required fields every spec must have (from `spec.required_fields`) |
| `allowedStatuses` | array | Valid `status` values (from `spec.allowed_statuses`) |

### Agent helpers

| Export | Type | Use |
|---|---|---|
| `agentModel` | string | Current Claude model name |
| `agentMaxTokens` | number | `max_tokens` for Claude API calls |
| `agentTemperature` | number | Temperature for Claude API calls |
| `generatorTag` | string | Value written to `generated_by` (`claude-api`) |
| `clarificationPlaceholder(reason?)` | function | Builds `NEEDS_CLARIFICATION: <reason>` strings |

### Playwright helpers

| Export | Type | Use |
|---|---|---|
| `playwrightBaseUrl` | string | Base URL for Playwright tests (respects `TEST_BASE_URL` env var) |
| `dataLayerVariable` | string | dataLayer variable name (usually `window.dataLayer`) |
| `playwrightTimeout` | number | Timeout (ms) for dataLayer assertions |

---

## Path resolution

Every path in `pipeline.config.yaml → paths` gets two things automatically:

1. **Resolved to absolute** — `specs/` becomes `/full/path/to/repo/specs`
2. **Normalized** — works the same whether the script is run from repo root, from a sub-folder, or from CI

```javascript
import { paths } from '../../lib/config-reader.js';

console.log(paths.specs_output_dir);
// → '/Users/alirezasalemi/web-tracking-cicd/specs'

console.log(paths.conventions_file);
// → '/Users/alirezasalemi/web-tracking-cicd/conventions/conventions.yaml'
```

This is **why no script in the repo needs to call `process.cwd()` or `__dirname`** for path resolution. They just use `paths.xxx` directly.

### The repo-root trick

The module determines the repo root by walking up one level from its own file location:

```javascript
const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '../');
```

This works because `lib/` is always exactly one level below the repo root. If anyone ever moves this module deeper (`utils/lib/config-reader.js`), this line needs to be updated.

---

## Helper functions

### `buildSpecId(sequence, eventSlug?)`

Constructs a canonical spec ID from a sequence number and optional event slug.

```javascript
buildSpecId(3, 'view_cart')
// → 'SPEC-2026-003-view_cart'

buildSpecId(42)
// → 'SPEC-2026-042'  (when include_event_slug is false, or no slug provided)

buildSpecId(7, 'newsletter_signup')
// → 'SPEC-2026-007-newsletter_signup'
```

Reads from these config keys:
- `spec.id_prefix` (default `SPEC`)
- `spec.year_source` (`current` or `fixed`)
- `spec.year_fixed` (used when `year_source` is `fixed`)
- `spec.sequence_digits` (default `3` → zero-pads to `001`)
- `spec.include_event_slug` (default `true`)
- `spec.event_slug_separator` (default `-`)

Changing any of these in `pipeline.config.yaml` instantly changes what `buildSpecId()` produces everywhere.

### `buildSpecFilename(specId)`

Adds the file extension to a spec ID.

```javascript
buildSpecFilename('SPEC-2026-003-view_cart')
// → 'SPEC-2026-003-view_cart.yaml'
```

Reads from `spec.file_extension` (default `.yaml`).

### `clarificationPlaceholder(reason?)`

Builds a `NEEDS_CLARIFICATION:` placeholder for use in generated specs.

```javascript
clarificationPlaceholder('which pages does this event apply to')
// → 'NEEDS_CLARIFICATION: which pages does this event apply to'

clarificationPlaceholder()  // no reason
// → 'NEEDS_CLARIFICATION:'  (or the default from config)
```

Reads from:
- `agent.clarification_placeholder` (default value when no reason given)
- `agent.clarification_format` (template, default `'NEEDS_CLARIFICATION: {reason}'`)

This is what powers the agent's "honest 'I don't know'" mechanism. See [`feature-briefs/README.md → When the AI gets it wrong`](../feature-briefs/README.md#when-the-ai-gets-it-wrong) for the policy.

---

## Adding to a new script

The pattern, end-to-end:

```javascript
// 1. Import what you need (use destructuring for clarity)
import {
  config,
  paths,
  buildSpecId,
  agentModel,
} from '../../lib/config-reader.js';

// 2. Use paths absolutely — no process.cwd() needed
const specPath = `${paths.specs_output_dir}/SPEC-2026-001-page_view.yaml`;

// 3. Use helpers for derived values — don't reimplement
const newSpecId = buildSpecId(42, 'view_cart');

// 4. Use config directly only for things without a helper
const verbose = config.linter?.verbose_output ?? false;
```

### What NOT to do

```javascript
// ❌ Don't reparse the config file
const config = yaml.parse(readFileSync('pipeline.config.yaml'));

// ❌ Don't resolve paths manually
const specPath = path.resolve(process.cwd(), 'specs/SPEC-2026-001.yaml');

// ❌ Don't hardcode model names — they live in config
const model = 'claude-opus-4-5';
```

Every one of these breaks the central source-of-truth guarantee. If you find yourself doing one of them, the right fix is to add a helper to `config-reader.js` and use it instead.

---

## Known issues

Two minor cosmetic issues to flag honestly:

### Stale path references in the JSDoc header

The header comment in `config-reader.js` lists example import paths that include stale references:

```javascript
 *   scripts/codegen/generate-artifacts.js → '../../lib/config-reader.js'
 *   tests/playwright/tracking.spec.js → '../../lib/config-reader.js'
```

Both are outdated:
- `scripts/codegen/generate-artifacts.js` was deleted (empty placeholder)
- `tests/playwright/tracking.spec.js` doesn't exist — Playwright tests actually live in `playwright-datalayer-tests/`

The runtime behavior is unaffected; this is purely a documentation comment that needs refreshing.

**Recommended fix:** update the JSDoc header to reflect the current folder layout.

### One-level-down assumption

The module uses a hardcoded `'../'` to locate the repo root:

```javascript
const REPO_ROOT = resolve(__dirname, '../');
```

This breaks silently if someone ever nests `lib/` deeper (e.g. into `utils/lib/`). Not currently a real risk — the repo structure is stable — but worth knowing if you're considering reorganizing the layout.

---

## Related documentation

- [`../pipeline.config.yaml`](../pipeline.config.yaml) — the config file this module reads
- [`../conventions/README.md`](../conventions/README.md) — the other rules file (not read by this module)
- [`../agents/spec-generator/README.md`](../agents/spec-generator/README.md) — heaviest consumer of this module
- [`../scripts/README.md`](../scripts/README.md) — the linter, second heaviest consumer
