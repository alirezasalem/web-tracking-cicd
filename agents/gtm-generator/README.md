# `agents/gtm-generator/` — Spec → GTM Container Config

Reads a merged analytics spec YAML and emits an importable GTM client-side container JSON file per event. **No AI involved** — pure deterministic Node.js transformation from one structured format to another.

This is the agent that closes the loop. After `spec-generator` defines what should be tracked, `tracking-concept-generator` documents it, and `test-generator` validates it, this agent produces the **actual implementation artifact** an analyst can import directly into Google Tag Manager.

---

## Table of contents

- [What it does](#what-it-does)
- [Why no AI](#why-no-ai)
- [Inputs and outputs](#inputs-and-outputs)
- [The transformation logic](#the-transformation-logic)
- [The dataLayer-block convention](#the-datalayer-block-convention)
- [The ecommerce special case](#the-ecommerce-special-case)
- [File-by-file walkthrough](#file-by-file-walkthrough)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Importing into GTM](#importing-into-gtm)
- [Known issues](#known-issues)

---

## What it does

Given an event in a merged spec like:

```yaml
events:
  - name: remove_from_cart
    trigger:
      action: button_click
      selector: "[data-testid='remove-item-btn']"
      page_path: /cart
    parameters:
      product_id: "DL - product_id"
      product_name: "DL - product_name"
    dataLayer:
      event: remove_from_cart
      ecommerce:
        currency: "{{DL - currency}}"
        value: "{{DL - value}}"
        items: "{{DL - items}}"
```

This agent emits a JSON file at `gtm-assets/remove_from_cart-gtm-export.json` containing:

- **1 custom-event trigger** matching `event: remove_from_cart`
- **5 dataLayer variables** — one for `ecommerce` (the whole object), and one each for `ecommerce.currency`, `ecommerce.value`, `ecommerce.items`
- **1 GA4 event tag** firing on the trigger, with all variables wired up as event parameters

The result is structurally identical to a real GTM container export. An analyst can go to GTM → Admin → Import Container → upload the file → all tags, triggers, and variables appear ready to publish.

---

## Why no AI

Every other agent in this folder uses Claude. This one doesn't. Three reasons:

**1. The transformation is fully deterministic.** Given the same spec, the same GTM JSON should always come out — byte for byte. Claude's stochasticity is a liability here, not a feature.

**2. GTM JSON is rigid.** GTM's container export format is precisely specified. Every field has a known shape, type, and value. There's no creative interpretation to delegate.

**3. Mistakes are expensive.** A wrong tag configuration silently misroutes events. A hallucinated `firingTriggerId` breaks the tag. The cost of a Claude error here would be analyst hours debugging GTM, not a regenerated YAML file.

When the transformation is well-defined, **JavaScript is the right tool**. AI is for the parts where judgment matters — naming, prose, examples, structure inference. Tag wiring is not one of those parts.

---

## Inputs and outputs

### Inputs

| Input | Source | Purpose |
|---|---|---|
| Spec YAML | Positional CLI arg, OR auto-detected from git, OR first found in `specs/` | The structured event definition |
| `pipeline.config.yaml` | Repo root | GTM account ID, container ID, GA4 measurement ID, container name |

### Outputs

| Output | Destination | Format |
|---|---|---|
| Per-event GTM exports | `gtm-assets/<event_name>-gtm-export.json` | GTM container-export JSON |
| Status logs | `stdout` | Progress per event |
| Exit code | Process | `0` on success, `1` if no events found or no files generated |

A multi-event spec produces multiple JSON files — one per event — each self-contained and independently importable.

---

## The transformation logic

For each event in the spec, the agent builds three categories of GTM resources:

| Resource | Count | Purpose |
|---|---|---|
| **Custom-event trigger** | 1 | Fires when `dataLayer` receives `event: <event_name>` |
| **dataLayer variables** | N (one per param) | Expose each `dataLayer` key as a GTM variable for use in tags |
| **GA4 event tag** | 1 | Sends the event to GA4 with all variables as event parameters |

The output JSON wraps these in GTM's standard `containerVersion` envelope, including built-in variables (Page URL, Page Path, Referrer, Event) and the container-level `features` block that GTM expects on import.

### ID assignment

GTM resources need unique numeric IDs. The agent uses a simple offset scheme:

```javascript
const ID_BASE = 100;
const makeId = (offset) => String(ID_BASE + offset);
```

- Trigger: ID `101`
- Tag: ID `102`
- Variables: IDs `110`, `111`, `112`, ...

Starting at 100 avoids collisions with GTM's built-in IDs (1–4). Since each output file is self-contained, there's no cross-file collision risk.

### Naming conventions

| Resource | Name format | Example |
|---|---|---|
| Trigger | `Event - <event_name>` | `Event - remove_from_cart` |
| Variable | `DLV - <param_name>` | `DLV - product_id` |
| Tag | `GA4 - <event_name>` | `GA4 - remove_from_cart` |

These names are visible in the GTM UI after import. The conventions matter for navigability — an analyst opening GTM should find related resources by sorting by name.

---

## The dataLayer-block convention

A subtle but important design choice: the agent reads variables from the `dataLayer` block, **not** the `parameters` block.

Why? They serve different purposes in a spec:

```yaml
parameters:
  product_id: "DL - product_id"   # ← GTM variable reference (string label)

dataLayer:
  event: remove_from_cart
  ecommerce:
    currency: "{{DL - currency}}"  # ← Actual runtime payload (the source of truth)
    items: "{{DL - items}}"
```

The `parameters` block is **GTM-facing notation** — it shows analysts which variable to use when wiring a tag in the GTM UI. It's documentary, not authoritative.

The `dataLayer` block is the **actual runtime contract** — it shows what `window.dataLayer.push()` will emit at runtime. This is the ground truth for what variables need to exist.

The agent reads the `dataLayer` block, walks its keys, and emits one GTM variable per data key. The `parameters` block is ignored entirely.

### Keys that get skipped

Not every dataLayer key becomes a variable:

| Key | Why skipped |
|---|---|
| `event` | This is the trigger name, not a variable to expose |
| `value` (when `ecommerce` is present) | Duplicate of `ecommerce.value` — would create a redundant DLV |
| `currency` (when `ecommerce` is present) | Same reason |
| Nested objects other than `ecommerce` | Currently unsupported — only ecommerce gets special expansion |

---

## The ecommerce special case

GA4 ecommerce events nest their payload under an `ecommerce` key:

```yaml
dataLayer:
  event: remove_from_cart
  ecommerce:
    currency: "{{DL - currency}}"
    value: "{{DL - value}}"
    items: "{{DL - items}}"
```

For GTM to wire these up correctly, the agent generates:

- **One variable for the whole `ecommerce` object** — `DLV - ecommerce`. Used when a tag needs the full ecommerce blob (which GA4's `gaawe` tag often does).
- **One variable per first-level key inside ecommerce** — `DLV - ecommerce.currency`, `DLV - ecommerce.value`, `DLV - ecommerce.items`. Used when a tag needs to read individual fields.

The `items` array stays as a single variable — there's no per-item-field expansion. GA4 handles the array natively; exposing individual `items[0].item_id` style variables would explode the variable count without benefit.

This dual-expansion is the most non-obvious behavior in the agent. It exists because GTM templates often need both — sometimes you bind the whole `ecommerce` to a tag parameter, sometimes you reference a specific currency in a condition. Both need to be available.

---

## File-by-file walkthrough

```
gtm-generator/
└── run.js          ← The entire agent — pure transformation, no deps beyond `yaml`
```

**There is no `package.json` and no `prompt.md`.** This agent is genuinely a single file. It uses the root repo's `yaml` package through Node's module resolution; no separate `npm install` is needed.

### `run.js`

Functionally divided into five sections:

**1. Config loaders.** `loadConfig()`, `getMeasurementId()`, `getContainerMeta()` — read `pipeline.config.yaml` for GTM account ID, container ID, and GA4 measurement ID. All have safe fallbacks (`G-XXXXXXXXXX`, `0000000000`) so the agent never fails just because IDs aren't set.

**2. Spec resolver.** `resolveSpecFile(arg)` — three-tier lookup:
   - If a CLI arg is passed, use it
   - Otherwise, try `git diff --name-only HEAD~1 HEAD -- "specs/**/*.yaml"` to find what changed in the last commit
   - As a last resort, `find specs -name "*.yaml" | head -1` to grab any spec

**3. Spec loader.** `loadSpec()` — reads the YAML, sanitizes `NEEDS_CLARIFICATION:` placeholders (same regex as other agents), parses to object.

**4. GTM JSON builders.** Three focused functions:
   - `buildVariables(params, ...)` — one DLV variable per parameter
   - `buildTrigger(eventName, ...)` — one CUSTOM_EVENT trigger
   - `buildTag(eventName, params, measurementId, triggerId, ...)` — one `gaawe` (GA4 event) tag
   - `buildExport({...})` — assembles everything into GTM's container-version envelope

**5. Main loop.** Walks `spec.events`, computes the param list from the dataLayer block (with the ecommerce special-case), builds the export, writes to `gtm-assets/<event_name>-gtm-export.json`.

---

## Configuration

### CLI args

```
node run.js [path-to-spec.yaml]
```

The argument is **optional**. If omitted, the agent auto-detects the most recently changed spec via git.

### Environment variables

None. This agent doesn't need API keys.

### Hardcoded in `run.js`

| Constant | Value | Notes |
|---|---|---|
| `PIPELINE_CONFIG_PATH` | `pipeline.config.yaml` | Read directly, not via `lib/config-reader.js` (inconsistency) |
| `OUTPUT_DIR` | `gtm-assets` | Not configurable; should be in `pipeline.config.yaml` |
| `FALLBACK_MEASUREMENT_ID` | `G-XXXXXXXXXX` | Used when no real GA4 ID is configured |
| `ID_BASE` | `100` | Avoids GTM's built-in ID range (1–4) |

### Values read from `pipeline.config.yaml`

| Config key | Used for | Fallback |
|---|---|---|
| `ga4_measurement_id` | The GA4 property to send events to | `G-XXXXXXXXXX` |
| `gtm.account_id` | GTM account identifier | `0000000000` |
| `gtm.container_id` | GTM container identifier | `000000000` |
| `gtm.container_name` | Human-readable container name | `Web Tracking CI/CD` |

The agent runs successfully even with all fallbacks — the output JSON will import into GTM, but the IDs won't match any real account. Useful for testing the pipeline end-to-end without real GTM credentials.

---

## Local development

```bash
cd web-tracking-cicd

# No npm install needed — uses the root yaml package
# Generate GTM config for one spec
node agents/gtm-generator/run.js specs/SPEC-2026-005-remove_from_cart.yaml

# Auto-detect the most recently changed spec
node agents/gtm-generator/run.js

# Inspect output
cat gtm-assets/remove_from_cart-gtm-export.json | head -50
```

### Validating the output

The fastest sanity check is to actually import the file into a test GTM container:

1. Go to a sandbox GTM container
2. Admin → Import Container
3. Choose the generated `<event_name>-gtm-export.json`
4. Pick a workspace (or create a new one for testing)
5. Choose "Merge" import option
6. Review the diff — you should see the trigger, variables, and tag listed
7. Confirm import

If GTM accepts the import without errors and the resources appear correctly named, the output is valid.

### Inspecting the JSON structure

```bash
# Pretty-print and count resources
cat gtm-assets/remove_from_cart-gtm-export.json | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
cv = d['containerVersion']
print(f'Container: {cv[\"container\"][\"name\"]}')
print(f'Tags: {len(cv[\"tag\"])}')
print(f'Triggers: {len(cv[\"trigger\"])}')
print(f'Variables: {len(cv[\"variable\"])}')
for v in cv['variable']:
    print(f'  - {v[\"name\"]}')
"
```

---

## Importing into GTM

The generated files are designed for GTM's **Import Container** feature:

1. GTM → Admin → Import Container
2. Upload the `<event_name>-gtm-export.json` file
3. Choose target workspace (recommend a clean workspace for first import)
4. Choose **Merge** (not Overwrite) — preserves existing resources
5. Review the diff — GTM shows exactly what will be added
6. Click **Confirm**

**One-import-at-a-time recommended.** Each file is self-contained but uses overlapping ID ranges (101, 102, 110...). Importing multiple files into the same workspace works because GTM remaps IDs on import — but reviewing each diff individually is easier than disentangling a multi-event merge.

For long-term use, the natural evolution is to **batch all events into a single container file** so one import covers a whole spec. That refinement is on the backlog.

---

## Known issues

- **Hardcoded paths** — `OUTPUT_DIR`, `PIPELINE_CONFIG_PATH`, and `FALLBACK_MEASUREMENT_ID` are in `run.js`, not `pipeline.config.yaml`. Should be moved for consistency
- **Doesn't use `lib/config-reader.js`** — every other module loads config via the shared reader; this one reads YAML directly. Cosmetic inconsistency
- **No batch mode** — one file per event means importing a multi-event spec is multiple GTM operations. A "consolidate all events into one container" mode would simplify usage
- **No server-side container support** — currently outputs `usageContext: ['WEB']` only. Server GTM (`SERVER`) is on the roadmap as part of the Live Truth monitoring epic
- **Header comment says `Output: gtm/[event_name]-gtm-export.json`** — actual output is `gtm-assets/`. Stale comment, cosmetic
- **Only first-level ecommerce expansion** — nested ecommerce structures (e.g. promotions within items) aren't expanded into variables. Currently fine because no spec uses them, but a future spec might

None of these block the pipeline. They are refinements for when the agent's usage scales beyond portfolio demo.

---

## Related documentation

- [`../README.md`](../README.md) — overview of all 5 agents
- [`../../.github/workflows/README.md`](../../.github/workflows/README.md) — `generate-gtm.yml` workflow that invokes this agent
- [`../spec-generator/README.md`](../spec-generator/README.md) — the upstream agent whose output this consumes
- [`../../gtm-assets/`](../../gtm-assets/) — the live output of this agent
- [`../../pipeline.config.yaml`](../../pipeline.config.yaml) — where GTM account/container/measurement IDs are configured
