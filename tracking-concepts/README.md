# `tracking-concepts/` — Machine-Generated Engineer-Facing Documentation

This folder holds **Markdown implementation guides**, one per analytics event in `specs/`. They are the docs engineers actually read when wiring up the dataLayer on the frontend.

Don't edit these files by hand — they're regenerated on every spec change.

---

## What's in here

```
tracking-concepts/
├── add_to_cart.md
├── login.md
├── page_view.md
├── purchase.md
└── remove_from_cart.md
```

One file per event. Each file is structured the same way — six sections, in this order:

1. **Title** — event name + one-line summary
2. **Overview** — when and why it fires
3. **Trigger Rules** — every condition that must be true (and what must NOT trigger it)
4. **dataLayer.push() Snippet** — copy-paste-ready JavaScript with realistic example values
5. **Parameter Table** — name, type, required, example, description
6. **Business Rules & Edge Cases** — dedup, timing, PII handling, currency rules

This structure is enforced by the doc generator's prompt. Every file in this folder follows the same shape.

---

## Who writes it

| Workflow | When |
|---|---|
| [`Generate Tracking Concept for Devs`](../.github/workflows/README.md#6-generate-tracking-concept-for-devs--generate-tracking-conceptyml) | After every spec merge to main, chained off the artifact pipeline |
| Manual `workflow_dispatch` | On demand for a specific spec |

The agent that produces these files is [`agents/tracking-concept-generator/`](../agents/tracking-concept-generator/README.md).

---

## How to use these files

An engineer about to implement tracking for an event should:

1. Find the right file (e.g. `add_to_cart.md` for cart events)
2. Read the Overview and Trigger Rules sections
3. Copy the dataLayer.push() snippet into the relevant frontend handler
4. Cross-reference the Parameter Table to make sure every value is mapped
5. Apply the business rules (deduplication, timing, etc.)

Every file is small enough to read end-to-end in 3–5 minutes. The whole point of this folder is that engineers shouldn't have to read YAML to implement tracking.

---

## Why you should not edit these files by hand

This is the **single biggest gotcha** in the entire pipeline. There's a known bug here.

**1. They will be overwritten.** Any manual edit is blown away when the underlying spec changes and the doc generator re-runs.

**2. There's no detection mechanism today.** The generator does not currently diff against the existing file before regenerating. Manual edits disappear silently — there's no warning, no log entry.

**3. The "DO NOT EDIT" header is a convention, not enforcement.** Every generated file starts with an HTML comment that says "DO NOT EDIT — regenerate by re-running the spec through CI." Nothing checks this.

This is tracked as **Bug #7** in the project backlog. Two possible fixes are on the roadmap:

- **Diff detection** — hash the existing doc before regenerating; fail the workflow if it diverged
- **Editable sections** — split docs into auto-generated sections and a clearly marked "Analyst Notes" section that's preserved across regenerations

Until one of these ships, **treat manual edits to this folder as temporary**. If you need to add critical analyst context, put it in the underlying spec's `notes:` field — the generator picks that up and includes it.

For more on the editorialization issues in the current generator, see [`agents/tracking-concept-generator/README.md → The human-edit problem`](../agents/tracking-concept-generator/README.md#the-human-edit-problem).

---

## When the file might look out of sync

- **Mid-PR:** the doc file updates only after a spec merges to main, not on the spec PR
- **After a spec is deleted:** the old doc stays in this folder until manually removed
- **Field-name editorialization:** the generator occasionally rewrites a spec parameter name to match GA4 defaults (e.g. spec says `products`, doc says `items`). When this happens, fix the underlying spec — don't fix the doc

---

## Related documentation

- [`../agents/tracking-concept-generator/README.md`](../agents/tracking-concept-generator/README.md) — how these files are built (and the known issues)
- [`../specs/README.md`](../specs/README.md) — the spec format that drives generation
- [`../.github/workflows/README.md`](../.github/workflows/README.md#6-generate-tracking-concept-for-devs--generate-tracking-conceptyml) — the workflow that produces these
