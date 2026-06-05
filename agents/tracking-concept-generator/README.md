# `agents/tracking-concept-generator/` — Spec → Developer Docs

Reads a merged analytics spec YAML and generates one engineer-facing Markdown document per event. These are the implementation guides that frontend developers actually read when wiring up the dataLayer.

If `spec-generator` is the analyst's tool, this agent is the **developer-experience tool**. It turns terse, machine-readable specs into prose-with-code-examples that a junior engineer can ship from.

---

## Table of contents

- [What it does](#what-it-does)
- [Inputs and outputs](#inputs-and-outputs)
- [The 6 sections every doc contains](#the-6-sections-every-doc-contains)
- [File-by-file walkthrough](#file-by-file-walkthrough)
- [How a spec becomes multiple docs](#how-a-spec-becomes-multiple-docs)
- [Prompt design](#prompt-design)
- [Configuration](#configuration)
- [Local development](#local-development)
- [The human-edit problem](#the-human-edit-problem)
- [Known issues](#known-issues)

---

## What it does

Given a merged spec like `specs/SPEC-2026-005-remove_from_cart.yaml` (which describes the event in YAML-structured form), this agent calls Claude once per event and writes one Markdown file per event to `tracking-concepts/`.

So a 1-event spec produces 1 doc. A 3-event spec produces 3 docs.

The output is a structured, opinionated implementation guide:

```markdown
# remove_from_cart
Fires when a user removes an item from their shopping cart.

## Overview
This event tracks cart abandonment behavior at the item level...

## Trigger Rules
- User clicks the "Remove" button on a cart line item
- The cart must contain at least one item before removal
- ...

## dataLayer.push() Snippet
```js
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({ ecommerce: null });
window.dataLayer.push({
  event: 'remove_from_cart',
  ecommerce: {
    currency: 'EUR',
    value: 49.99,
    items: [{
      item_id: 'SKU-12345',
      item_name: 'Wool Sweater',
      price: 49.99,
      quantity: 1
    }]
  }
});
```

## Parameter Table
| Parameter | Type | Required | Example | Description |
|---|---|---|---|---|
| ecommerce.currency | string | ✅ | EUR | ISO 4217 currency code |
| ecommerce.value | number | ✅ | 49.99 | Total value of removed items |
| ...

## Business Rules & Edge Cases
1. Must NOT fire on quantity decreases — only full removals
2. Must fire after the cart state update succeeds, not on click
3. ...
```

The point: a developer can implement the tracking by reading this file alone, without needing to understand the spec YAML format or look anything else up.

---

## Inputs and outputs

### Inputs

| Input | Source | Purpose |
|---|---|---|
| Spec YAML | `specs/SPEC-*.yaml` (CLI arg) | The structured event definition |
| System prompt | `agents/tracking-concept-generator/prompt.md` | Defines doc structure and writing rules |

### Outputs

| Output | Destination | Format |
|---|---|---|
| Per-event docs | `tracking-concepts/<event_name>.md` | Markdown with HTML comment header |
| Status logs | `stderr` | Human-readable progress + per-event results |
| Stdout | `process.stdout` | Per-file confirmation only (no large content) |
| Exit code | Process | `0` if all events succeed, `1` if any fail |

The agent batches **events within a single spec** but processes them **sequentially** (not in parallel) to avoid Claude API rate-limit spikes. If a spec has 5 events, that's 5 sequential API calls.

---

## The 6 sections every doc contains

The system prompt enforces a strict structure. Every generated doc has these 6 sections, in this order:

| # | Section | Purpose |
|---|---|---|
| 1 | **Title** | `# event_name` + one-line summary |
| 2 | **Overview** | 2–4 sentences explaining when it fires and why it matters |
| 3 | **Trigger Rules** | Bulleted list of every condition that must be true (and what must NOT trigger it) |
| 4 | **dataLayer.push() Snippet** | Copy-paste-ready JavaScript with realistic example values |
| 5 | **Parameter Table** | Full table: name, type, required, example, description |
| 6 | **Business Rules & Edge Cases** | Numbered list of special rules — dedup, timing, PII, currency, SPA handling |

This structure is non-negotiable. The prompt rejects extra sections, missing sections, or different orderings.

**Why so rigid?** Two reasons:
1. **Predictability for developers** — they always find the dataLayer snippet in the same place
2. **Mechanical post-processing** — future tooling (e.g., extracting all snippets to feed a code-completion model) needs structural reliability

---

## File-by-file walkthrough

```
tracking-concept-generator/
├── run.js          ← Main entry — one Claude call per event in the spec
├── prompt.md       ← System prompt — defines the 6-section structure
├── package.json    ← Dependencies (yaml@2 — that's it)
└── README.md       ← This file (replaces a stale earlier version)
```

### `run.js`

Pure orchestration, no business logic. The 5 phases:

1. **Parse CLI args** — requires `--spec <path>`
2. **Load the spec** — reads YAML, sanitizes `NEEDS_CLARIFICATION:` placeholders, validates it contains an `events` array
3. **Load the system prompt** — from `agents/tracking-concept-generator/prompt.md`
4. **Loop sequentially over `spec.events`** — one Claude call per event, with per-call error handling so one failure doesn't kill the whole batch
5. **Write each doc** — to `tracking-concepts/<event_name>.md` with an HTML comment header

**Per-event prompt structure.** Each Claude call sends:
- Spec-level metadata (`spec_id`, `title`, `platform`, `global_parameters`)
- The single event being documented as isolated YAML
- A clear instruction: *"Generate the tracking concept for this event only."*

This isolation prevents Claude from accidentally bleeding information between events when a spec has multiple events.

**Failure mode.** If any event's Claude call fails, the agent records it but continues with the remaining events. At the end, it prints a summary and exits 1 if anything failed. Successful events are still written to disk — partial progress is preserved.

### `prompt.md`

The system prompt that defines doc structure. Hardcoded rules include:

- **The 6 sections, in order** — anything else is rejected
- **GA4 ecommerce handling** — always push `{ ecommerce: null }` first, then nest `currency`, `value`, `items` under `ecommerce` (never at the top level)
- **No placeholder values** — examples must be realistic (`"EUR"`, `49.99`) not lazy (`"string"`, `"number"`, `"N/A"`)
- **Valid JavaScript only** — the snippet must be syntactically valid JS, not pseudocode
- **Plain English** — avoid analytics jargon; if a spec uses it, define it briefly
- **Faithfulness** — never invent parameters or rules not in the spec

The "no placeholder values" rule matters more than it sounds. It forces the model to invest in producing genuinely useful examples instead of generic skeletons.

### `package.json`

Single dependency: `yaml@^2.4.1`. Like every other agent, it uses native `fetch()` for the Claude API call (no SDK).

The `"name"` field is still `"doc-generator"` — a legacy name from before this agent was renamed. Cosmetic only.

---

## How a spec becomes multiple docs

A spec can contain multiple events. The agent generates one doc per event, with the event name as the filename:

```
specs/SPEC-2026-007-checkout_flow.yaml
  events:
    - name: begin_checkout
      ...
    - name: add_shipping_info
      ...
    - name: add_payment_info
      ...

tracking-concepts/
  begin_checkout.md          ← generated
  add_shipping_info.md       ← generated
  add_payment_info.md        ← generated
```

This 1-event-per-file structure means:
- Each file is small, scannable, and link-shareable
- A developer implementing `add_payment_info` only needs to open one file
- Search across `tracking-concepts/` finds events by name instantly
- Future tooling can iterate over the folder treating each file as an atomic unit

The downside: if events share context (like "all 3 events fire in this funnel"), the funnel context is duplicated across 3 files. The system prompt handles this by treating each event as independently complete.

---

## Prompt design

Three design principles shape `prompt.md`:

**1. Structure is the contract.** Every doc has exactly 6 sections in exactly that order. This gives developers predictable navigation and makes post-processing tools reliable.

**2. Realism over genericness.** The prompt explicitly forbids `"string"` and `"123"` as example values. Generic examples are useless; realistic examples are immediately copy-pastable.

**3. Faithfulness over completeness.** The prompt says: *"Do not invent parameters or rules that are not in the spec."* If the spec is sparse, the doc will be sparse. Better an incomplete doc that's accurate than a complete one that hallucinates.

This third principle is **the most violated** rule in practice — see "Known issues" below.

---

## Configuration

This agent has minimal configuration compared to `spec-generator`. Most behavior is hardcoded in `run.js`.

### CLI flags

```
--spec <path>   Required. Path to the spec YAML file.
```

### Environment variables

| Variable | Required | Default | Used for |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | — | The Claude API call |
| `OUTPUT_DIR` | ⬜ | `tracking-concepts/` | Override where docs are written |
| `DEBUG` | ⬜ | — | Set to `1` for verbose stderr logging |

### Hardcoded in `run.js`

| Constant | Value | Notes |
|---|---|---|
| `MODEL` | `claude-opus-4-5` | Should be moved to `pipeline.config.yaml` (cleanup item) |
| `MAX_TOKENS` | `4096` | Should be moved to `pipeline.config.yaml` (cleanup item) |
| Output filename pattern | `<event_name>.md` | Reasonable default, unlikely to need overriding |

---

## Local development

The agent runs locally with no special setup:

```bash
cd web-tracking-cicd

# Install agent deps
cd agents/tracking-concept-generator
npm install
cd ../..

# Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# Generate docs for one spec
node agents/tracking-concept-generator/run.js --spec specs/SPEC-2026-005-remove_from_cart.yaml

# Output to a custom directory
OUTPUT_DIR=/tmp/test-docs node agents/tracking-concept-generator/run.js --spec specs/SPEC-2026-005-remove_from_cart.yaml

# Verbose debug logging
DEBUG=1 node agents/tracking-concept-generator/run.js --spec specs/SPEC-2026-005-remove_from_cart.yaml
```

### Iterating on the prompt

The fastest feedback loop:

1. Edit `agents/tracking-concept-generator/prompt.md`
2. Run locally against one spec
3. Open the generated `tracking-concepts/<event>.md` and review
4. Tweak prompt, re-run

Per-run cost is ~$0.05–0.10 per event. A 3-event spec costs ~$0.20 to regenerate.

---

## The human-edit problem

Every generated doc opens with this HTML comment header:

```html
<!--
  Auto-generated by web-tracking-cicd tracking-concept-generator
  Event: remove_from_cart
  Generated: 2026-06-04T12:34:56.789Z
  DO NOT EDIT — regenerate by re-running the spec through CI
-->
```

The "DO NOT EDIT" instruction is a **convention, not an enforcement**. There's currently no mechanism to detect when a human has manually edited a doc.

**The failure mode:** an analyst adds an important clarification to `tracking-concepts/purchase.md` by hand. Three weeks later, someone updates the underlying spec and the doc regenerates. The analyst's manual edit is silently overwritten.

This is a known bug in the pipeline (tracked as **Bug #7** in the project backlog). Two possible solutions are on the roadmap:

1. **Diff detection** — before regeneration, hash the existing doc body. If the hash diverges from what the agent last produced, fail the workflow and require explicit `--force` to overwrite.
2. **Editable sections** — split docs into auto-generated sections and a clearly marked "Analyst Notes" section that never gets regenerated.

Until one of these ships, treat manual edits to `tracking-concepts/` as **temporary** — they will be overwritten on the next spec change.

---

## Known issues

- **Hardcoded model and max_tokens** in `run.js` — should live in `pipeline.config.yaml` for consistency with `spec-generator`
- **Old package name** — `package.json` says `"doc-generator"`, a legacy name. Cosmetic only
- **No detection of manual edits** — see "The human-edit problem" above
- **Editorialization of field names** — the agent occasionally rewrites a spec parameter name to match GA4 defaults (e.g., spec says `products`, doc says `items`). Tracked as part of Bug #7
- **Minor typo in source comment** — `"also know as"` should be `"also known as"`. Cosmetic

---

## Related documentation

- [`../README.md`](../README.md) — overview of all 5 agents
- [`../../.github/workflows/README.md`](../../.github/workflows/README.md) — the `generate-tracking-concept.yml` workflow that invokes this agent
- [`../spec-generator/README.md`](../spec-generator/README.md) — the upstream agent that produces the specs this one consumes
- [`../../tracking-concepts/`](../../tracking-concepts/) — the live output of this agent
