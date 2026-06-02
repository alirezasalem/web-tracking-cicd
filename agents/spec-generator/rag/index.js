/**
 * agents/spec-generator/rag/index.js
 *
 * Scans every spec YAML in specs/ and builds a vector index stored at
 * data/spec-index.json. Called by .github/workflows/index-specs.yml
 * after any spec merges to main.
 *
 * Usage:
 *   VOYAGE_API_KEY=<key> node agents/spec-generator/rag/index.js
 *
 * Flags:
 *   --dry-run   Print what would be indexed without writing anything
 *   --force     Re-embed every spec even if the hash hasn't changed
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '../../../');
const SPECS_DIR  = resolve(REPO_ROOT, 'specs');
const INDEX_PATH = resolve(REPO_ROOT, 'data/spec-index.json');
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL      = 'voyage-3-lite';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

// ── Helpers ──────────────────────────────────────────────────────────────────

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Flatten a spec YAML into a single searchable text blob.
 * We include the event names, parameter names, trigger actions, and
 * all human-readable fields — everything a similarity search needs.
 */
function specToText(specObj, filename) {
  const lines = [];

  lines.push(`spec: ${filename}`);
  if (specObj.spec_id)          lines.push(`spec_id: ${specObj.spec_id}`);
  if (specObj.status)           lines.push(`status: ${specObj.status}`);
  if (specObj.feature_brief_ref) lines.push(`feature_brief_ref: ${specObj.feature_brief_ref}`);

  for (const event of specObj.events ?? []) {
    lines.push(`event: ${event.name}`);
    if (event.description) lines.push(`description: ${event.description}`);

    // Trigger info
    const trigger = event.trigger ?? {};
    if (trigger.action)    lines.push(`trigger_action: ${trigger.action}`);
    if (trigger.page_path) lines.push(`trigger_page_path: ${trigger.page_path}`);
    if (trigger.selector)  lines.push(`trigger_selector: ${trigger.selector}`);

    // Parameters — handle both shapes the pipeline produces:
    //   - Array of { name, type, required, ... } objects (most generators)
    //   - Object of { param_name: "DL - source" } pairs (older specs)
    const params = event.parameters;
    if (Array.isArray(params)) {
      for (const param of params) {
        if (typeof param === 'object' && param?.name) {
          lines.push(`param: ${param.name} type:${param.type ?? '?'} required:${param.required ?? false}`);
          if (param.description) lines.push(`param_desc: ${param.description}`);
        }
      }
    } else if (params && typeof params === 'object') {
      for (const [name, source] of Object.entries(params)) {
        lines.push(`param: ${name} source:${source}`);
      }
    }

    // dataLayer keys
    const dl = event.dataLayer ?? {};
    const dlKeys = Object.keys(dl).join(', ');
    if (dlKeys) lines.push(`dataLayer_keys: ${dlKeys}`);

    // Notes
    if (event.notes) lines.push(`notes: ${event.notes}`);
  }

  // Acceptance criteria
  for (const criterion of specObj.acceptance_criteria ?? []) {
    lines.push(`criterion: ${criterion}`);
  }

  return lines.join('\n');
}

/** Call Voyage AI embeddings endpoint. Returns float[] */
async function embed(texts, inputType = 'document') {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error('[rag/index] ✗ VOYAGE_API_KEY env var is not set');
    process.exit(1);
  }

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[rag/index] ✗ Voyage API error ${res.status}: ${body}`);
    process.exit(1);
  }

  const json = await res.json();
  // Voyage returns { data: [ { embedding: float[] }, ... ] }
  return json.data.map(d => d.embedding);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Load existing index (may be empty on first run)
let existingIndex = [];
if (existsSync(INDEX_PATH)) {
  try {
    existingIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    existingIndex = [];
  }
}
const existingMap = Object.fromEntries(existingIndex.map(e => [e.spec_id, e]));

// Scan specs/ for all YAML files (skip .gitkeep and non-spec files)
const specFiles = readdirSync(SPECS_DIR)
  .filter(f => f.startsWith('SPEC-') && f.endsWith('.yaml'))
  .sort();

if (specFiles.length === 0) {
  console.error('[rag/index] ⚠ No spec files found in specs/ — index will be empty');
}

console.error(`[rag/index] Found ${specFiles.length} spec(s) in specs/`);

// Determine which specs need (re)embedding
const toEmbed = [];

for (const filename of specFiles) {
  const filePath = resolve(SPECS_DIR, filename);
  const rawYaml  = readFileSync(filePath, 'utf8');
  const specHash = hash(rawYaml);
  const specId   = filename.replace('.yaml', '');

  if (!FORCE && existingMap[specId]?.content_hash === specHash) {
    console.error(`[rag/index] ✓ ${filename} — unchanged, skipping`);
    continue;
  }

  let specObj;
  try {
    specObj = yaml.parse(rawYaml);
  } catch (err) {
    console.error(`[rag/index] ⚠ Could not parse ${filename}: ${err.message} — skipping`);
    continue;
  }

  const text = specToText(specObj, filename);
  toEmbed.push({ specId, filename, text, specHash, rawYaml });
  console.error(`[rag/index] ~ ${filename} — queued for embedding`);
}

if (toEmbed.length === 0) {
  console.error('[rag/index] ✓ All specs up to date — nothing to do');
  process.exit(0);
}

if (DRY_RUN) {
  console.error(`[rag/index] DRY RUN — would embed ${toEmbed.length} spec(s):`);
  for (const s of toEmbed) console.error(`  ${s.filename}`);
  process.exit(0);
}

// Embed in one batched call (Voyage supports up to 128 inputs per call)
console.error(`[rag/index] Calling Voyage AI to embed ${toEmbed.length} spec(s)...`);
const texts      = toEmbed.map(s => s.text);
const embeddings = await embed(texts, 'document');

// Merge new embeddings into existing index
for (let i = 0; i < toEmbed.length; i++) {
  const { specId, filename, text, specHash } = toEmbed[i];
  existingMap[specId] = {
    spec_id:      specId,
    filename,
    content_hash: specHash,
    text,
    embedding:    embeddings[i],
  };
}

const newIndex = Object.values(existingMap).sort((a, b) =>
  a.spec_id.localeCompare(b.spec_id)
);

// Write index
const dataDir = resolve(REPO_ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

if (!DRY_RUN) {
  writeFileSync(INDEX_PATH, JSON.stringify(newIndex, null, 2) + '\n', 'utf8');
  console.error(`[rag/index] ✓ Wrote ${newIndex.length} entries to data/spec-index.json`);
}
