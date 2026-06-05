# `agents/spec-generator/` — Brief → Spec

The first and most important agent in the pipeline. Reads a PM-written feature brief in plain English, retrieves the most similar past specs via RAG, and generates a structured YAML spec using Claude.

This is the agent that does the heaviest lifting and the one most worth understanding deeply. If you're forking this repo and customizing it for your own analytics taxonomy, this is the agent you'll edit most.

---

## Table of contents

- [What it does](#what-it-does)
- [Inputs and outputs](#inputs-and-outputs)
- [The 8-step pipeline](#the-8-step-pipeline)
- [File-by-file walkthrough](#file-by-file-walkthrough)
- [The RAG subsystem](#the-rag-subsystem)
- [Prompt design](#prompt-design)
- [Validation gates](#validation-gates)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Customizing for your taxonomy](#customizing-for-your-taxonomy)

---

## What it does

Given a feature brief like this:

```markdown
# FB-006 — Newsletter Signup Tracking

When a user successfully submits the newsletter signup form on the homepage,
we want to track the event in GA4 along with the signup source location
(header, footer, modal popup) and the user's locale.
```

The agent produces a structured spec like this:

```yaml
spec_id: SPEC-2026-006-newsletter_signup
generated_by: claude-api
status: draft
title: "Newsletter Signup — Form Submit"
platform: web
priority: P1
feature_brief_ref: FB-006

events:
  - name: newsletter_signup
    trigger:
      action: form_submit
      selector: "#newsletter-signup-form"
      page_path: "/"
    parameters:
      signup_location: "DL - signup_location"
      locale: "DL - locale"
    dataLayer:
      event: newsletter_signup
      event_category: engagement
      event_label: "{{DL - signup_location}}"
    # ... etc
```

The transformation involves:
- Reading the brief as unstructured Markdown
- Looking up similar past specs by semantic similarity (RAG)
- Knowing the team's naming conventions, required fields, and allowed values
- Calling Claude with a precise system prompt
- Validating the output before emitting it
- Failing loud on any inconsistency

---

## Inputs and outputs

### Inputs

| Input | Source | Purpose |
|---|---|---|
| Feature brief | `feature-briefs/FB-*.md` (CLI arg) | The PM's plain-English request |
| Naming conventions | `conventions/conventions.yaml` | The team's rulebook |
| Pipeline config | `pipeline.config.yaml` | Spec ID format, required fields, allowed values |
| Past specs (top 3) | `data/spec-index.json` | Retrieved via RAG for in-context examples |
| System prompt | `agents/spec-generator/prompt.md` | The behavioral rules for Claude |

### Outputs

| Output | Destination | Format |
|---|---|---|
| Generated spec | `stdout` | YAML — captured by `generate-spec.yml` and saved to `specs/SPEC-*.yaml` |
| Status logs | `stderr` | Human-readable progress + errors |
| Exit code | Process | `0` on success, `1` on any validation or API failure |

The strict stdout/stderr separation matters because the workflow does `node run.js > temp-spec.yaml`. If logs were written to stdout, they'd corrupt the YAML output.

---

## The 8-step pipeline

When `run.js` is invoked, this is what happens, in order:

```
1. Parse CLI args                  ← --brief-file path/to/FB-NNN.md [--sequence N]
2. Read feature brief from disk    ← fail loud if missing
3. Read system prompt              ← from agents/spec-generator/prompt.md
4. Read conventions.yaml           ← via conventions_reader.js
5. Query RAG for similar specs     ← top 3 from data/spec-index.json (or skip gracefully)
6. Build the full user message     ← config + conventions + RAG context + brief
7. Call Claude API                 ← single round-trip, no retries
8. Validate output                 ← parseable YAML + required fields + allowed status
   ↓
   Write YAML to stdout
```

Every step has its own error mode. The pipeline exits 1 at the first failure with a clear stderr message naming what went wrong.

---

## File-by-file walkthrough

```
spec-generator/
├── run.js                  ← Main entry — orchestrates everything
├── conventions_reader.js   ← Loads and parses conventions.yaml
├── prompt.md               ← The system prompt sent to Claude
├── package.json            ← Dependencies (yaml@2 — that's it)
└── rag/
    ├── index.js            ← Builds data/spec-index.json
    ├── query.js            ← Reads the index, computes similarity
    └── inject.js           ← Formats retrieved specs into prompt text
```

### `run.js`

The agent's main entry point. Pure orchestration — every concern (config loading, RAG, validation) is delegated to a focused module.

**Key responsibilities:**
- Parse `--brief-file` and optional `--sequence` args
- Load all five inputs (brief, prompt, conventions, config, RAG context)
- Construct the user message sent to Claude
- Make the API call
- Strip optional ```` ```yaml ```` fences if Claude wraps its output (it sometimes does)
- Sanitize `NEEDS_CLARIFICATION:` placeholders so YAML can parse them
- Validate required fields and allowed status
- Write the result to stdout

**Imports from `lib/config-reader.js`** (the shared config layer):
- `config` — the full parsed `pipeline.config.yaml`
- `agentModel`, `agentMaxTokens`, `agentTemperature` — Claude settings
- `generatorTag` — the value to write into `generated_by` (e.g., `claude-api`)
- `buildSpecId(sequence, eventSlug?)` — produces the canonical spec ID format
- `clarificationPlaceholder(reason)` — formats the `NEEDS_CLARIFICATION:` placeholder
- `paths.generator_prompt` — path to `prompt.md`

**Nothing in `run.js` is hardcoded.** Every behavior is tunable via `pipeline.config.yaml`.

### `conventions_reader.js`

A focused module that loads `conventions/conventions.yaml` and returns three views:
- `raw` — the original text (used verbatim in the Claude prompt)
- `parsed` — the YAML parsed to a JS object
- `summary` — a human-readable preview for logs and debugging

Also exports `validateSpecAgainstConventions(specObj, conventions)` — a validator used by `run.js` to catch convention violations *after* Claude generates the spec but *before* it's written to stdout. This catches things like:
- `spec_id` not matching the `SPEC-YYYY-NNN-feature-name` regex
- Event names not in snake_case
- Invalid `platform` or `priority` values
- Missing required fields

When validation fails, the error names exactly which field and why.

### `prompt.md`

The system prompt sent to Claude on every call. This is the **most important file** in the agent because it defines:
- The agent's role (web analytics spec generator)
- What inputs it can expect
- The exact output shape (YAML, no markdown fences, no preamble)
- Naming rules (snake_case events, `cd_` prefix for custom dimensions, etc.)
- A validation checklist for self-correction before output
- An example output to anchor formatting
- Special-case rules (GA4 ecommerce nested under `ecommerce` key; PII handling; form fields; video tracking)

The prompt is intentionally **opinionated and specific**. When the brief is ambiguous, Claude must use `NEEDS_CLARIFICATION: <reason>` rather than guessing — this surfaces ambiguity to the analyst at review time instead of burying it in plausible-but-wrong YAML.

### `package.json`

The smallest possible. One dependency: `yaml@^2.4.5`. The Claude API call uses native `fetch()`, no SDK. The RAG layer uses Voyage's REST API directly, also no SDK.

Why no SDK? Two reasons: smaller install footprint, and explicit visibility into the wire format. When a debugging session goes deep, you want to see the actual JSON body being POSTed.

---

## The RAG subsystem

The `rag/` subfolder is the agent's memory layer. Without it, the spec generator would treat every brief as a clean slate — the 50th spec would be no more informed than the 1st. With it, the generator learns from the spec library as it grows.

### Why RAG matters here

Without retrieval: Claude sees only the current brief + conventions. It might call a new ecommerce parameter `productId` even though every existing spec uses `product_id`. Convention drift creeps in.

With retrieval: before each generation, the 3 most similar past specs get injected into the prompt as concrete examples. Claude naturally mirrors their parameter naming, trigger structure, and dataLayer shape. Consistency emerges from the system, not from analyst discipline.

For a deep explanation of the RAG architecture (why a flat JSON file, why Voyage AI, why no graph database), see [`rag/README.md`](./rag/README.md).

### The 3-file structure

| File | Purpose | When it runs |
|---|---|---|
| `rag/index.js` | Embeds every spec in `specs/`, writes `data/spec-index.json` | Triggered by `index-specs.yml` on every spec merge |
| `rag/query.js` | Cosine similarity search over the index | Called by `run.js` before every Claude call |
| `rag/inject.js` | Formats retrieved specs into prompt text | Called immediately after `query.js` |

### How retrieval integrates with the main flow

The key code path in `run.js`:

```javascript
const similarSpecs = await querySpecs(briefContent, 3);
const ragContext   = formatRagContext(similarSpecs);
```

`querySpecs(briefContent, 3)` does the heavy lifting:
1. Loads the cached index (~50KB JSON, parsed once per process)
2. Embeds the brief text via Voyage AI (`voyage-3-lite`, 512 dimensions)
3. Computes cosine similarity against every entry in the index
4. Returns the top 3 with their scores

`formatRagContext(similarSpecs)` produces a Markdown block like:

```markdown
## Reference: Similar Past Specs

The following specs from our library are most similar to this brief.
Use them as structural and naming reference — mirror their parameter naming,
trigger patterns, and dataLayer shape where appropriate.

### Similar spec 1: SPEC-2026-002-add_to_cart (similarity: 0.70)
...
### Similar spec 2: SPEC-2026-004-purchase (similarity: 0.63)
...
```

This block gets concatenated into the user message right after the conventions and right before the brief. The position matters: examples need to be visible to Claude *before* it reads the new requirement.

### Graceful degradation

The RAG layer is **optional**. If `VOYAGE_API_KEY` is missing, or Voyage is down, or the index is empty, the generator continues without retrieved context:

```
[spec-generator] Querying spec index for similar past specs...
[rag/query] ⚠ VOYAGE_API_KEY not set — skipping RAG retrieval
[spec-generator] RAG: no similar specs found — generating without examples
[spec-generator] Calling Claude API (claude-sonnet-4-20250514)...
```

The generator never *fails* due to RAG. It just produces a less-informed spec. This is intentional — RAG is value-add, not a critical dependency.

---

## Prompt design

The `prompt.md` file is engineered around four principles:

**1. Output structure first, behavior second.** The first thing Claude reads is "Return only a YAML block. No preamble, no explanation, no markdown fences." Every downstream parser assumes this.

**2. Conventions are dynamic, rules are static.** The prompt has a few hardcoded rules (snake_case, `cd_` prefix, GA4 ecommerce shape) but for anything that might change per team, it defers explicitly: *"always defer to conventions.yaml if it conflicts."* Teams customize the YAML, not the prompt.

**3. Show, don't tell.** The prompt includes a complete worked example showing the exact structure expected — spec_id, events array, parameters object, dataLayer block, acceptance criteria. Claude is much more reliable when it has one concrete reference.

**4. Force ambiguity to surface.** Rather than letting Claude guess at missing details, the prompt requires `NEEDS_CLARIFICATION: <reason>` for any field the brief doesn't specify. This pushes the analyst's attention exactly to the places that need human judgment.

### Special-case rules

The prompt encodes several domain-specific rules that took real-world iteration to discover:

- **GA4 ecommerce events** (`add_to_cart`, `purchase`, etc.) must nest fields under an `ecommerce` key, preceded by `dataLayer.push({ ecommerce: null })`. Without this rule, Claude would put `currency` and `value` at the top level, breaking GA4 attribution.
- **PII detection** — any mention of email/name/phone in the brief triggers a `pii_risk: true` flag and a `pii_mitigation` field, ensuring compliance review.
- **Form events** automatically get `form_id` and `form_name` parameters.
- **Video events** automatically get `video_title`, `video_percent`, `video_provider`.

These aren't generic patterns — they're learned constraints from production analytics work. Iterate the prompt with your own learned constraints when you fork.

---

## Validation gates

The agent validates its own output at three levels before exiting successfully.

### Gate 1: Parseable YAML

If Claude returns malformed YAML, the agent prints the raw output to stderr and exits 1. The workflow then fails loud — no broken spec ever lands in `specs/`.

### Gate 2: Required fields present

```javascript
const requiredFields = config.spec.required_fields;
const missing = requiredFields.filter(f => !(f in parsedSpec));
if (missing.length > 0) {
  console.error(`[spec-generator] ✗ Generated spec is missing required fields: ${missing.join(', ')}`);
  process.exit(1);
}
```

The required fields list is read from `pipeline.config.yaml`, not hardcoded. Teams can change what's required by editing the config.

### Gate 3: Status is in the allowlist

```javascript
if (!config.spec.allowed_statuses.includes(parsedSpec.status)) {
  console.error(`[spec-generator] ✗ Invalid status "${parsedSpec.status}". Allowed: ${config.spec.allowed_statuses.join(', ')}`);
  process.exit(1);
}
```

This catches Claude hallucinating non-standard statuses (e.g., "ready" instead of "draft").

### Beyond the agent — the linter

The Spec Lint workflow (`scripts/linter/spec-linter.js`) runs additional checks against `conventions.yaml`:
- Event names match snake_case
- Parameter names follow naming rules
- `spec_id` matches the SPEC-YYYY-NNN-name regex
- Platform and priority are in their respective allowlists

The agent's validation catches structural issues; the linter catches convention violations. Two layers of defense.

---

## Configuration

Every tunable behavior lives in `pipeline.config.yaml` under the `agents.spec_generator` and `spec` sections. Edit the YAML, not the JS.

| Config key | Purpose | Example |
|---|---|---|
| `agents.spec_generator.model` | Claude model to use | `claude-sonnet-4-20250514` |
| `agents.spec_generator.max_tokens` | Response length cap | `4096` |
| `agents.spec_generator.temperature` | Determinism (0.0–1.0) | `0.2` |
| `spec.id_prefix` | Spec ID prefix | `SPEC` |
| `spec.sequence_digits` | Zero-padding for sequence number | `3` |
| `spec.include_event_slug` | Append `-{event_name}` to spec_id | `true` |
| `spec.required_fields` | Fields the generator must produce | `[spec_id, status, events, ...]` |
| `spec.allowed_statuses` | Valid `status` values | `[draft, approved, deprecated]` |
| `paths.generator_prompt` | Where to load the system prompt from | `agents/spec-generator/prompt.md` |
| `generator.tag` | Value to write into `generated_by` | `claude-api` |

### CLI flags

```
--brief-file <path>   Required. Path to the feature brief Markdown file.
--sequence <number>   Optional. Override the default sequence number used
                      in spec_id examples shown to Claude.
```

### Environment variables

| Variable | Required | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Main Claude call |
| `VOYAGE_API_KEY` | ⬜ | RAG retrieval — graceful skip if missing |

---

## Local development

The agent can be run locally for testing without burning CI minutes:

```bash
cd web-tracking-cicd

# Install agent deps
cd agents/spec-generator
npm install
cd ../..

# Set API keys
export ANTHROPIC_API_KEY=sk-ant-...
export VOYAGE_API_KEY=vk-...

# Run against an existing brief — output goes to stdout
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md

# Save to a file
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md > /tmp/spec.yaml

# See progress logs (always written to stderr)
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md 2> /tmp/logs.txt > /tmp/spec.yaml
```

### Iterating on the prompt

The fastest feedback loop for prompt tuning:

1. Edit `agents/spec-generator/prompt.md`
2. Run against an existing brief locally
3. Inspect the YAML output
4. Tweak prompt, re-run

No PR or CI run needed until you're happy. Iteration cycle is ~10 seconds.

### Testing the RAG path

To verify RAG is actually firing and influencing the output:

```bash
# Run without VOYAGE_API_KEY to see baseline output
unset VOYAGE_API_KEY
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md > /tmp/no-rag.yaml

# Run with RAG enabled
export VOYAGE_API_KEY=vk-...
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md > /tmp/with-rag.yaml

# Diff to see how retrieval shaped the output
diff /tmp/no-rag.yaml /tmp/with-rag.yaml
```

Differences in parameter naming, dataLayer structure, or acceptance criteria phrasing are evidence that RAG retrieved relevant context.

---

## Customizing for your taxonomy

If you're forking this repo for a different analytics setup (different naming rules, different required fields, different ecommerce model), here's the recommended editing order:

**1. Edit `conventions/conventions.yaml`** — your taxonomy lives here. The agent will pick up changes automatically through `conventions_reader.js`.

**2. Edit `pipeline.config.yaml`** — required fields, allowed statuses, spec_id format, model choice. No code changes needed.

**3. Edit `agents/spec-generator/prompt.md`** — only for behaviors that aren't expressible in the conventions or config:
- New domain-specific rules (e.g., a healthcare-specific HIPAA flag)
- New event categories (e.g., "all video events must include `media_session_id`")
- Output formatting tweaks

**4. Re-index the RAG store** — after changing conventions, re-embed all existing specs so the new context is reflected:
```bash
node agents/spec-generator/rag/index.js --force
```

**5. Test against multiple briefs** — generate against 3–5 representative briefs locally before committing prompt changes.

The architecture is deliberately layered so that 80% of customization happens in YAML, not JavaScript.

---

## Known issues

- **Package name lag** — `package.json` still says `analytics-cicd-spec-generator` from before the repo rename to `web-tracking-cicd`. Cosmetic only; doesn't affect functionality. Cleanup item.
- **Hardcoded model in some paths** — most behavior is config-driven but a few values (Voyage model name, API version header) are still hardcoded. Pulling them into `pipeline.config.yaml` is on the backlog.

---

## Related documentation

- [`rag/README.md`](./rag/README.md) — deep dive on the RAG layer
- [`../README.md`](../README.md) — overview of all 5 agents
- [`../../.github/workflows/README.md`](../../.github/workflows/README.md) — the workflows that invoke this agent (`generate-spec.yml`, `index-specs.yml`)
- [`../../conventions/README.md`](../../conventions/README.md) — the conventions rulebook
- [`../../lib/config-reader.js`](../../lib/config-reader.js) — the shared config loader
