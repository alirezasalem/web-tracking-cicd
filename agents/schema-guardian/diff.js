/**
 * agents/schema-guardian/diff.js
 *
 * Compares the current spec YAMLs against schema-baseline.json.
 *
 * Classification:
 *   BREAKING  — parameter removed or renamed from an existing event
 *             — event removed entirely
 *   ADDITIVE  — new parameter added to an existing event
 *             — new event added to an existing spec
 *             — new spec file added
 *
 * Exit codes:
 *   0  — no changes, or only additive changes (PR passes)
 *   1  — one or more breaking changes detected (PR blocked)
 *
 * Output is printed to stdout in a format suitable for GitHub PR comments.
 * Run via schema-drift.yml workflow on every PR to main.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../');

// ── Load pipeline config ──────────────────────────────────────────────────────
const configRaw = yaml.parse(
  readFileSync(resolve(REPO_ROOT, 'pipeline.config.yaml'), 'utf8')
);
const SPECS_DIR = resolve(REPO_ROOT, configRaw.paths.specs_output_dir);
const BASELINE_PATH = resolve(REPO_ROOT, 'schema-baseline.json');

// ── Helpers (mirrors snapshot.js) ────────────────────────────────────────────

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

function loadCurrentSpecs() {
  let files;
  try {
    files = readdirSync(SPECS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch (err) {
    console.error(`[diff] ✗ Cannot read specs dir: ${SPECS_DIR}\n  ${err.message}`);
    process.exit(1);
  }

  const current = {};
  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(join(SPECS_DIR, file), 'utf8');
      raw = raw.replace(/:\s+NEEDS_CLARIFICATION:([^\n]*)/g, ': "NEEDS_CLARIFICATION:$1"');
    } catch (err) {
      console.warn(`[diff] ⚠ Cannot read ${file}: ${err.message}`);
      continue;
    }

    let spec;
    try {
      spec = yaml.parse(raw);
    } catch (err) {
      console.warn(`[diff] ⚠ Cannot parse ${file}: ${err.message}`);
      continue;
    }

    if (!spec || !Array.isArray(spec.events)) continue;

    const specId = spec.spec_id || file;
    current[specId] = { filename: file, events: {} };

    for (const event of spec.events) {
      if (!event.name) continue;
      current[specId].events[event.name] = {
        parameters: extractParamKeys(event.parameters),
        dataLayer: extractDataLayerKeys(event.dataLayer),
      };
    }
  }
  return current;
}

// ── Diff logic ────────────────────────────────────────────────────────────────

function diffSchemas(baseline, current) {
  const breaking = [];
  const additive = [];

  // Check every spec that existed in the baseline
  for (const [specId, baseSpec] of Object.entries(baseline.specs)) {
    if (!current[specId]) {
      breaking.push({
        type: 'SPEC_REMOVED',
        specId,
        message: `Spec \`${specId}\` was removed from specs/`,
      });
      continue;
    }

    const curSpec = current[specId];

    // Check every event that existed in the baseline
    for (const [eventName, baseEvent] of Object.entries(baseSpec.events || {})) {
      if (!curSpec.events[eventName]) {
        breaking.push({
          type: 'EVENT_REMOVED',
          specId,
          eventName,
          message: `Event \`${eventName}\` was removed from spec \`${specId}\``,
        });
        continue;
      }

      const curEvent = curSpec.events[eventName];

      // Parameters: removed = breaking, added = additive
      const baseParams = new Set(baseEvent.parameters || []);
      const curParams  = new Set(curEvent.parameters  || []);

      for (const param of baseParams) {
        if (!curParams.has(param)) {
          breaking.push({
            type: 'PARAMETER_REMOVED',
            specId,
            eventName,
            field: param,
            message: `Parameter \`${param}\` removed from \`${specId} → ${eventName}\``,
          });
        }
      }

      for (const param of curParams) {
        if (!baseParams.has(param)) {
          additive.push({
            type: 'PARAMETER_ADDED',
            specId,
            eventName,
            field: param,
            message: `Parameter \`${param}\` added to \`${specId} → ${eventName}\``,
          });
        }
      }

      // dataLayer keys: removed = breaking, added = additive
      const baseDL = new Set(baseEvent.dataLayer || []);
      const curDL  = new Set(curEvent.dataLayer  || []);

      for (const key of baseDL) {
        if (!curDL.has(key)) {
          breaking.push({
            type: 'DATALAYER_KEY_REMOVED',
            specId,
            eventName,
            field: key,
            message: `dataLayer key \`${key}\` removed from \`${specId} → ${eventName}\``,
          });
        }
      }

      for (const key of curDL) {
        if (!baseDL.has(key)) {
          additive.push({
            type: 'DATALAYER_KEY_ADDED',
            specId,
            eventName,
            field: key,
            message: `dataLayer key \`${key}\` added to \`${specId} → ${eventName}\``,
          });
        }
      }
    }

    // New events in a known spec = additive
    for (const eventName of Object.keys(curSpec.events)) {
      if (!baseSpec.events[eventName]) {
        additive.push({
          type: 'EVENT_ADDED',
          specId,
          eventName,
          message: `New event \`${eventName}\` added to spec \`${specId}\``,
        });
      }
    }
  }

  // Entirely new specs = additive
  for (const specId of Object.keys(current)) {
    if (!baseline.specs[specId]) {
      additive.push({
        type: 'SPEC_ADDED',
        specId,
        message: `New spec \`${specId}\` added`,
      });
    }
  }

  return { breaking, additive };
}

// ── PR Comment output ─────────────────────────────────────────────────────────

function buildComment(breaking, additive, baselineDate) {
  const lines = [];
  lines.push('## 🛡️ Schema Drift Report');
  lines.push('');
  lines.push(`Baseline snapshot taken: \`${baselineDate}\``);
  lines.push('');

  if (breaking.length === 0 && additive.length === 0) {
    lines.push('✅ **No schema changes detected.** All specs match the baseline.');
    return lines.join('\n');
  }

  if (breaking.length > 0) {
    lines.push(`### ❌ Breaking Changes (${breaking.length})`);
    lines.push('');
    lines.push('> These changes **remove or rename** existing parameters.');
    lines.push('> This PR is **blocked** until changes are reverted or the baseline is intentionally updated.');
    lines.push('');
    for (const item of breaking) {
      lines.push(`- **[${item.type}]** ${item.message}`);
    }
    lines.push('');
    lines.push('**To intentionally accept these changes**, run the `Update Schema Baseline` workflow manually after PR approval.');
    lines.push('');
  }

  if (additive.length > 0) {
    lines.push(`### ⚠️ Additive Changes (${additive.length}) — non-blocking`);
    lines.push('');
    lines.push('> These changes **add** new parameters or events. Existing downstream systems are unaffected.');
    lines.push('');
    for (const item of additive) {
      lines.push(`- **[${item.type}]** ${item.message}`);
    }
    lines.push('');
  }

  if (breaking.length === 0) {
    lines.push('✅ **Result: PASS** — Only additive changes detected. PR may proceed.');
  } else {
    lines.push(`🚫 **Result: BLOCKED** — ${breaking.length} breaking change(s) detected.`);
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  if (!existsSync(BASELINE_PATH)) {
    console.log('## 🛡️ Schema Drift Report');
    console.log('');
    console.log('⚠️ **No baseline found** (`schema-baseline.json` does not exist).');
    console.log('');
    console.log('Run the `Update Schema Baseline` workflow to create the initial baseline.');
    console.log('This PR is **not blocked** — baseline is required before drift detection is active.');
    process.exit(0);
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[diff] ✗ Cannot parse schema-baseline.json: ${err.message}`);
    process.exit(1);
  }

  const current = loadCurrentSpecs();
  const { breaking, additive } = diffSchemas(baseline, current);

  const comment = buildComment(breaking, additive, baseline.generated_at || 'unknown');
  console.log(comment);

  if (breaking.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run();
