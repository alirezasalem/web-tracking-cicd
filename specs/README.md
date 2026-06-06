# `specs/` — The Contract Layer

Every YAML file in this folder is a **single source of truth** for one set of analytics events. Specs are the contract between PMs (who decide *what* to track), analysts (who design *how* to track it), and engineers (who *implement* it).

Every other piece of this pipeline reads from or writes to this folder:

- The **spec-generator** writes new specs here from feature briefs
- The **spec linter** validates everything here against `conventions/conventions.yaml`
- The **schema-guardian** detects drift between this folder and `schema-baseline.json`
- The **tracking-concept-generator** reads specs here and produces docs in `tracking-concepts/`
- The **test-generator** reads specs here and produces Playwright tests
- The **gtm-generator** reads specs here and produces GTM container exports
- The **RAG indexer** reads specs here and updates `data/spec-index.json`

If you only read one folder in this repo to understand the system, read this one.

---

## Table of contents

- [Why specs as YAML](#why-specs-as-yaml)
- [Filename and `spec_id` format](#filename-and-spec_id-format)
- [The minimum required structure](#the-minimum-required-structure)
- [Full field reference](#full-field-reference)
- [Event structure](#event-structure)
- [Parameter notation styles](#parameter-notation-styles)
- [Special values](#special-values)
- [Lifecycle of a spec](#lifecycle-of-a-spec)
- [Validation rules](#validation-rules)
- [Editing existing specs](#editing-existing-specs)
- [Known schema drift](#known-schema-drift)

---

## Why specs as YAML

Three things make YAML the right format for this contract:

**1. Humans can read and write it without tools.** A PM glancing at a spec PR can comment on a parameter name without learning a DSL.

**2. Machines can parse it without ambiguity.** Every downstream agent — codegen, linter, schema diff, RAG indexer — consumes the spec via a standard YAML parser. No bespoke format = no bespoke parser bugs.

**3. Git treats it correctly.** YAML diffs cleanly in pull requests. Adding a parameter shows up as a single-line addition, not a noisy reformatting. Review is trivial.

Why not JSON? JSON has no comments, no anchors, and forces verbose syntax for nested structures. For human-edited contracts, YAML wins.

Why not a database? Then the contract would live somewhere only accessible to a few people, with no diffability, no PR review, no rollback. The whole point of "tracking as code" is that **the spec lives in version control** alongside the application code that implements it.

---

## Filename and `spec_id` format

Every spec follows the pattern:

```
SPEC-{YEAR}-{NNN}-{event_name_slug}.yaml
```

| Segment | Example | Meaning |
|---|---|---|
| `SPEC` | `SPEC` | Static prefix (from `pipeline.config.yaml → spec.id_prefix`) |
| `YEAR` | `2026` | The year the spec was generated |
| `NNN` | `005` | Zero-padded sequence number; resets each year |
| `event_name_slug` | `remove_from_cart` | snake_case version of the primary event name |

So `SPEC-2026-005-remove_from_cart.yaml` means *"the 5th spec generated in 2026, primarily for the remove_from_cart event."*

The **filename and the `spec_id` field inside the file must match exactly** (minus the `.yaml` extension). The spec-generator workflow enforces this by patching the file after generation; the linter enforces it for any human edits.

### Why include the event slug in the filename?

A `spec_id` of `SPEC-2026-005` would be opaque. Including the event makes the folder grep-friendly:

```bash
ls specs/ | grep cart        # find all cart-related specs
grep -l "purchase" specs/    # find all specs that mention purchase
```

The full filename also acts as a small piece of documentation — you can tell what a spec is about without opening it.

### Multi-event specs

If a spec defines multiple events, the slug uses the **primary event** — typically the first one declared. For example, a spec covering `begin_checkout`, `add_shipping_info`, and `add_payment_info` would be named `SPEC-2026-007-begin_checkout.yaml`.

This is a convention, not a hard rule. The linter doesn't currently enforce a "primary event" concept; the convention is documented here so generated names stay predictable.

---

## The minimum required structure

Every spec MUST have these top-level fields (`pipeline.config.yaml → spec.required_fields`):

```yaml
spec_id: SPEC-2026-006-newsletter_signup
version: 1.0.0
status: draft
owner: Product Analytics Team
feature_brief_ref: FB-006
generated_by: claude-api
created_at: 2026-06-04
events:
  - name: newsletter_signup
    trigger:
      action: form_submit
      selector: "#newsletter-form"
      page_path: "/"
    parameters:
      signup_location: "DL - signup_location"
    dataLayer:
      event: newsletter_signup
      signup_location: "{{DL - signup_location}}"
```

A spec missing any of these required fields fails the linter and **cannot merge**.

---

## Full field reference

### Top-level required fields

| Field | Type | Example | Notes |
|---|---|---|---|
| `spec_id` | string | `SPEC-2026-005-remove_from_cart` | Must match filename minus `.yaml` |
| `version` | string | `1.0.0` | Semantic version. Starts at `1.0.0`. Bumped by analyst on intentional updates |
| `status` | string | `draft` | One of: `draft`, `review`, `approved`, `deprecated` |
| `owner` | string | `Product Analytics Team` | Team or individual responsible. **Required** — if unknown at generation, will be `NEEDS_CLARIFICATION:...` |
| `feature_brief_ref` | string | `FB-006` | Identifier of the source brief that produced this spec |
| `generated_by` | string | `claude-api` | Identifier of the generator. Either `claude-api` (from spec-generator) or `human` (hand-written) |
| `created_at` | date or datetime | `2026-06-04` | ISO 8601 date or full timestamp |
| `events` | array | (see below) | At least one event. Most specs have 1–3 |

### Top-level optional fields

These appear on richer specs but aren't required by the linter:

| Field | Type | Example | Notes |
|---|---|---|---|
| `title` | string | `Add to Cart Tracking Implementation` | Human-readable name. Used in PR titles and docs |
| `platform` | string | `web` | One of: `web`, `ios`, `android`, `cross_platform` |
| `priority` | string | `P0` | One of: `P0`, `P1`, `P2`, `P3` |
| `updated_at` | date or datetime | `2026-06-04` | Last modification timestamp |
| `acceptance_criteria` | array of strings | (see existing specs) | Plain-English requirements for what "done" looks like |

The optional fields are recommended for new specs. The linter doesn't enforce them today, but a future stricter mode might. Existing specs that lack them are not retroactively required to add them.

---

## Event structure

Every entry in the `events` array represents one analytics event. Each event has this structure:

```yaml
events:
  - name: remove_from_cart           # snake_case, required
    description: "..."                # optional but recommended
    trigger:                          # how/when the event fires — required
      action: button_click
      selector: "[data-testid='remove-item-btn']"
      page_path: /cart
    parameters:                       # what data is sent — required (see notation styles below)
      # ... parameter definitions
    dataLayer:                        # the actual runtime payload — required
      event: remove_from_cart
      ecommerce:
        currency: "{{DL - currency}}"
        # ...
    ga4_mapping:                      # optional, but recommended
      event_name: remove_from_cart
      custom_dimensions:
        cd_user_segment: "{{DL - user_segment}}"
    gtm_notes: "..."                  # optional analyst guidance for GTM setup
    notes: "..."                      # optional implementation notes
```

### `name`

The event name as it will appear in `dataLayer.event` and GA4. **Must be snake_case.** Examples: `page_view`, `add_to_cart`, `newsletter_signup`. Never `pageView`, `Add-To-Cart`, or `addtocart`.

### `trigger`

Three sub-fields describe *when* the event fires:

| Sub-field | Type | Example | Meaning |
|---|---|---|---|
| `action` | string | `page_load`, `button_click`, `form_submit`, `custom` | The user/system action |
| `selector` | string or `null` | `"[data-testid='remove-btn']"` | CSS selector for interaction events. `null` for non-DOM triggers |
| `page_path` | string | `/cart`, `/products/*`, `*` | URL path. `*` means any path; wildcards allowed |

### `parameters`

The event's input parameters. This block has two valid notation styles that exist in current specs — see [Parameter notation styles](#parameter-notation-styles) below.

### `dataLayer`

The **runtime payload** — what `window.dataLayer.push()` will actually receive. This block is the source of truth that `gtm-generator` reads to produce GTM variables (see [`agents/gtm-generator/README.md`](../agents/gtm-generator/README.md#the-datalayer-block-convention)).

For GA4 ecommerce events (`add_to_cart`, `purchase`, `remove_from_cart`, etc.), the convention is:

```yaml
dataLayer:
  event: add_to_cart
  ecommerce:
    currency: "{{DL - currency}}"
    value: "{{DL - price}}"
    items:                        # GA4 standard — see "Known schema drift" below
      - item_id: "{{DL - product_id}}"
        item_name: "{{DL - product_name}}"
        # ...
```

GA4 requires ecommerce fields nested under an `ecommerce` key, with `items` as the array of products. The agent prompts and codegen enforce this where they can.

### `ga4_mapping` *(optional)*

Tells GA4-specific generators how to wire up the event. Two main sub-fields:

- `event_name` — the GA4 event name (usually identical to the event `name` above)
- `custom_dimensions` — map of `cd_*` names to dataLayer values. The `cd_` prefix is enforced by the linter

### `gtm_notes`, `notes`

Free-text guidance for analysts and engineers. `gtm_notes` should focus on GTM setup specifics (trigger types, custom JS variables); `notes` is more general implementation guidance.

---

## Parameter notation styles

This is the most important variation between specs in the current repo. There are **two valid notation styles** for the `parameters` block:

### Style A — Label notation (older specs)

```yaml
parameters:
  page_location: "DL - page_location"
  page_referrer: "DL - page_referrer"
```

Each parameter is a key-value pair. The value is a **label** referring to a GTM dataLayer variable. The format `"DL - <name>"` means *"the GTM dataLayer variable named '<name>'."*

This style is **compact** and used by older specs. It says nothing about type, requiredness, or example values — those are documented elsewhere or inferred.

### Style B — Structured notation (newer specs)

```yaml
parameters:
  - name: currency
    type: string
    required: true
    example: "USD"
  - name: value
    type: currency
    currency_param: currency
    required: true
    example: 29.99
  - name: items
    type: array
    required: true
    example:
      - item_id: "SKU123"
        item_name: "Sample Product"
        price: 29.99
        quantity: 1
```

Each parameter is an object with explicit fields:
- `name` — the parameter name
- `type` — `string`, `number`, `currency`, `boolean`, `array`, `object`
- `required` — `true` or `false`
- `example` — a realistic example value
- `description` — optional prose
- `currency_param` *(for `currency` type)* — names the sibling parameter that holds the currency code

This style is **richer** and makes types/requiredness machine-readable. It's the format the spec-generator now produces.

### Why both styles exist

The repo's specs were written across two different prompt iterations. The schema-guardian and gtm-generator both handle both formats. The linter accepts both. New specs should use Style B; existing specs in Style A don't need migration unless they're being substantially edited anyway.

**The agents handle this variance gracefully** because the linter and codegen were designed around the inconsistency. See `agents/test-generator/prompt.md` for an example of how an agent handles both shapes.

---

## Special values

### `NEEDS_CLARIFICATION:` placeholders

When the spec-generator can't confidently infer a field from the brief, it emits this special placeholder:

```yaml
owner: NEEDS_CLARIFICATION: team or person accountable for this spec
trigger:
  page_path: NEEDS_CLARIFICATION: which pages does this event apply to
```

These placeholders:

- **Surface ambiguity to the analyst** at PR review time, exactly where human judgment is needed
- **Are detected by every agent** that consumes the spec — codegen warns; the linter flags them
- **Block merge if any remain in the spec** when the linter's `require_no_clarification_placeholders` flag is enabled (currently a soft warning, may be hardened later)

The placeholder is the agent's honest admission of "I don't know." It is **always preferable to a plausible-but-wrong default**. When you see one in a PR, the only correct action is to replace it with the right value — never to delete it.

### Templated values

Inside the `dataLayer` and `ga4_mapping` blocks, values like `"{{DL - product_id}}"` are **GTM-style variable references**. They tell the consumer "at runtime, this value comes from the GTM dataLayer variable named 'DL - product_id'."

These templates are passed through verbatim by the codegen. The actual substitution happens in GTM at runtime, not in the pipeline.

### Wildcards in `page_path`

```yaml
page_path: /products/*       # matches /products/anything
page_path: "*"               # matches any path
page_path: /cart             # matches exactly /cart
```

Wildcards use simple glob semantics. There's no current support for regex patterns.

---

## Lifecycle of a spec

```
1. PM commits feature-briefs/FB-006.md
                ↓
2. generate-spec.yml fires → spec-generator writes specs/SPEC-2026-006-*.yaml
                ↓
3. Auto-PR opens (branch: auto-spec/FB-006)
                ↓
4. Spec Lint + Schema Drift run against the new spec
                ↓
5. Analyst reviews:
   • Resolves any NEEDS_CLARIFICATION: placeholders
   • Bumps version if needed
   • Edits naming, parameters, acceptance criteria
                ↓
6. Analyst merges to main (status: draft)
                ↓
7. On merge, four parallel artifacts generate:
   • tracking-concepts/*.md
   • playwright-datalayer-tests/*.spec.js
   • gtm-assets/*.json
   • data/spec-index.json (re-embedded)
                ↓
8. Schema baseline updates → future PRs compare against this spec
                ↓
9. Status transitions over time:
   draft → review → approved → (eventually) deprecated
```

The status transitions are managed by analysts. The pipeline doesn't auto-promote a spec from `draft` to `approved`; that requires explicit human action via a PR.

---

## Validation rules

The Spec Lint workflow (`scripts/linter/spec-linter.js`) enforces these rules on every PR:

| Rule | What it checks | Configurable via |
|---|---|---|
| **Required fields present** | All fields in `spec.required_fields` exist | `pipeline.config.yaml → spec.required_fields` |
| **Valid status** | `status` is in the allowed list | `pipeline.config.yaml → spec.allowed_statuses` |
| **Filename matches `spec_id`** | The filename (minus `.yaml`) equals `spec_id` | Hardcoded |
| **`spec_id` format** | Matches `SPEC-YYYY-NNN-event_slug` | `pipeline.config.yaml → spec.*` |
| **Event names are snake_case** | Each `events[*].name` matches `^[a-z][a-z0-9_]*$` | `conventions/conventions.yaml` |
| **Custom dimensions have `cd_` prefix** | Keys in `ga4_mapping.custom_dimensions` start with `cd_` | `conventions/conventions.yaml` |
| **Platform is allowed** | If present, in `[web, ios, android, cross_platform]` | `conventions/conventions.yaml` |
| **Priority is allowed** | If present, in `[P0, P1, P2, P3]` | `conventions/conventions.yaml` |

A spec failing any rule fails the workflow. Branch protection blocks merge until the spec is fixed.

**The Schema Drift check** (`schema-drift.yml`) is a separate gate — it doesn't validate format, it detects whether the spec **breaks the existing schema baseline**. See [`agents/schema-guardian/README.md`](../agents/schema-guardian/README.md).

---

## Editing existing specs

Specs are first-class source files. Edit them like any other code:

1. Branch off main
2. Edit the YAML file
3. Open a PR
4. Spec Lint + Schema Drift run automatically
5. If you removed or renamed a parameter, Schema Drift will fail the PR

### When to bump the version

| Change | Version bump |
|---|---|
| Adding an optional parameter | Patch: `1.0.0` → `1.0.1` |
| Adding a required parameter, renaming a parameter, removing a parameter | Minor: `1.0.0` → `1.1.0` |
| Adding/removing events from the spec | Minor: `1.0.0` → `1.1.0` |
| Changing the event name itself | Major: `1.0.0` → `2.0.0` (or arguably a new spec) |

The linter doesn't enforce versioning today — it's an analyst convention. But Schema Drift will block PRs that remove fields without intentional baseline updates, which is the stronger gate in practice.

### When to deprecate a spec

If an event is being removed from the product entirely:

1. Change `status` from `approved` to `deprecated`
2. Add a `deprecated_at` field with the date
3. Add a `deprecated_reason` field explaining why
4. Open the PR — the spec stays in `specs/` for reference

Don't delete deprecated specs. They're historical record. Deletion would also trigger a breaking change in Schema Drift, requiring an intentional baseline reset.

---

## Known schema drift

A few inconsistencies exist between specs in the current repo. They're documented here so they aren't surprising:

### `items` vs `products` in ecommerce arrays

GA4's standard is `items` (used in `remove_from_cart`). But `add_to_cart.yaml` uses `products`. This is a real drift the linter doesn't yet catch:

```yaml
# add_to_cart — uses "products" (non-standard)
dataLayer:
  ecommerce:
    products:
      - item_id: "..."

# remove_from_cart — uses "items" (GA4 standard)
dataLayer:
  ecommerce:
    items:
      - item_id: "..."
```

Cleanup is on the roadmap. The flatten-keys-based drift detector (see `agents/schema-guardian/README.md`) will catch this once an intentional migration PR happens.

### Two parameter notation styles

Older specs use the flat `"DL - x"` label style; newer specs use the structured `{ name, type, required, example }` style. Both are valid. See [Parameter notation styles](#parameter-notation-styles) above.

### `feature_brief_ref` format variance

Some specs use descriptive references (`FB-page-view-tracking`); newer specs use the canonical numeric form (`FB-006`). Newer briefs all follow the numeric form; older specs haven't been retroactively updated.

---

## Example specs in this folder

For a complete, real-world example, see [`SPEC-2026-002-add_to_cart.yaml`](./SPEC-2026-002-add_to_cart.yaml).

For the simplest minimal example, see [`SPEC-2026-001-page_view.yaml`](./SPEC-2026-001-page_view.yaml).

For an example with `NEEDS_CLARIFICATION:` placeholders in the wild and Style B notation, see [`SPEC-2026-005-remove_from_cart.yaml`](./SPEC-2026-005-remove_from_cart.yaml).

---

## Related documentation

- [`../conventions/`](../conventions/) — the naming rulebook the linter enforces (separate README pending)
- [`../agents/spec-generator/README.md`](../agents/spec-generator/README.md) — the agent that writes specs
- [`../agents/schema-guardian/README.md`](../agents/schema-guardian/README.md) — the agent that detects schema drift
- [`../scripts/linter/`](../scripts/linter/) — the linter that enforces validation rules (separate README pending)
- [`../pipeline.config.yaml`](../pipeline.config.yaml) — where most spec rules are configured
- [`../feature-briefs/`](../feature-briefs/) — the PM-written briefs that produce specs (separate README pending)
