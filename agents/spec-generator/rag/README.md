# `agents/spec-generator/rag/` — The Memory Layer

This is the retrieval-augmented generation (RAG) subsystem. It gives the spec generator memory: before each call to Claude, the 3 most semantically similar past specs are retrieved and injected as in-context examples.

Without this layer, every spec generation is a clean slate. The 50th spec would be no more informed than the 1st. With it, consistency emerges automatically as the spec library grows.

---

## Table of contents

- [What problem this solves](#what-problem-this-solves)
- [Architecture overview](#architecture-overview)
- [The vector store](#the-vector-store)
- [The 3 files](#the-3-files)
- [Why this design](#why-this-design)
- [Performance and cost](#performance-and-cost)
- [Operational notes](#operational-notes)

---

## What problem this solves

Imagine you have 20 existing specs in `specs/`. A PM submits a new brief about "remove from cart tracking." You want the generated spec to:

- Use the same parameter naming as your existing `add_to_cart` spec (e.g., `items`, not `products`)
- Follow the same trigger structure (action, selector, page_path)
- Match the same `dataLayer` shape (ecommerce nested under `ecommerce`)
- Reuse the same acceptance criteria patterns

Without RAG, the generator sees only the new brief plus the static conventions. It might make reasonable guesses but not match your team's actual conventions in use.

With RAG, the generator retrieves `add_to_cart`, `purchase`, and `view_item` as the 3 most similar specs and injects them into Claude's context window. Claude naturally mirrors their structure. Consistency emerges from the system, not from analyst discipline.

This is the JD's stated bonus requirement — *"Experience building or fine-tuning RAG (Retrieval-Augmented Generation) systems"* — built and live.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      Write path (indexing)                       │
│                                                                  │
│  Spec PR merges to main                                          │
│           │                                                      │
│           ▼                                                      │
│  index-specs.yml workflow fires                                  │
│           │                                                      │
│           ▼                                                      │
│  rag/index.js                                                    │
│   • Scans specs/ for *.yaml                                      │
│   • Hashes each spec (sha256)                                    │
│   • Skips unchanged specs                                        │
│   • Embeds new/changed specs via Voyage AI (voyage-3-lite)       │
│   • Merges into existing data/spec-index.json                    │
│           │                                                      │
│           ▼                                                      │
│  Commits updated index back to main                              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                      Read path (retrieval)                       │
│                                                                  │
│  PM commits a brief — generate-spec.yml fires                    │
│           │                                                      │
│           ▼                                                      │
│  agents/spec-generator/run.js                                    │
│           │                                                      │
│           │  await querySpecs(briefContent, 3)                   │
│           ▼                                                      │
│  rag/query.js                                                    │
│   • Loads data/spec-index.json (cached in memory)                │
│   • Embeds the brief via Voyage AI                               │
│   • Computes cosine similarity vs every indexed spec             │
│   • Returns top 3 with scores                                    │
│           │                                                      │
│           ▼                                                      │
│  rag/inject.js                                                   │
│   • Formats the 3 results as a Markdown block                    │
│   • Returns string ready to embed in Claude's user message       │
│           │                                                      │
│           ▼                                                      │
│  Continue with Claude API call (now with RAG context)            │
└──────────────────────────────────────────────────────────────────┘
```

Two flows, one shared data file (`data/spec-index.json`), no servers.

---

## The vector store

`data/spec-index.json` is the entire vector database. It's a flat JSON array, one entry per spec, committed to the repo.

Example structure (one entry shown):

```json
[
  {
    "spec_id": "SPEC-2026-002-add_to_cart",
    "filename": "SPEC-2026-002-add_to_cart.yaml",
    "content_hash": "a1b2c3d4e5f6g7h8",
    "text": "spec: SPEC-2026-002-add_to_cart.yaml\nevent: add_to_cart\ndescription: Fires when user adds product...\nparam: product_id source:DL - product_id\nparam: price source:DL - price\n...",
    "embedding": [0.0234, -0.1281, 0.0892, 0.4112, ..., 0.0451]
  }
]
```

| Field | What it is |
|---|---|
| `spec_id` | The canonical spec identifier — used for retrieval-result display |
| `filename` | Original filename — used by `query.js` for filename-based scoring tweaks if needed later |
| `content_hash` | SHA-256 hash of the source YAML — used to detect when re-embedding is needed |
| `text` | Flattened, embeddable text form of the spec — what Voyage actually sees |
| `embedding` | 512-dimensional float vector from Voyage's `voyage-3-lite` model |

Total file size: ~10KB per spec entry. With 100 specs, that's ~1MB — still trivially small. With 1000 specs, the design might want revisiting, but the project's ceiling is far lower.

---

## The 3 files

### `index.js` — the indexer

Runs whenever a spec is added or changed. Its job:
1. Scan every `SPEC-*.yaml` in `specs/`
2. For each, compute a hash of the file contents
3. If the hash matches the existing entry in the index, skip (already embedded)
4. Otherwise, flatten the spec to embeddable text and queue it for embedding
5. Make one batched Voyage API call for all queued specs
6. Merge new embeddings into the index, preserving unchanged entries
7. Write the result to `data/spec-index.json` (sorted by spec_id for clean diffs)

**Flags:**
- `--dry-run` — print what would be re-embedded, but don't call the API or write the file
- `--force` — re-embed every spec from scratch, ignoring content hashes

**Why hash-based skipping?** Embedding is the slow part. For a repo with 100 specs where 1 changed, you only want to embed 1 — not all 100. The hash check makes re-runs near-instant.

### `query.js` — the retriever

Called by `run.js` on every spec generation. Its job:
1. Load `data/spec-index.json` into memory (cached after first call)
2. Embed the input brief text via Voyage AI
3. Compute cosine similarity against every indexed spec
4. Sort descending, return top N (default 3)

The cosine similarity math is inline — no library. For a corpus this small (≤1000 vectors of 512 dimensions), in-process iteration is fast enough that any vector database would just add latency.

**Public function:**
```javascript
querySpecs(briefText, topN = 3)
  → [{ spec_id, filename, text, score }, ...]
```

**Graceful degradation:** If `VOYAGE_API_KEY` is missing, the embed call fails. Network errors, rate limits, malformed responses — all return `null` from `embedQuery`, which `querySpecs` converts to an empty results array. The spec generator then runs without RAG context, logging a warning to stderr. **The pipeline never fails because of RAG.**

### `inject.js` — the formatter

A tiny module — 36 lines. Takes the array of similar specs from `query.js` and produces a Markdown block ready to drop into the Claude prompt.

Output looks like:

```markdown
## Reference: Similar Past Specs

The following specs from our library are most similar to this brief.
Use them as structural and naming reference — mirror their parameter naming,
trigger patterns, and dataLayer shape where appropriate.
Do NOT copy them verbatim. The new brief may describe a different event
with different requirements.

### Similar spec 1: SPEC-2026-002-add_to_cart (similarity: 0.70)

spec: SPEC-2026-002-add_to_cart.yaml
event: add_to_cart
description: Fires when user adds product to cart
param: product_id source:DL - product_id
...

---

### Similar spec 2: SPEC-2026-004-purchase (similarity: 0.63)

...
```

Why a separate file? Two reasons:
1. Prompt formatting changes more often than retrieval logic. Isolating it makes both easier to iterate.
2. If a future variant wants to inject specs differently (e.g., as JSON, as table rows, with a different framing instruction), the change is one file.

---

## Why this design

A few design choices that may seem too simple but are deliberately so.

### Why a flat JSON file instead of a vector database?

Frameworks like LightRAG, ChromaDB, Pinecone, and pgvector exist for one reason: **scale**. They handle thousands to billions of vectors, distributed across machines, with sophisticated indexing structures (HNSW, IVF) to keep query times manageable.

The spec library will likely never exceed a few hundred entries. With ~500 vectors of 512 dimensions, brute-force cosine similarity completes in under 10ms in a single Node process. There is no performance problem to solve.

Meanwhile, a flat JSON file gives you:
- **Zero infrastructure** — no servers, no Docker, no database connection strings
- **Git diffability** — embeddings change visibly in PRs; you can audit exactly what changed
- **Portability** — fork the repo and everything works; no separate migration step
- **Inspectability** — open it in any text editor and read the actual content
- **Free version control** — the embedding history is the git history

When you have a real scale problem (>10K specs, multi-team queries, federated search), revisit. Until then, simpler is correct.

### Why Voyage AI instead of OpenAI embeddings or Cohere?

Three reasons:
- **Cost** — `voyage-3-lite` is one of the cheapest production-grade embedding models available (~$0.02 per 1M tokens)
- **Quality** — for retrieval tasks, Voyage's models consistently rank top-tier on benchmark leaderboards
- **Asymmetric input types** — Voyage explicitly distinguishes `document` embeddings (during indexing) from `query` embeddings (during retrieval). For retrieval quality, this matters more than people expect

Voyage is also the embedding provider Anthropic recommends. Compatible spirit, minor consideration.

### Why embed flattened text instead of the raw YAML?

Embedding models work best on prose-like text — natural language with clear semantic content. Raw YAML has lots of structural tokens (`:`, `-`, indentation) that don't carry meaning.

The flattening in `index.js` converts:

```yaml
events:
  - name: add_to_cart
    description: User adds product to cart
    parameters:
      product_id: "DL - product_id"
```

Into:

```
event: add_to_cart
description: User adds product to cart
param: product_id source:DL - product_id
```

Same information, more semantically dense. Retrieval quality measurably improves.

### Why top 3?

Three is enough to convey the team's conventions without overwhelming Claude's context window. With one example, Claude might over-fit to the specific spec. With ten, the context grows large enough to hurt response quality and add cost.

Three is a sweet spot:
- Diverse enough to show the patterns aren't accidental
- Small enough that each example is genuinely studied
- Cheap enough that costs stay bounded

For a corpus of <50 specs, 3 is the empirical default. For >500 specs, consider raising to 5 — the marginal cost is small and the diversity helps.

### Why cosine similarity instead of Euclidean distance or dot product?

Cosine similarity is **scale-invariant** — it measures angle, not magnitude. Two specs about ecommerce should be similar regardless of how much text each contains. Euclidean distance would penalize longer specs unfairly.

Voyage's embeddings are also pre-normalized, which makes cosine similarity mathematically equivalent to dot product. We use cosine notation for clarity.

---

## Performance and cost

### Indexing

- **Time per spec** — ~200ms for the Voyage API call; total indexing of 100 specs takes ~3 seconds (batched)
- **Re-indexing** — only changed specs are re-embedded due to hash skipping; typical CI run is 200ms
- **API cost** — embedding a typical spec (~800 tokens) costs $0.000016 (~$1 per million tokens). 100 specs costs ~$0.002 total.

### Retrieval

- **Time per query** — ~150ms for the Voyage API call; cosine similarity computation is <5ms regardless of corpus size up to ~1000 specs
- **Memory** — ~50MB for the parsed index of 100 specs (mostly the embedding arrays)
- **API cost** — ~$0.0001 per generation call

### Monthly running costs at typical usage

A team shipping one new spec per week:
- 52 index updates per year × $0.00001 = **$0.0005/year for indexing**
- 52 spec generations + ~50 doc/test regenerations × $0.0001 = **$0.01/year for retrieval**

For all practical purposes, **the RAG layer is free**.

---

## Operational notes

### When to re-embed from scratch

Run `node agents/spec-generator/rag/index.js --force` when:
- You've changed the flattening logic in `specToText()` — past embeddings are now inconsistent with new ones
- You're switching embedding models — old vectors are incompatible with new query vectors
- You've inherited a fork and want to re-embed under your own Voyage account for audit purposes

Otherwise, hash-based incremental indexing is correct and fast.

### When the index goes stale

The CI workflow auto-rebuilds the index after every spec merge. But edge cases:

- **Local commits that don't go through CI** — if you manually edit a spec on `main`, the index won't auto-update. Either trigger `index-specs.yml` manually via `workflow_dispatch`, or run `index.js` locally and commit the result.
- **Renaming a spec** — the hash changes, so the entry gets re-embedded. But the old entry stays in the index because `index.js` only adds/updates, never removes. To clean up, run `--force` (rebuilds from scratch).

### Inspecting retrieval quality

The cleanest way to validate that retrieval is doing real work: pick a brief, run with and without `VOYAGE_API_KEY` set, and diff the outputs.

```bash
# Without RAG
unset VOYAGE_API_KEY
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md > /tmp/no-rag.yaml

# With RAG
export VOYAGE_API_KEY=vk-...
node agents/spec-generator/run.js --brief-file feature-briefs/FB-005.md > /tmp/with-rag.yaml

diff /tmp/no-rag.yaml /tmp/with-rag.yaml
```

If the with-RAG version uses parameter names that match existing specs and the without-RAG version doesn't, retrieval is working.

You can also watch the stderr logs:

```
[spec-generator] Querying spec index for similar past specs...
[rag/query] Retrieved 3 similar spec(s):
  SPEC-2026-002-add_to_cart (score: 0.696)
  SPEC-2026-004-purchase (score: 0.627)
  SPEC-2026-001-page_view (score: 0.481)
[spec-generator] ✓ RAG: injecting 3 similar spec(s) into prompt
```

A clean score gradient (0.7 → 0.6 → 0.5) indicates discriminating retrieval. Scores all clustered near each other (0.5 → 0.49 → 0.48) would indicate the embeddings can't distinguish the corpus well — usually a flattening or model-choice issue.

### Tuning retrieval

Three knobs:

**1. The flattening logic in `specToText()`** — what text gets embedded shapes what gets retrieved. Add more semantic detail (descriptions, acceptance criteria) for richer matching; remove structural noise (IDs, timestamps) for cleaner signal.

**2. The number of retrieved specs (`topN`)** — currently hardcoded to 3 in `run.js`. For larger corpora, raise to 5. For very small corpora (<10 specs), drop to 2.

**3. The embedding model** — `voyage-3-lite` is the default. For higher quality at higher cost, switch to `voyage-3` (1024 dimensions, ~2x cost, marginal accuracy improvement). The model name is set as a constant in both `index.js` and `query.js` — keep them in sync if you change it.

---

## Related documentation

- [`../README.md`](../README.md) — the spec-generator overview
- [`../../README.md`](../../README.md) — all agents
- [`../../../.github/workflows/README.md`](../../../.github/workflows/README.md) — `generate-spec.yml` and `index-specs.yml` workflows
- [`../../../data/spec-index.json`](../../../data/spec-index.json) — the live vector store
