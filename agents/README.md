# `agents/` — The AI Layer

Five autonomous agents that turn structured inputs into structured outputs. This is where the AI work happens — every Claude API call, every Voyage embedding, every YAML→Markdown or YAML→JSON transformation lives here.

Each agent is a self-contained Node.js module with its own dependencies, prompt, and run script. They are invoked by the workflows in [`.github/workflows/`](../.github/workflows/README.md) and can also be run locally for testing.

---

## Table of contents

- [The five agents](#the-five-agents)
- [Shared design pattern](#shared-design-pattern)
- [Agent reference](#agent-reference)
  - [spec-generator — brief → spec](#1-spec-generator--brief--spec)
  - [tracking-concept-generator — spec → developer docs](#2-tracking-concept-generator--spec--developer-docs)
  - [test-generator — spec → Playwright tests](#3-test-generator--spec--playwright-tests)
  - [gtm-generator — spec → GTM container config](#4-gtm-generator--spec--gtm-container-config)
  - [schema-guardian — diff & baseline](#5-schema-guardian--diff--baseline)
- [Why one agent per artifact?](#why-one-agent-per-artifact)
- [Tuning agent behavior](#tuning-agent-behavior)
- [Cost notes](#cost-notes)
- [Local development](#local-development)

---

## The five agents

```
agents/
├── spec-generator/             ← Brief → Spec YAML (the entry point of the pipeline)
│   └── rag/                    ← Vector retrieval submodule used by spec-generator
├── tracking-concept-generator/ ← Spec → Engineer-facing Markdown docs
├── test-generator/             ← Spec → Playwright dataLayer .spec.js tests
├── gtm-generator/              ← Spec → GTM container export JSON
└── schema-guardian/            ← Spec set → Schema baseline / drift diff (no AI)
```

| Agent | Input | Output | AI? |
|---|---|---|---|
| **spec-generator** | `feature-briefs/FB-*.md` + RAG context | `specs/SPEC-*.yaml` | ✅ Claude + Voyage |
| **tracking-concept-generator** | `specs/SPEC-*.yaml` | `tracking-concepts/*.md` | ✅ Claude |
| **test-generator** | `specs/SPEC-*.yaml` | `playwright-datalayer-tests/*.spec.js` | ✅ Claude |
| **gtm-generator** | `specs/SPEC-*.yaml` | `gtm-assets/*.json` | ❌ Pure transformation |
| **schema-guardian** | `specs/*.yaml` + `schema-baseline.json` | Diff report or new baseline | ❌ Pure logic |

The `schema-guardian` and `gtm-generator` aren't AI agents in the strict sense — they're deterministic Node.js scripts. They live here because they share the same agent contract (input file, output file, callable from a workflow) and conceptually belong to the artifact-generation layer.

---

## Shared design pattern

Every AI agent in this folder follows the same five-step structure:

```
1. Parse CLI args                ← --spec path/to/spec.yaml or similar
2. Load + validate the input     ← parse YAML, fail loud on malformed input
3. Load the system prompt        ← from agents/<name>/prompt.md
4. Call Claude (or transform)    ← https://api.anthropic.com/v1/messages
5. Write output to disk          ← to a workflow-known path
```

This consistency matters because every workflow can invoke any agent with confidence about how to call it, what to expect back, and how to handle failures.

**Common conventions across all agents:**

- **stderr for logs, stdout for output** — so `node run.js > output.yaml` produces a clean artifact even with verbose logging
- **Exit code 1 on any failure** — Claude API errors, YAML parse errors, missing inputs
- **`NEEDS_CLARIFICATION:` sanitization** — every agent applies the same regex to escape unquoted placeholder values before parsing YAML (the spec generator emits these when the brief is ambiguous)
- **No retries on Claude calls** — failures bubble up to the workflow, which is the right layer for retry logic
- **Same model family** — most agents use `claude-opus-4-5`; the spec generator uses Sonnet (configured in `pipeline.config.yaml`)

---

## Agent reference

### 1. spec-generator — brief → spec

**Folder:** [`spec-generator/`](./spec-generator/)

**Purpose:** The entry point of the entire pipeline. Reads a PM-written feature brief in plain English and produces a structured YAML tracking spec.

**Inputs:**
- A Markdown brief from `feature-briefs/FB-*.md`
- `conventions/conventions.yaml` — the rulebook
- `pipeline.config.yaml` — formatting rules (spec_id format, required fields, allowed statuses)
- `data/spec-index.json` — past specs for RAG retrieval

**Output:** A YAML spec written to stdout, captured by `generate-spec.yml` and saved to `specs/SPEC-{YEAR}-{NNN}-{event_name}.yaml`

**Files inside the folder:**
```
spec-generator/
├── run.js                  ← Main entry point — orchestrates RAG, Claude call, validation
├── conventions_reader.js   ← Loads conventions.yaml and exposes parsed object
├── prompt.md               ← System prompt — defines spec structure, naming rules, edge cases
├── package.json            ← Dependencies: yaml@2
└── rag/
    ├── index.js            ← Scans specs/, embeds via Voyage, writes data/spec-index.json
    ├── query.js            ← Cosine similarity over the index — returns top-N similar specs
    └── inject.js           ← Formats retrieved specs as Claude prompt context
```

**Required env vars:**
- `ANTHROPIC_API_KEY` (required)
- `VOYAGE_API_KEY` (optional — RAG silently skips if missing, with a stderr warning)

**Used by workflows:** `generate-spec.yml`, `index-specs.yml`

**Key behavior:**
- The RAG step is **gracefully degradable** — if `VOYAGE_API_KEY` is missing or Voyage is down, the generator continues without retrieved context, just logs a warning to stderr
- The generator validates its own output: required fields, allowed statuses, parseable YAML
- Any `NEEDS_CLARIFICATION:<reason>` placeholders for ambiguous fields surface in the analyst's PR review

---

### 2. tracking-concept-generator — spec → developer docs

**Folder:** [`tracking-concept-generator/`](./tracking-concept-generator/)

**Purpose:** Takes a merged spec and generates one Markdown doc per event. These are the implementation guides engineers actually read when writing the dataLayer code on the frontend.

**Inputs:**
- A spec YAML from `specs/`

**Output:** One Markdown file per event written to `tracking-concepts/<event_name>.md`

Each generated doc contains:
- A plain-English overview of when and why the event fires
- Trigger rules (action, state, negative conditions)
- A copy-paste-ready `dataLayer.push()` snippet
- A parameter table with name, type, required, example, description
- Business rules and edge cases

**Files inside the folder:**
```
tracking-concept-generator/
├── run.js          ← CLI entry — calls Claude once per event in the spec
├── prompt.md       ← System prompt — controls doc structure and writing style
└── package.json    ← Dependencies: yaml@2
```

**Required env vars:** `ANTHROPIC_API_KEY`

**Optional env vars:**
- `OUTPUT_DIR` — override the default output directory (`tracking-concepts/`)
- `DEBUG=1` — verbose stderr logging

**Used by workflow:** `generate-tracking-concept.yml`

**Key behavior:**
- One Claude API call per event in the spec — a multi-event spec produces multiple Markdown files
- Each output file gets an HTML comment header: `<!-- Auto-generated by web-tracking-cicd tracking-concept-generator -->` — analysts can grep for this when manually editing
- Stale per-folder `README.md` exists — pending cleanup

---

### 3. test-generator — spec → Playwright tests

**Folder:** [`test-generator/`](./test-generator/)

**Purpose:** Generates a `.spec.js` Playwright test for every event in the spec. The test asserts that the dataLayer event matches the spec when the trigger condition is met.

**Inputs:**
- A spec YAML from `specs/`

**Output:** One Playwright test file per event written to `playwright-datalayer-tests/<event_name>.spec.js`

**Files inside the folder:**
```
test-generator/
├── run.js          ← CLI entry — invokes Claude per event, writes test files
├── prompt.md       ← System prompt — Playwright test patterns, polling helpers, assertion style
├── prompt.mdes     ← ⚠ Stale duplicate of prompt.md, not loaded by any code — pending cleanup
└── package.json    ← Dependencies: @anthropic-ai/sdk, js-yaml
```

**Required env vars:** `ANTHROPIC_API_KEY`

**Used by workflow:** `generate-tests.yml`

**Key behavior:**
- Generates one `.spec.js` per event in the spec
- Tests use `@playwright/test` exclusively — no other test frameworks
- Each test polls the dataLayer with a helper (never assumes synchronous population)
- Test files run via `validate-datalayer.yml` against any live URL

**Current limitation:** The generator produces full tests for page-load events but only stub skeletons for interaction events (clicks, form submits, hover). Interaction-event support is on the roadmap.

---

### 4. gtm-generator — spec → GTM container config

**Folder:** [`gtm-generator/`](./gtm-generator/)

**Purpose:** Transforms a spec into a GTM client-side container export — a JSON file ready to import directly into Google Tag Manager. No AI required; it's pure deterministic transformation.

**Inputs:**
- A spec YAML from `specs/`
- `pipeline.config.yaml` for GTM account ID, container ID, and GA4 measurement ID

**Output:** A JSON file per event written to `gtm-assets/<event_name>-gtm-export.json`

Each output produces:
- A custom event trigger that matches the spec's `event.name`
- A GA4 event tag that fires on that trigger
- Variables for each parameter, sourced from the dataLayer

**Files inside the folder:**
```
gtm-generator/
└── run.js          ← Pure JS transformation — no LLM call
```

**Required env vars:** None

**Used by workflow:** `generate-gtm.yml`

**Key behavior:**
- Auto-detects which spec to process via `git diff HEAD~1 HEAD` if no arg passed
- Falls back to placeholder values (`G-XXXXXXXXXX`, `0000000000`) if `pipeline.config.yaml` doesn't have real GTM IDs
- Uses ID base 100 for generated GTM resources to avoid collisions with GTM's built-in IDs (1–4)
- Each event file is self-contained — no cross-file ID dependencies

**Current scope:** Client-side container only. Server-side container generation is on the roadmap.

---

### 5. schema-guardian — diff & baseline

**Folder:** [`schema-guardian/`](./schema-guardian/)

**Purpose:** Two deterministic scripts that protect the data schema from accidental breaking changes. Not an AI agent — pure logic.

**Files inside the folder:**
```
schema-guardian/
├── snapshot.js     ← Reads every spec, writes schema-baseline.json
└── diff.js         ← Compares current specs against the baseline, reports drift
```

**Required env vars:** None

**Used by workflows:** `schema-drift.yml` (calls `diff.js`), `update-baseline.yml` (calls `snapshot.js`)

#### `snapshot.js`

- Walks every spec in `specs/`
- Extracts each event's name, parameters, and dataLayer keys
- Recursively flattens nested objects into dot-notation keys (e.g., `ecommerce.items`, `ecommerce.value`)
- Serializes the entire schema to `schema-baseline.json`

#### `diff.js`

- Loads the baseline + snapshots the current spec set
- Compares them at the dot-notation key level
- Classifies changes:
  - **BREAKING** — parameter removed or renamed; event removed entirely
  - **ADDITIVE** — new parameter added; new event added; new spec file
- Exits 1 if any breaking changes are found (blocks PR merge)
- Outputs a Markdown report suitable for posting as a PR comment

**Key behavior:**
- The recursive flattening is intentional — single-level flattening would miss nested renames like `ecommerce.items` → `ecommerce.products`
- `diff.js` returns exit code 1 on breaking changes; the workflow uses this to fail the PR
- `snapshot.js` is also run via `workflow_dispatch` after a force-reset of main, to rebase the baseline against the current spec set

---

## Why one agent per artifact?

You could imagine a single megagent that takes a spec and emits docs + tests + GTM config all at once. We deliberately don't:

**Failure isolation.** If the test generator's prompt regresses, doc generation still works. One broken agent doesn't break the pipeline.

**Independent evolution.** The doc generator's prompt has different goals (clarity, engineer-readability) than the test generator's prompt (correctness, polling logic). Mixing them constrains both.

**Cost transparency.** Each agent's Claude usage is easy to attribute. You can see exactly which agent is expensive vs. cheap.

**Retry granularity.** A workflow can re-run just the test generation without redoing docs. With a megagent, every retry costs the full multi-artifact generation.

**Composability.** Future agents (sGTM, mobile, BigQuery view) plug in alongside the existing ones without touching them.

---

## Tuning agent behavior

The two main levers for changing agent output:

**1. The system prompt** (`agents/<name>/prompt.md`)

This is the highest-leverage file. Every agent's behavior is shaped by its prompt — output structure, naming choices, edge case handling. Iterate here first when output isn't what you want.

When editing a prompt:
- Be specific about negative cases ("never include `data-testid` selectors — use stable CSS selectors")
- Show examples of bad vs. good output inline in the prompt
- Test changes against multiple specs locally before merging

**2. The model + temperature** (`pipeline.config.yaml`)

```yaml
agents:
  spec_generator:
    model: claude-sonnet-4-20250514
    max_tokens: 4096
    temperature: 0.2
```

- **Lower temperature** (0.0–0.3) → more deterministic output, better for spec generation
- **Higher temperature** (0.5–0.7) → more creative phrasing, useful for docs
- **Model choice** → Sonnet for speed/cost, Opus for harder reasoning tasks

Most agents currently hardcode their model in `run.js` (`claude-opus-4-5`). Pulling these into `pipeline.config.yaml` is on the cleanup list.

---

## Cost notes

For a busy repo running this pipeline:

| Per spec generation | Approximate cost |
|---|---|
| Voyage embedding (query) | $0.0001 |
| Claude — spec generator | $0.05–0.15 |
| Claude — doc generator | $0.05–0.10 per event |
| Claude — test generator | $0.05–0.10 per event |
| GTM generator | $0 (no AI) |
| Schema guardian | $0 (no AI) |
| Voyage embedding (re-index) | $0.0002 per added spec |

A spec with 3 events costs roughly **$0.40–$0.80** end-to-end. A team shipping a new spec per week stays under $10/month all-in.

---

## Local development

Every agent can be run locally against any spec. Useful for prompt iteration without burning CI minutes.

```bash
# Install dependencies for the agent you're testing
cd agents/spec-generator
npm install

# Set API key
export ANTHROPIC_API_KEY=sk-ant-...
export VOYAGE_API_KEY=vk-...   # only for spec-generator

# Run from repo root
cd ../..
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md > /tmp/test-spec.yaml
node agents/tracking-concept-generator/run.js --spec specs/SPEC-2026-005-remove_from_cart.yaml
node agents/test-generator/run.js specs/SPEC-2026-005-remove_from_cart.yaml
node agents/gtm-generator/run.js specs/SPEC-2026-005-remove_from_cart.yaml
node agents/schema-guardian/diff.js
node agents/schema-guardian/snapshot.js
```

**Debugging:**
- Most agents respect `DEBUG=1` for verbose stderr
- Claude API errors include the full response body in the error message
- Output goes to stdout; logs go to stderr — pipe accordingly

---

For the workflows that invoke these agents, see [`.github/workflows/README.md`](../.github/workflows/README.md).
