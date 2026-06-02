/**
 * agents/spec-generator/rag/query.js
 *
 * Loads data/spec-index.json and exposes a single function:
 *   querySpecs(briefText, topN) → array of the N most similar spec entries
 *
 * Called by agents/spec-generator/run.js before the Claude API call.
 * No side effects — read-only, in-memory.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '../../../');
const INDEX_PATH = resolve(REPO_ROOT, 'data/spec-index.json');
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL      = 'voyage-3-lite';

// ── Cache index in memory (loaded once per process) ───────────────────────────
let _index = null;

function loadIndex() {
  if (_index !== null) return _index;

  if (!existsSync(INDEX_PATH)) {
    // First run before any specs exist — return empty, not an error
    _index = [];
    return _index;
  }

  try {
    _index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    _index = [];
  }
  return _index;
}

// ── Math ──────────────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Voyage embed (single query) ───────────────────────────────────────────────

async function embedQuery(text) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    // Graceful degradation — RAG is optional, not a hard requirement
    console.error('[rag/query] ⚠ VOYAGE_API_KEY not set — skipping RAG retrieval');
    return null;
  }

  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [text],
        input_type: 'query',   // 'query' weight vs 'document' weight — Voyage distinction
      }),
    });

    if (!res.ok) {
      console.error(`[rag/query] ⚠ Voyage API error ${res.status} — skipping RAG`);
      return null;
    }

    const json = await res.json();
    return json.data[0].embedding;
  } catch (err) {
    console.error(`[rag/query] ⚠ Network error calling Voyage — skipping RAG: ${err.message}`);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find the N most similar specs to the given brief text.
 *
 * @param {string} briefText  — the raw feature brief content
 * @param {number} [topN=3]  — how many specs to return
 * @returns {Array<{spec_id, filename, text, score}>} — sorted by similarity desc
 */
export async function querySpecs(briefText, topN = 3) {
  const index = loadIndex();

  if (index.length === 0) {
    console.error('[rag/query] Index is empty — no similar specs to retrieve');
    return [];
  }

  const queryVec = await embedQuery(briefText);
  if (queryVec === null) return [];  // graceful degradation

  const scored = index.map(entry => ({
    spec_id:  entry.spec_id,
    filename: entry.filename,
    text:     entry.text,
    score:    cosineSimilarity(queryVec, entry.embedding),
  }));

  // Sort descending by similarity, take top N
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, topN);

  console.error(`[rag/query] Retrieved ${results.length} similar spec(s):`);
  for (const r of results) {
    console.error(`  ${r.spec_id} (score: ${r.score.toFixed(3)})`);
  }

  return results;
}
