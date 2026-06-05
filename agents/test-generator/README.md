# `agents/test-generator/` — Spec → Playwright Tests

Reads a merged analytics spec YAML and generates one Playwright test file per event. The generated tests assert that `window.dataLayer` contains the expected event with the expected parameters when the trigger condition is met.

These are the tests that get executed by `validate-datalayer.yml` against a live staging or production URL. They are the pipeline's **final factual check** — the only place where machine-generated assertions meet a real browser and a real dataLayer.

---

## Table of contents

- [What it does](#what-it-does)
- [Inputs and outputs](#inputs-and-outputs)
- [The test structure every file follows](#the-test-structure-every-file-follows)
- [File-by-file walkthrough](#file-by-file-walkthrough)
- [How tests get executed](#how-tests-get-executed)
- [Prompt design](#prompt-design)
- [Configuration](#configuration)
- [Local development](#local-development)
- [The interaction-events limitation](#the-interaction-events-limitation)
- [Known issues](#known-issues)

---

## What it does

Given a merged spec like `specs/SPEC-2026-005-remove_from_cart.yaml`, this agent produces one `.spec.js` file per event:

```js
// playwright-datalayer-tests/remove_from_cart.spec.js
import { test, expect } from '@playwright/test';

async function waitForDataLayerEvent(page, eventName, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((name) => {
      return (window.dataLayer || []).find(e => e.event === name) || null;
    }, eventName);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  throw new Error(`dataLayer event "${eventName}" not found within ${timeoutMs}ms`);
}

test.describe('remove_from_cart', () => {
  let eventPayload;

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.TEST_URL);
    await page.locator('[data-testid="remove-item-btn"]').click();
    eventPayload = await waitForDataLayerEvent(page, 'remove_from_cart');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event not found').toBeTruthy();
  });

  test('ecommerce.currency is a non-empty string', async () => {
    expect(
      typeof eventPayload.ecommerce?.currency === 'string' && eventPayload.ecommerce.currency.length > 0,
      `expected string, got ${typeof eventPayload.ecommerce?.currency}`
    ).toBe(true);
  });

  // ... one test per parameter
});
```

Every test file is self-contained and runnable with `npx playwright test`. No shared imports, no helper modules. Each file carries its own `waitForDataLayerEvent` helper so it can be moved, copied, or run individually without any setup.

---

## Inputs and outputs

### Inputs

| Input | Source | Purpose |
|---|---|---|
| Spec YAML | Positional CLI arg | The structured event definition |
| System prompt | `agents/test-generator/prompt.md` | Test structure rules + assertion patterns |
| `TEST_URL` env var | Runtime (set by `validate-datalayer.yml`) | The URL each test navigates to |

### Outputs

| Output | Destination | Format |
|---|---|---|
| Per-event test files | `playwright-datalayer-tests/<event_name>.spec.js` | Self-contained ES modules |
| Status logs | `stdout` | Progress per event |
| Exit code | Process | `0` if all events succeed, `1` if any fail |

Note: unlike the other agents, this one writes logs to `stdout` (not `stderr`). It's a minor inconsistency — the other agents reserve stdout for clean output, this one is verbose. Doesn't matter operationally since this agent's "real" output is files on disk, not piped text.

---

## The test structure every file follows

The prompt enforces a strict, predictable structure. Every generated file has:

| Block | Purpose |
|---|---|
| `import { test, expect } from '@playwright/test'` | The only import — never any other dependency |
| `waitForDataLayerEvent()` helper | Polling helper, inlined into every file |
| `getAllDataLayerEvents()` helper | For duplicate/no-duplicate assertions |
| `test.describe('event_name', ...)` | One describe block per event — only one |
| `test.beforeEach()` | Navigate, trigger, capture event payload |
| Multiple `test()` blocks | One assertion per test: event presence, name, each parameter, business rules |

**Why inline helpers in every file?**

Two reasons:
1. **Portability** — any test file can be lifted out and run standalone. No need to think about relative imports or shared modules.
2. **Independence** — changing a helper in one file never accidentally breaks another file. Each event's tests evolve at its own pace.

The downside is duplication. The upside is zero coupling between event tests, which matters when you have 50+ tests running in parallel against live URLs.

### One assertion per test

Each `test()` block tests **exactly one thing**:

```js
test('event fires', ...);
test('event name matches', ...);
test('ecommerce.currency is a non-empty string', ...);
test('ecommerce.value is a number', ...);
test('ecommerce.items has at least one item', ...);
test('does not duplicate on page reload', ...);  // business rule
```

Why not one test asserting many things? Because Playwright reports per-test pass/fail, and a developer debugging a tracking issue wants to see exactly *which* parameter failed — not "the event broke somehow." Granular tests make the dataLayer report self-explanatory.

---

## File-by-file walkthrough

```
test-generator/
├── run.js          ← Main entry — one Claude call per event in the spec
├── prompt.md       ← System prompt — defines the Playwright test structure
├── prompt.mdes     ← ⚠ Stale duplicate of prompt.md, NOT loaded — cleanup item
└── package.json    ← Dependencies (@anthropic-ai/sdk, js-yaml)
```

### `run.js`

Orchestration in four phases:

1. **Parse args** — takes the spec path as a positional argument (`node run.js <spec>`)
2. **Load + sanitize the spec** — same `NEEDS_CLARIFICATION:` regex pattern as other agents
3. **Loop sequentially over `spec.events`** — one Claude API call per event
4. **Strip markdown fences** — Claude occasionally wraps output in ```` ```javascript ```` even when told not to; the agent strips it defensively
5. **Write each file** — to `playwright-datalayer-tests/<event_name>.spec.js`

**One thing different from the other agents:** this one uses the official `@anthropic-ai/sdk` package instead of native `fetch()`. It works fine but introduces a dependency the other agents don't need. Switching it to `fetch()` for consistency is on the cleanup list.

**The Claude prompt format:** for each event, the user message is:

```
Generate a complete Playwright test file for the following GA4 analytics event spec.

## Spec (YAML)
```yaml
event:
  name: remove_from_cart
  trigger: ...
  parameters: ...
  dataLayer: ...
```

Requirements:
- Output only valid JavaScript, no markdown, no preamble.
- The test file must be self-contained and runnable with `npx playwright test`.
- Read `process.env.TEST_URL` as the base URL.
- Follow all rules in the system prompt exactly.
```

Note that the spec for the **single event** is wrapped in `{ event: eventSpec }` — Claude sees only the event being tested, not the entire spec. This isolation prevents cross-event contamination when a spec has multiple events.

### `prompt.md`

The system prompt that defines the Playwright test structure. The most opinionated prompt of any agent in the pipeline because Playwright code has many viable styles and we want **one** style.

Hardcoded rules include:

- **Import `@playwright/test` only** — no other dependencies, period
- **Inline `waitForDataLayerEvent()` helper** — the prompt provides the canonical implementation
- **`page.evaluate()` to read `window.dataLayer`** — not `page.exposeFunction` or other patterns
- **Always poll, never assume synchronous** — many dataLayer pushes happen asynchronously
- **Use `process.env.TEST_URL` directly** — never append paths
- **One `describe` per event, one `test` per assertion** — the granular structure described above
- **Every `expect()` takes a descriptive second-argument message** — so failures self-explain
- **Never output `test.skip()`** — if an event can't be tested for some reason, generate a real test anyway with a `// TODO:` comment

The prompt also handles **two YAML parameter formats** because specs in this repo have evolved over time and both shapes exist in the wild:

```yaml
# Format A — flat map (used by older specs):
parameters:
  page_type: "DL - page_type"

# Format B — array of objects (preferred):
parameters:
  - name: page_type
    type: string
    required: true
```

The generated test handles both because the spec linter doesn't yet enforce one format.

### `prompt.mdes` — leftover cleanup item

A stale duplicate of `prompt.md` from an earlier version. **Not loaded by any code** — `run.js` only reads `prompt.md`. Should be deleted in a small chore PR. It's confusing on `ls` but harmless functionally.

### `package.json`

Two dependencies:
- `@anthropic-ai/sdk@^0.39.0` — the only agent in this repo using the official SDK
- `js-yaml@^4.1.0` — the only agent using `js-yaml` (others use `yaml`)

Why the inconsistency? Historical accident. This agent was written first as a proof of concept and never harmonized with later agents. Both libraries work; aligning them is on the cleanup list.

---

## How tests get executed

The generated `.spec.js` files are **not** run by this agent. They are committed to `playwright-datalayer-tests/` and executed later by the `Validate dataLayer` workflow.

```
Spec merges to main
    ↓
generate-tests.yml fires
    ↓
test-generator/run.js writes .spec.js file
    ↓
file committed to playwright-datalayer-tests/
    ↓
[time passes]
    ↓
Someone manually triggers validate-datalayer.yml
    ↓
Workflow installs Playwright, runs `npx playwright test`
    ↓
Tests assert against the live URL
    ↓
Pass/fail reported in workflow summary
```

The test generator's only job is **production of valid test files**. Execution and reporting are separate concerns handled by `validate-datalayer.yml`.

For the validation workflow details, see [`.github/workflows/README.md`](../../.github/workflows/README.md#10-validate-datalayer--validate-datalayeryml).

---

## Prompt design

Three design principles shape `prompt.md`:

**1. One style, ruthlessly enforced.** Playwright has many ways to structure a test. The prompt picks one (inline helpers, one assertion per test, polling for events) and rejects all others. Consistency across files makes debugging easier than flexibility.

**2. Self-contained files.** Every test file is independently runnable. No shared helpers, no relative imports. The duplication cost is low; the maintainability win is high.

**3. Errors must self-explain.** Every `expect()` carries a descriptive message. When a CI run fails, the failure message tells you exactly which parameter, which value, and what was expected — no spelunking through code required.

---

## Configuration

### CLI args

```
node run.js <path-to-spec.yaml>
```

Positional argument. Unlike the other agents which use `--spec <path>`, this one takes the path as the first positional arg. Inconsistency on the cleanup list.

### Environment variables

| Variable | Required | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | The Claude API call |
| `TEST_URL` | At test-execution time only | The URL each generated test navigates to (set by `validate-datalayer.yml`) |

### Hardcoded in `run.js`

| Constant | Value | Notes |
|---|---|---|
| `MODEL` | `claude-opus-4-5` | Should be in `pipeline.config.yaml` |
| `MAX_TOKENS` | `4096` | Should be in `pipeline.config.yaml` |
| `OUTPUT_DIR` | `playwright-datalayer-tests/` | Reasonable default, unlikely to need changing |

---

## Local development

```bash
cd web-tracking-cicd

# Install agent deps
cd agents/test-generator
npm install
cd ../..

# Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# Generate tests for one spec
node agents/test-generator/run.js specs/SPEC-2026-005-remove_from_cart.yaml

# Inspect output
cat playwright-datalayer-tests/remove_from_cart.spec.js

# Run the generated test locally (requires Playwright installed)
npx playwright install chromium
TEST_URL=http://localhost:3000 npx playwright test playwright-datalayer-tests/remove_from_cart.spec.js
```

### Iterating on the prompt

The fastest feedback loop:

1. Edit `agents/test-generator/prompt.md`
2. Run against an existing spec locally
3. Open the generated `.spec.js` and inspect for structure/correctness
4. Tweak prompt, re-run

Per-event cost is ~$0.05–0.10. A 3-event spec costs ~$0.20 to regenerate.

**Tip:** to verify a generated test actually works without spinning up infrastructure, use a public test site:

```bash
TEST_URL=https://example.com npx playwright test playwright-datalayer-tests/page_view.spec.js
```

The test will fail (example.com has no dataLayer), but you'll see whether the test file is **syntactically valid** and **runnable** — which is the agent's job. Actual pass/fail belongs to the validation workflow.

---

## The interaction-events limitation

This is the **single most important caveat** about this agent.

The system prompt explicitly says interaction events (clicks, form submits) should produce real tests with `page.locator(...).click()` calls. And for simple cases — a button with a stable selector — it does.

But for events that require complex state setup (logged-in user, items already in cart, multi-step flow), the agent has no way to know what setup is needed. It generates a test that fires the action, but the action fails because preconditions aren't met. The test file is **syntactically valid** but **functionally broken**.

In practice this means:

| Event type | Test quality |
|---|---|
| `page_view`, `app_load` (no interaction) | ✅ Good — just navigate and assert |
| Simple `click` on a stable selector | ✅ Mostly good |
| `add_to_cart` requiring product page state | ⚠ Often broken — assumes a context that doesn't exist |
| `purchase` requiring multi-step checkout | ❌ Almost always broken |
| `form_submit` requiring valid form data | ⚠ Often broken |

The roadmap includes a **"live inspector" mode** where the analyst captures a real browser session, and the agent generates tests grounded in actual observed dataLayer pushes. Until then, treat interaction-event tests as **drafts that need human review** rather than ready-to-run.

This is tracked as **Bug #8** in the project backlog.

---

## Known issues

- **`prompt.mdes` typo file** — stale duplicate of `prompt.md`, not loaded, should be deleted
- **Inconsistent CLI shape** — uses positional arg `<spec>` instead of `--spec <path>` like other agents
- **Inconsistent SDK choice** — only agent using `@anthropic-ai/sdk` (others use native `fetch()`)
- **Inconsistent YAML library** — only agent using `js-yaml` (others use `yaml`)
- **Hardcoded model and max_tokens** — should be in `pipeline.config.yaml`
- **`results.failed.push(eventSpec.event_name)`** — events use `name`, not `event_name`. The failure summary will print `undefined` instead of the event name. Minor cosmetic bug
- **Logs to stdout instead of stderr** — inconsistent with other agents
- **Interaction-event tests often broken** — see "The interaction-events limitation" above

None of these block the pipeline. They are accumulation of historical inconsistencies that should be ironed out in a future harmonization PR.

---

## Related documentation

- [`../README.md`](../README.md) — overview of all 5 agents
- [`../../.github/workflows/README.md`](../../.github/workflows/README.md) — `generate-tests.yml` (creates files) and `validate-datalayer.yml` (executes them)
- [`../spec-generator/README.md`](../spec-generator/README.md) — the upstream agent whose output this consumes
- [`../../playwright-datalayer-tests/`](../../playwright-datalayer-tests/) — the live output of this agent
- [`../../playwright.config.js`](../../playwright.config.js) — repo-wide Playwright config used at execution time
