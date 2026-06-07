# `conventions/` — The Rulebook

This folder contains the **single source of truth for naming and structure rules** that every analytics spec must follow. The spec linter enforces every rule defined here, on every PR.

It's the one folder the AI agents cannot edit. That's the point. The AI generates specs *against* these conventions; humans evolve the conventions themselves.

---

## Table of contents

- [What this folder is for](#what-this-folder-is-for)
- [The two files](#the-two-files)
- [Source of truth precedence](#source-of-truth-precedence)
- [What `conventions.yaml` controls](#what-conventionsyaml-controls)
- [How the linter uses it](#how-the-linter-uses-it)
- [How the spec generator uses it](#how-the-spec-generator-uses-it)
- [Evolving the conventions](#evolving-the-conventions)
- [Strict mode](#strict-mode)
- [Known inconsistencies](#known-inconsistencies)

---

## What this folder is for

Tracking taxonomies decay without governance. Without strict naming rules:

- One spec uses `product_id`, another uses `productId`, a third uses `item_id`
- Three engineers implement the same event with three different `dataLayer` shapes
- Dashboards break because the BigQuery view assumes one name and gets another
- Six months later, nobody can tell which name is the "real" one

This folder prevents that by **encoding the rules as files** so they:

- Cannot be ignored (every PR runs the linter)
- Cannot drift between teams (the file is the rulebook)
- Are auditable in git (every rule change has a PR with a rationale)
- Are extensible (add a new event to the allowlist, open a PR)

It's the analytics equivalent of an ESLint config — taxonomy as code.

---

## The two files

```
conventions/
├── conventions.yaml    ← The authoritative rulebook (used by the linter at runtime)
└── schema.json         ← A JSON Schema mirror for IDE inline validation (advisory)
```

### `conventions.yaml`

The runtime rulebook. Read by:

- `scripts/linter/spec-linter.js` — enforces every rule in CI
- `agents/spec-generator/conventions_reader.js` — feeds the rules into the Claude prompt
- Any future agent that needs taxonomy validation

This is the file you edit when you want to add a new event to the allowlist, forbid a new parameter pattern, or change ecommerce rules. **All changes live here.**

### `schema.json`

A JSON Schema (Draft-07) that mirrors a subset of the rules in `conventions.yaml`. It exists for **IDE integration**:

- VS Code's YAML extension uses this to provide inline validation while editing specs
- Other IDEs with YAML LSP support can use it the same way

The schema is **advisory only**. The linter does not consult it. Its role is to give analysts a faster feedback loop while editing — squiggly underlines on bad event names without waiting for CI.

> ⚠️ **`schema.json` is currently out of date** relative to `conventions.yaml` and the actual spec format. It references the old `SPEC-NNN` pattern and uses `feature_brief` instead of `feature_brief_ref`. See [Known inconsistencies](#known-inconsistencies). The linter ignores it, but IDE squiggles may be misleading until it's resynced.

---

## Source of truth precedence

This is the most important section in the doc.

There are **three places** in the repo where rules about specs are defined:

| File | Authoritative for |
|---|---|
| `pipeline.config.yaml` | Required fields, allowed statuses, spec_id format, version format, file paths |
| `conventions/conventions.yaml` | Naming patterns, event/parameter allowlists, ecommerce rules, linter behavior |
| `conventions/schema.json` | Nothing at runtime — IDE hint only |

The linter (`scripts/linter/spec-linter.js`) hardcodes this precedence. When the same concept appears in two files, the linter consults the table above:

```javascript
// From spec-linter.js
import { config, requiredFields, allowedStatuses } from '../../lib/config-reader.js';
// ↑ pipeline.config.yaml is the source for required fields + statuses

const conventions = yaml.parse(readFileSync(config.paths.conventions_file, 'utf8'));
// ↑ conventions.yaml is the source for naming patterns + allowlists
```

### Why the split

The two files solve different problems:

- **`pipeline.config.yaml`** answers *"what shape must a spec have to be parseable by this pipeline?"* — structural concerns, mostly path and format related
- **`conventions/conventions.yaml`** answers *"what shape must a spec have to be a valid analytics artifact?"* — taxonomy concerns, names and semantics

If you change the path of where specs live, you edit `pipeline.config.yaml`. If you add a new ecommerce event to the allowlist, you edit `conventions.yaml`. The separation isn't always perfectly clean (see [Known inconsistencies](#known-inconsistencies)), but the principle holds.

---

## What `conventions.yaml` controls

The file is organized into 9 numbered sections. Here's what each one does:

### Section 1 — Event names

Defines the format every event name must follow:

| Rule | Value |
|---|---|
| Format | `snake_case` |
| Min length | 3 |
| Max length | 40 |
| Pattern | `^[a-z][a-z0-9_]*[a-z0-9]$` |
| Forbidden prefixes | `gtm_`, `ga_`, `firebase_`, `debug_`, `_` |
| Forbidden suffixes | `_v2`, `_new`, `_old`, `_temp`, `_test` |
| Forbidden patterns | `__` (consecutive underscores), `^event_` (redundant prefix) |

Also lists **reserved auto-collected events** (e.g., `page_view`, `session_start`) that come from GA4 itself, and an **allowlist** of approved event names. Unknown events trigger a warning in normal mode and an error in strict mode.

### Section 2 — Parameter names

Same rules as event names — snake_case, length limits, no leading/trailing underscores, no consecutive underscores. Plus a list of GA4 reserved parameter names that may be referenced but not redefined (`page_location`, `page_referrer`, etc.).

### Section 3 — Data types

The complete list of allowed values for the `type` field on any parameter:

- `string`
- `number`
- `boolean`
- `array`
- `object`
- `currency` *(special — requires a `currency_param` sibling pointing to the ISO 4217 code)*
- `enum` *(special — requires a `values` list)*

The two special cases (`currency_requires_sibling: true`, `enum_requires_values: true`) are linter-enforced.

### Section 4 — Spec-level required fields

> ⚠️ **This section is currently dead code.** The linter does not read `spec_required_fields` from `conventions.yaml`. It reads `spec.required_fields` from `pipeline.config.yaml` instead. The section is preserved for documentation purposes but should be removed or synced. See [Known inconsistencies](#known-inconsistencies).

The actual authoritative list lives in `pipeline.config.yaml → spec.required_fields`:

```yaml
required_fields:
  - spec_id
  - version
  - status
  - owner
  - feature_brief_ref
  - generated_by
  - created_at
  - events
```

### Section 5 — Per-event required fields

Fields every entry in the `events` array must have. The linter enforces this list against the conventions file directly:

- `name`
- `trigger`
- `priority`
- `parameters`
- `notes`

Plus `priority_allowed_values: [P0, P1, P2]`.

### Section 6 — Per-parameter required fields

Fields every entry in a structured-notation `parameters` array must have:

- `name`
- `type`
- `required`
- `example`

Plus a list of **forbidden example values** (`TODO`, `TBD`, `FIXME`, `null`, empty string, `example`, `test`). The linter rejects any parameter whose `example` matches one of these.

### Section 7 — Ecommerce rules

Domain-specific rules for GA4 ecommerce events. Lists:

- Events that MUST include an `items` array parameter (`add_to_cart`, `purchase`, etc.)
- Required fields within each `item` object (`item_id`, `item_name`, `price`)
- Recommended item fields (`item_brand`, `item_category`, etc.)
- Events that MUST include `value` and `currency` top-level params
- Events that MUST include `transaction_id` (`purchase`, `refund`)

Each rule maps to a specific linter check in section 8. Together they make ecommerce specs conform to GA4's actual schema requirements — not just a generic "looks like an event" structure.

### Section 8 — Linter behavior

Per-rule severity configuration. Each linter rule is declared here with a `severity` of `error` or `warning`:

- **Errors** fail the workflow (exit code 1), block PR merge
- **Warnings** appear in the CI output, do not block merge

This gives operators a knob to escalate or de-escalate individual rules without changing linter code. Example:

```yaml
event_name_not_in_allowlist:
  severity: warning   # becomes error in strict_mode
```

Plus a top-level `strict_mode: false` toggle (see [Strict mode](#strict-mode) below).

### Section 9 — Trigger structure

Rules for the `trigger` block within each event:

- Allowed `action` values (`page_load`, `button_click`, `form_submit`, `scroll`, `visibility`, `spa_navigation`)
- Events that require `trigger.selector` (interaction events)
- Events that require `trigger.page_path` (everything except `page_load`)
- Notes on selector stability (prefer `data-testid` over class/id)

The test-generator consults this section to know what kind of test stub to produce for each action.

---

## How the linter uses it

The flow:

1. Linter starts up, reads `pipeline.config.yaml` via `lib/config-reader.js`
2. Linter reads `conventions/conventions.yaml` (path resolved from `pipeline.config.yaml`)
3. For each spec file:
   - Check structural rules using `pipeline.config.yaml` (required fields, statuses, format)
   - Check naming rules using `conventions.yaml` (patterns, allowlists, ecommerce)
4. Aggregate errors and warnings
5. Exit 1 if any errors, 0 otherwise

The full set of checks is documented in [`specs/README.md → Validation rules`](../specs/README.md#validation-rules).

---

## How the spec generator uses it

The Claude-powered spec generator (see `agents/spec-generator/`) reads `conventions.yaml` and injects the **entire raw file** into the user message it sends to Claude:

```javascript
// From agents/spec-generator/run.js
const conventions = readConventions();
// ...
const userMessage = `
## Naming Conventions (from conventions.yaml)

${conventions.raw}

## Feature Brief
${briefContent}
`;
```

This means **Claude sees the conventions file verbatim** on every spec generation. The rules influence the generated spec directly — Claude tries to comply with everything in the file because it's right there in its context window.

That's why:

- **Adding a new event to the allowlist** propagates to the AI immediately on the next generation
- **Changing the snake_case pattern** changes what the AI produces
- **Adding a new ecommerce rule** is automatically followed in new specs

You don't have to re-train, re-prompt, or restart anything. Edit the file, commit, the next generation reflects the change.

---

## Evolving the conventions

When you want to add, change, or remove a convention:

1. **Edit `conventions.yaml`** with the change
2. **Open a PR**
3. **The linter runs against all existing specs** — if your new rule breaks any of them, the PR fails
4. **Either fix the specs to comply, or relax the rule** before merging
5. **After merge**, the new rule is live — the next spec generated will follow it

This is the same flow as any source code change. The conventions are code.

### Adding a new event to the allowlist

The most common edit. Just append to `event_names.allowlist`:

```yaml
event_names:
  allowlist:
    # ... existing list ...
    - newsletter_signup    # ← new entry
```

In non-strict mode, this only changes warnings into silence. In strict mode, it changes errors into success (the linter rejects unknown events). Either way, the AI now knows the event is "official."

### Adding a new ecommerce rule

Say you want `view_promotion` to require an `items` array:

```yaml
ecommerce:
  requires_items_array:
    - view_cart
    - add_to_cart
    # ... existing ...
    - view_promotion       # ← new entry
```

The linter immediately starts checking every `view_promotion` spec for the `items` array. Existing specs that don't have it will fail until updated.

### Forbidding a new parameter prefix

Say a new GA4 update reserves the `__ga_` prefix:

```yaml
parameter_names:
  forbidden_prefixes:
    - ga_
    - gtm_
    - firebase_
    - ep.
    - __ga_                # ← new entry
```

The linter rejects any parameter starting with `__ga_` on the next PR.

---

## Strict mode

The `linter.strict_mode` toggle controls how the linter handles **unknown event names** (events not in the allowlist):

| Mode | Behavior |
|---|---|
| `strict_mode: false` (default) | Unknown event → warning, PR merges |
| `strict_mode: true` | Unknown event → error, PR blocked |

### When to flip it on

The default is `false` because:

- Early in a project's life, the allowlist is incomplete by definition
- Forcing every new event through an allowlist-update-PR creates friction
- Warnings still appear in the CI output, so they don't go unnoticed

Flip to `true` when:

- The taxonomy is stable enough that new events are rare
- You want every new event to be a deliberate, reviewed decision
- The team has agreed on the allowlist as the canonical list

Flipping is a single-line change in `conventions.yaml`:

```yaml
linter:
  strict_mode: true   # was false
```

After flipping, every PR that introduces a new event must include an allowlist update in the same diff. This is the desired friction.

---

## Known inconsistencies

Three real issues in the current files. Worth knowing about until they're fixed.

### `spec_required_fields` is dead code

`conventions.yaml` has a `spec_required_fields` block. The linter does not read it. The actual list is `pipeline.config.yaml → spec.required_fields`.

The two lists also disagree:

- `conventions.yaml → spec_required_fields` includes `spec_version`, `feature_brief`
- `pipeline.config.yaml → spec.required_fields` includes `version`, `feature_brief_ref`

The pipeline config is correct (matches the actual specs). The conventions file is stale.

**Fix:** delete the section from `conventions.yaml`, or rename its fields to match the actual spec format. Either way, the linter behavior won't change because it ignores this section.

### `schema.json` is out of date

`conventions/schema.json` references the **pre-rename** repo URL (`analytics-cicd/conventions/schema.json`) and uses **old field names** (`feature_brief` instead of `feature_brief_ref`, `spec_version` instead of `version`). It also encodes a `SPEC-NNN` `spec_id` pattern, but real specs use `SPEC-YYYY-NNN-event_name`.

The schema is advisory (used only by IDEs for inline validation), so this doesn't affect CI. But analysts editing specs in VS Code may see misleading squiggles.

**Fix:** regenerate `schema.json` from `conventions.yaml` and `pipeline.config.yaml`. A future tooling improvement could auto-derive `schema.json` so it never drifts again.

### `priority` is listed at the event level, but real specs put it at the spec level

`conventions.yaml → event_required_fields` includes `priority`, suggesting every event must have a `priority` field. But real specs vary:

- Some specs put `priority` at the **spec level** (`priority: P0` next to `spec_id`)
- Some specs put `priority` at the **event level** (`priority: P1` inside the event)
- Some don't have `priority` at all

The linter does not actually enforce `priority` as required because it relies on `pipeline.config.yaml → spec.required_fields`, where `priority` is not listed.

**Fix:** decide whether `priority` is spec-level or event-level, document it, and remove it from the convention file's other location.

---

## Related documentation

- [`../specs/README.md`](../specs/README.md) — the spec format itself, which these conventions validate
- [`../scripts/linter/`](../scripts/linter/) — the linter implementation (separate README pending)
- [`../agents/spec-generator/README.md`](../agents/spec-generator/README.md) — the agent that consumes these conventions
- [`../agents/spec-generator/conventions_reader.js`](../agents/spec-generator/conventions_reader.js) — the loader module that exposes conventions to the agent
- [`../pipeline.config.yaml`](../pipeline.config.yaml) — the other rules file (structural concerns)
