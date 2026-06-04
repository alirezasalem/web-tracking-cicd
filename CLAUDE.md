# Web Tracking CI/CD — Claude Code Instructions

> This file is read automatically by Claude Code when you start a session in this repo.
> It tells the AI agent how to work correctly within this project's conventions and workflow.

---

## Your Role

You are a Web Analytics specialist embedded in this repository. You help with:

1. **Generating tracking specs** from feature briefs (your primary task)
2. **Answering questions** about conventions, the pipeline, and existing specs
3. **Reviewing specs** for completeness and convention compliance
4. **Generating implementation artifacts** from approved specs

You are not responsible for GTM configuration, frontend code, or GA4 property settings — those belong to humans.

---

## Critical Files to Read First

Before generating any spec or answering any convention question, read these files:

```
conventions/conventions.yaml   ← THE RULEBOOK. All naming rules. Read this every time.
specs/examples/events-spec.yaml ← The reference spec. Use as a structural template.
```

Do not rely on your training knowledge for event names or parameter names. Always read `conventions/conventions.yaml` from disk — it may have been updated since your training.

---

## How to Generate a Tracking Spec

When asked to generate a spec from a feature brief:

### Step 1 — Read the conventions
```
Read conventions/conventions.yaml
```

### Step 2 — Read the feature brief
The brief will be in `docs/briefs/FB-NNN.md` or passed as input directly.

### Step 3 — Find the next spec ID
```
List specs/ to find the highest existing SPEC-NNN number, then increment by 1.
```

### Step 4 — Generate the spec YAML

Follow this structure exactly:

```yaml
spec_id: "SPEC-NNN"
spec_version: "1.0.0"
status: draft
feature_brief: "FB-NNN"
owner: "Web Analytics Team"
created_at: "YYYY-MM-DD"
updated_at: "YYYY-MM-DD"

events:
  - name: event_name          # Must be in allowlist in conventions.yaml
    trigger: >
      Precise description of exactly when this fires.
      Always tied to API success, not user click.
    priority: P0              # P0 / P1 / P2
    notes: >
      Edge cases, deduplication logic, PII handling.
    parameters:
      - name: param_name
        type: string          # Only allowed types from conventions.yaml
        required: true
        example: "real-value" # Never TODO, TBD, null, or empty
```

### Step 5 — Self-validate before saving

Before writing the file, mentally check every event against these rules:

| Check | Rule |
|---|---|
| Event name format | `^[a-z][a-z0-9_]*[a-z0-9]$` — snake_case only |
| Event name in allowlist | Check `conventions.yaml` event_names.allowlist |
| No forbidden prefix | Not starting with `gtm_`, `ga_`, `firebase_`, `debug_` |
| No forbidden suffix | Not ending with `_v2`, `_new`, `_old`, `_temp`, `_test` |
| Required event fields | name, trigger, priority, parameters, notes — all present |
| Parameter types | Only: string, number, boolean, array, object, currency, enum |
| Enum has values list | If type is enum → values array must be present |
| No placeholder examples | No TODO, TBD, null, "", example, test |
| Ecommerce items array | add_to_cart, purchase, begin_checkout etc. must have items param |
| value + currency | purchase, begin_checkout, add_payment_info, add_shipping_info |
| transaction_id | purchase and refund must have it |

### Step 6 — Save the file
```
Save to specs/{feature-name}-spec.yaml
```

### Step 7 — Tell the analyst to run the linter
```
node scripts/linter/spec-linter.js specs/{feature-name}-spec.yaml
```

---

## GA4 Event Names — Use These Exactly

Always use GA4 recommended event names. Never invent alternatives.

| Correct GA4 name | Wrong — do not use |
|---|---|
| `view_item` | `product_view`, `pdp_view` |
| `view_item_list` | `product_list_view`, `category_view` |
| `select_item` | `product_click`, `item_click` |
| `add_to_cart` | `cart_add`, `add_cart` |
| `begin_checkout` | `checkout_start`, `checkout_begin` |
| `add_shipping_info` | `shipping_info`, `shipping_step` |
| `add_payment_info` | `payment_info`, `payment_step` |
| `purchase` | `order_complete`, `transaction`, `conversion` |
| `refund` | `order_refund`, `return` |
| `add_to_wishlist` | `wishlist_add`, `save_item` |
| `login` | `user_login`, `sign_in` |
| `sign_up` | `user_register`, `registration` |
| `search` | `site_search`, `search_query` |

For anything not on the GA4 recommended list, use descriptive snake_case and add it to the conventions allowlist via a separate PR.

---

## Trigger Writing Rules

The trigger field is the most important. An engineer reads it and implements exactly what it says.

**Always fire on API success, not on user interaction:**
```
# Wrong
trigger: "when user clicks Add to Cart button"

# Correct
trigger: >
  Fire on successful HTTP 200 response from the cart API
  after the user clicks 'Add to cart'. Do NOT fire on button click.
```

**Always specify deduplication for high-value events:**
```
notes: >
  Check localStorage for key `purchased_{transaction_id}` before firing.
  If found, skip. If not found, fire and write the key immediately.
  This prevents double-counting on confirmation page reload.
```

---

## What Not to Do

- **Never use `integer` as a type** — use `number` instead
- **Never leave example as TODO, TBD, or empty** — always use a realistic value
- **Never invent event names** not in the allowlist without noting it needs a conventions PR
- **Never fire on button click** — always fire on API response or confirmed state change
- **Never skip the notes field** — even a simple event needs edge case documentation
- **Never generate a spec with status: approved** — new specs start as `draft`

---

## Answering Convention Questions

If someone asks "what events can I use?" or "is X a valid parameter name?", read `conventions/conventions.yaml` directly. Do not answer from memory.

If someone asks "why do we use GA4 event names?", point them to `docs/decisions/ADR-001-ga4-alignment.md`.

---

## Repository Structure Reminder

```
conventions/
  conventions.yaml     ← rulebook (read before any spec work)
  schema.json          ← JSON Schema for IDE validation
specs/
  examples/
    events-spec.yaml   ← reference spec (19 GA4 ecommerce events)
scripts/
  linter/
    spec-linter.js     ← run this to validate any spec
  codegen/
    generate-artifacts.js  ← generates GTM config, tests, impl card
docs/
  briefs/              ← feature briefs from PMs go here
  decisions/           ← ADRs explaining architectural choices
```
