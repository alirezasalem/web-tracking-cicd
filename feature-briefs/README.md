# `feature-briefs/` — Where Tracking Requests Start

Drop a Markdown file in this folder describing a tracking need. The AI takes it from there.

This is the **PM-facing entry point** to the pipeline. You don't need to know YAML, GA4, or what a dataLayer is. Write what you want to track in plain English. The system turns it into a structured spec, a Playwright test, an engineer-facing doc, and a GTM container config — automatically.

---

## How to submit a brief

You don't need to clone the repo or use Git locally. Everything happens in the GitHub web UI.

1. Go to this folder on GitHub: `feature-briefs/`
2. Click **Add file → Create new file**
3. **Name it exactly `FB-NNN.md`** — where `NNN` is the next sequence number padded to 3 digits (e.g., `FB-006.md`). The format is non-negotiable: anything else and the pipeline will not generate a spec. See [The filename rule](#the-filename-rule) below.
4. Paste your brief (template below)
5. Click **Commit changes** → **Create a new branch and start a pull request**
6. Click **Create pull request**

That's it. Hit merge once your team approves the brief. Within ~60 seconds an auto-generated spec PR will appear, ready for your analyst to review.

---

## The filename rule

The single rule that matters most. Your brief filename MUST match:

```
FB-NNN.md
```

| Part | Rule |
|---|---|
| `FB-` | Literal prefix. Capital F, capital B, hyphen |
| `NNN` | Three digits, zero-padded. `001`, `042`, `123` |
| `.md` | Markdown extension. Not `.markdown`, not `.txt` |

**Examples of valid filenames:**
- ✅ `FB-001.md`
- ✅ `FB-042.md`
- ✅ `FB-123.md`

**Examples that will NOT work:**
- ❌ `FB-1.md` — must be zero-padded to 3 digits
- ❌ `FB-001-newsletter-signup.md` — no descriptive suffix
- ❌ `FB-newsletter-signup.md` — must be numeric
- ❌ `fb-001.md` — must be uppercase `FB-`
- ❌ `FB_001.md` — must use hyphen, not underscore
- ❌ `FB-001.txt` — must be `.md`
- ❌ `brief-001.md` — must start with `FB-`

The pipeline's spec-generator workflow uses two filters that **both** have to pass:

1. The trigger glob `feature-briefs/FB-*.md` — catches files starting with `FB-`
2. A sequence-number regex that requires digits immediately after `FB-` — needed to assign the spec_id

A filename that passes the first but fails the second (like `FB-checkout-flow.md`) will trigger the workflow but produce a broken spec ID. Stick to the canonical format.

To find your next number: look at the highest existing `FB-NNN.md` in this folder and add 1. If the highest is `FB-005.md`, your file is `FB-006.md`.

---

## What to include

A good brief answers these questions:

| Question | Why it matters |
|---|---|
| **What event are we tracking?** | The AI needs a name — `add_to_cart`, `newsletter_signup`, etc. If you don't know, describe the action and let the AI suggest |
| **When does it fire?** | Click on a button? Page load? Form submit? Be specific |
| **Where on the site?** | Which page, which selector, which condition |
| **What data do we need?** | List the parameters you care about — product ID, value, currency, user ID, whatever |
| **Why do we care?** | One or two sentences on the business question this answers |

Everything else is optional. Edge cases, business rules, and acceptance criteria are useful when you have strong opinions about them, but the AI fills in reasonable defaults if you don't.

---

## The template

Copy-paste this into your new `FB-NNN.md`, replace the bracketed bits, delete sections you don't need.

```markdown
# FB-NNN — [Short title]

## Background
[1–3 sentences on why we want to track this. What business question does it answer?]

## What we want to track
When [the trigger happens], we need to know:
- [Data point 1 — e.g., which product was added]
- [Data point 2 — e.g., the price]
- [Data point 3 — e.g., whether the user is logged in]

## Event details
- Event name: `[suggested name, or leave blank for AI to suggest]`
- Fires on: [click of X / form submit on Y / page load / etc.]
- Page: `[/path/where/it/happens]`
- Selector: `[CSS selector or data-testid if interaction event]`

## Business rules
- [Optional: anything that should NOT trigger the event]
- [Optional: deduplication rules — fire once per session? per click?]
- [Optional: PII handling — strip emails from URLs? hash user IDs?]

## Acceptance
- [What does "working correctly" look like? e.g., "Event appears in GA4 DebugView"]
- [What edge cases must work? e.g., "Doesn't fire on quantity changes"]
```

---

## Two real examples

The system was tested with both heavy and lightweight briefs. Both work fine.

### Lightweight — recommended for most cases

[`FB-005.md`](./FB-005.md) is a great template to copy. It's 26 lines, took 5 minutes to write, and produced a clean spec on first generation:

```markdown
# Feature Brief FB-005: Remove from Cart Tracking

## Background
Users frequently add items to their cart and then remove them before checkout.
Product wants to understand which items get removed and at what stage.

## What we want to track
When a user removes an item from their cart, we need to know:
- Which item was removed (SKU, name, price, quantity)
- The cart's value before and after removal
...
```

### Heavy — when you need more rigor

[`FB-001.md`](./FB-001.md) is a longer brief with YAML front-matter, sign-off tables, scope sections, and a risks table. Useful for high-priority specs that need formal review. Most briefs don't need this much structure.

The AI parses both styles equally well. Pick whichever feels appropriate for the stakes.

---

## Picking your sequence number

The numeric form pairs neatly with the generated spec ID — `FB-006.md` produces `SPEC-2026-006-event_name.yaml`. Look at the highest existing `FB-NNN` in this folder and add 1.

If two PMs submit briefs at the same time and pick the same number, the second-merged one will fail to generate cleanly. To prevent collisions: glance at the open PRs in this repo before picking your number. If someone has a pending `FB-007.md` PR, use `FB-008.md`.

---

## What happens after you submit

The full lifecycle, so you know what to expect:

```
1. You commit FB-006.md via GitHub UI
                ↓
2. You open a PR → reviewers approve → you merge
                ↓
3. Within ~60 seconds: an AI-generated spec PR appears
   • Branch: auto-spec/FB-006
   • The spec is at: specs/SPEC-2026-006-<event_name>.yaml
                ↓
4. Your analyst reviews the spec PR:
   • Resolves any NEEDS_CLARIFICATION: placeholders
   • Edits anything that needs tweaking
   • Merges when satisfied
                ↓
5. After spec merge: 4 more workflows fire automatically
   • Tracking concept doc written (tracking-concepts/)
   • Playwright test generated (playwright-datalayer-tests/)
   • GTM container config produced (gtm-assets/)
   • Spec embedded into the RAG index (data/)
                ↓
6. Done. The engineer who'll implement the tracking has:
   • A clear spec
   • A doc they can read while coding
   • A test they can run to verify
   • A GTM file they can import directly
```

The AI never has merge authority. Every step that produces something lasting goes through human review. You and your analyst stay in control.

---

## Tips for writing better briefs

A few patterns we've learned writing briefs that produce great specs on the first try.

**Be specific about *when*, vague about *how*.** "When a user submits the newsletter form" is great. "Use a custom event trigger with a dataLayer push" is not — let the AI and the analyst figure that out.

**Name the action, not the implementation.** "Track when someone removes from cart" is better than "Add a dataLayer push to the remove button's click handler."

**Mention what should NOT fire.** Negative cases save analyst time. "Should NOT fire on quantity decreases — only full removals" is gold.

**Don't pre-design the data shape.** You don't need to know what GA4 expects for ecommerce events. List the data you care about; the AI knows the standard schemas.

**One brief = one feature.** If you want to track checkout flow events (`begin_checkout`, `add_payment_info`, `purchase`), that's one brief covering all three. If you want unrelated events like "newsletter signup" and "search," those are separate briefs.

**Don't fill in the sign-off table.** It's optional theater. PR reviewers are the real reviewers.

---

## Common mistakes to avoid

**Filename typos.** The file must be exactly `FB-NNN.md` — three digits, uppercase `FB-`, hyphen not underscore, `.md` not `.txt`. See [The filename rule](#the-filename-rule) for full details. A filename like `FB-1.md`, `FB_001.md`, or `FB-001-newsletter.md` will either silently fail to trigger the workflow or trigger it with a broken spec_id.

**Forgetting to merge the brief PR.** Generation only fires *after* merge to main. The brief sitting in a draft PR does nothing.

**Submitting a brief while a previous one is still being processed.** This usually works fine but can create race conditions on shared files like `data/spec-index.json`. If two briefs merge within 30 seconds of each other, the second one may need a manual workflow re-run.

**Editing a brief after the spec has been generated.** Don't. Once a brief has produced a spec, treat the spec as the source of truth. Edit the spec directly via a normal spec PR. Re-editing the brief won't regenerate — and even if it did, you'd lose any analyst tweaks made to the spec.

---

## When the AI gets it wrong

It happens. The generated spec might miss a parameter, use the wrong naming convention, or invent a field that doesn't make sense. When this happens:

1. **Don't blame the brief.** The spec PR is the place to fix it
2. **Edit the spec YAML directly** in the PR — change names, add parameters, fix triggers
3. **Resolve `NEEDS_CLARIFICATION:` placeholders** — these are the AI honestly admitting it didn't know something
4. **If the brief was genuinely unclear**, also update it for the historical record — but the spec PR is what merges and matters

The analyst's job is to catch and fix these on review. The pipeline trusts humans on the spec PR side.

---

## Related documentation

- [`../specs/README.md`](../specs/README.md) — what the AI produces from your brief
- [`../agents/spec-generator/README.md`](../agents/spec-generator/README.md) — how the AI reads your brief
- [`../tracking-concepts/`](../tracking-concepts/) — what engineers get for implementing tracking
- [`../README.md`](../README.md) — the full pipeline overview
