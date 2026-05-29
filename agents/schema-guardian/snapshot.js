
/**
 * agents/schema-guardian/snapshot.js
 *
 * Reads every YAML spec in specs/ and serializes the schema into
 * schema-baseline.json at the repo root.
 *
 * Captured per event:
 *   - event name
 *   - parameter names (from event.parameters)
 *   - dataLayer keys (from event.dataLayer, flattened one level)
 *
 * Run manually or via the update-baseline workflow:
 *   node agents/schema-guardian/snapshot.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../');

// ── Load pipeline config directly ─────────────────────────────────────────────
const configRaw = yaml.parse(
  readFileSync(resolve(REPO_ROOT, 'pipeline.config.yaml'), 'utf8')
);
const SPECS_DIR = resolve(REPO_ROOT, configRaw.paths.specs_output_dir);
const BASELINE_PATH = resolve(REPO_ROOT, 'schema-baseline.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively flattens an object into dot-notation key paths.
 * - Descends into plain objects
 * - Treats arrays, strings, numbers, null, booleans as leaves
 *
 * Example:
 *   { event: 'purchase', ecommerce: { items: '...', value: '...' } }
 *   → ['ecommerce.items', 'ecommerce.value', 'event']
 */
function flattenKeys(obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = flattenKeys(v, path);
      // Empty objects: record the parent path so it doesn't vanish
      keys.push(...(nested.length ? nested : [path]));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

function extractParamKeys(parameters) {
  return flattenKeys(parameters);
}

function extractDataLayerKeys(dataLayer) {
  return flattenKeys(dataLayer);
}

function serializeSpec(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
    raw = raw.replace(/:\s+NEEDS_CLARIFICATION:([^\n]*)/g, ': "NEEDS_CLARIFICATION:$1"');
  } catch (err) {
    console.warn(`[snapshot] ⚠ Cannot read ${filePath}: ${err.message}`);
    return null;
  }

  let spec;
  try {
    spec = yaml.parse(raw);
  } catch (err) {
    console.warn(`[snapshot] ⚠ Cannot parse ${filePath}: ${err.message}`);
    return null;
  }

  if (!spec || !Array.isArray(spec.events)) {
    console.warn(`[snapshot] ⚠ No events array in ${filePath} — skipping`);
    return null;
  }

  const specEntry = {
    spec_id: spec.spec_id || null,
    version: spec.version || null,
    events: {},
  };

  for (const event of spec.events) {
    if (!event.name) {
      console.warn(`[snapshot] ⚠ Unnamed event in ${filePath} — skipping event`);
      continue;
    }
    specEntry.events[event.name] = {
      parameters: extractParamKeys(event.parameters),
      dataLayer: extractDataLayerKeys(event.dataLayer),
    };
  }

  return { filename: filePath.split('/').pop(), ...specEntry };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  let files;
  try {
    files = readdirSync(SPECS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch (err) {
    console.error(`[snapshot] ✗ Cannot read specs dir: ${SPECS_DIR}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.warn('[snapshot] ⚠ No spec files found — baseline will be empty');
  }

  const baseline = {
    generated_at: new Date().toISOString(),
    generated_by: 'agents/schema-guardian/snapshot.js',
    specs_dir: configRaw.paths.specs_output_dir,
    specs: {},
  };

  let parsed = 0;
  for (const file of files) {
    const entry = serializeSpec(join(SPECS_DIR, file));
    if (!entry) continue;
    baseline.specs[entry.spec_id || file] = entry;
    parsed++;
    console.log(`[snapshot] ✓ Captured: ${file}`);
  }

  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf8');
  console.log(`\n[snapshot] ✅ Baseline written → schema-baseline.json (${parsed} spec(s))`);
}

run();
