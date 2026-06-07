# `data/` — Machine-Managed Storage

This folder holds files that are **automatically generated and maintained by the pipeline**. Don't edit anything in here by hand — your changes will be silently overwritten the next time the relevant workflow runs.

---

## What's in here

```
data/
└── spec-index.json   ← The RAG vector store (~45KB for 5 specs)
```

### `spec-index.json`

A JSON array of spec embeddings produced by Voyage AI's `voyage-3-lite` model. Each entry contains:

- `spec_id` — canonical spec identifier
- `filename` — source spec file in `specs/`
- `content_hash` — SHA-256 of the source YAML (used to skip re-embedding unchanged specs)
- `text` — flattened text representation of the spec that was embedded
- `embedding` — 512-dimensional float vector

This is the RAG (Retrieval-Augmented Generation) memory that the spec-generator queries before every Claude call. When a new feature brief comes in, the generator finds the 3 most semantically similar past specs from this index and injects them into Claude's prompt as in-context examples.

---

## Who writes it

| Workflow | When | What it writes |
|---|---|---|
| [`Index Specs for RAG`](../.github/workflows/README.md#5-index-specs-for-rag--index-specsyml) | After any spec PR merges to main | Adds/updates the entry for the changed spec |
| Manual `workflow_dispatch` (with `--force`) | On demand | Re-embeds every spec from scratch |

The agent that does the actual writing is [`agents/spec-generator/rag/index.js`](../agents/spec-generator/rag/README.md).

---

## Why you should not edit this file by hand

Three reasons:

**1. It will be overwritten.** Any manual edit gets blown away the next time the RAG indexer runs — which is on every spec merge.

**2. Embeddings are not human-meaningful.** The `embedding` arrays are 512 floats produced by a neural network. There's no way to "fix" one by hand.

**3. Hand-editing will silently break retrieval.** If you change the `text` field without re-embedding, the stored vector no longer represents the text. The RAG layer will quietly produce wrong results.

**The only legitimate way to modify this file** is to update the source spec in `specs/` and let the workflow re-run.

---

## When the file might look out of sync

A few situations where `spec-index.json` may not match `specs/`:

- **Right after a fork:** the committed index was embedded under the original maintainer's Voyage account. Run the indexer with `--force` against your own key to refresh. See the root README's setup section.
- **After deleting a spec:** the indexer only adds/updates; it never removes entries. To clean up after a spec deletion, run `--force` to rebuild from scratch.
- **Mid-PR:** if a spec changes in a PR, the index won't update until that PR merges.

---

## Related documentation

- [`../agents/spec-generator/rag/README.md`](../agents/spec-generator/rag/README.md) — deep dive on how the RAG layer works
- [`../agents/spec-generator/README.md`](../agents/spec-generator/README.md) — the agent that reads this index
- [`../.github/workflows/README.md`](../.github/workflows/README.md#5-index-specs-for-rag--index-specsyml) — the workflow that maintains it
