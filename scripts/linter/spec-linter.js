/**
 * scripts/linter/spec-linter.js
 *
 * Validates analytics spec YAML files against:
 *   1. Structural rules from pipeline.config.yaml (required fields, allowed statuses)
 *   2. Naming conventions from conventions/conventions.yaml
 *
 * All rules are sourced from config — nothing is hardcoded here.
 *
 * Usage:
 *   node scripts/linter/spec-linter.js specs/SPEC-2026-001-purchase.yaml
 *   node scripts/linter/spec-linter.js specs/*.yaml
 *
 * Exit codes:
 *   0 — all specs passed
 *   1 — one or more errors found (CI fails)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'yaml';
import {
  config,
  requiredFields,
  allowedStatuses,
} from '../../lib/config-reader.js';

// ── Load conventions ──────────────────────────────────────────────────────────
let conventions;
try {
  const raw = readFileSync(resolve(process.cwd(), config.paths.conventions_file), 'utf8');
  conventions = yaml.parse(raw);
} catch (err) {
  console.error(`[linter] ✗ Could not load conventions file: ${config.paths.conventions_file}`);
  process.exit(1);
}

const EVENT_PATTERN   = new RegExp(conventions.event_names.pattern);
const EVENT_MAX_LEN   = conventions.event_names.max_length;
const EVENT_MIN_LEN   = conventions.event_names.min_length;
const PARAM_PATTERN   = new RegExp(conventions.parameter_names.pattern);
const FORBIDDEN_PATTERNS = (conventions.event_names.forbidden_suffixes || []).map(
  s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
);

// ── Lint a single spec file ───────────────────────────────────────────────────
function lintSpec(filePath) {
  const errors   = [];
  const warnings = [];

  // Parse YAML
  let spec;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const sanitized = raw.replace(
      /^(\s*[\w.]+\s*):\s*(NEEDS_CLARIFICATION:[^\n]+)$/gm,
      '$1: "$2"'
    );
    spec = yaml.parse(sanitized);
  } catch (err) {
    errors.push(`Could not parse YAML: ${err.message}`);
    return { filePath, errors, warnings };
  }

  // 1. Required fields (sourced from pipeline.config.yaml)
  for (const field of requiredFields) {
    if (!(field in spec)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // 2. Status must be an allowed value (sourced from pipeline.config.yaml)
  if (spec.status && !allowedStatuses.includes(spec.status)) {
    errors.push(`Invalid status "${spec.status}". Allowed values: ${allowedStatuses.join(', ')}`);
  }

  // 3. spec_id format check
  if (spec.spec_id) {
    const prefix = config.spec.id_prefix;
    const digits = config.spec.sequence_digits;
    // Sequence number is optional: supports SPEC-2026-001-event_name and SPEC-2026-event_name
    const specIdPattern = new RegExp(
      `^${prefix}-\\d{4}(-\\d{${digits}})?(-[a-z][a-z0-9_]*)?$`
    );
    if (!specIdPattern.test(spec.spec_id)) {
      errors.push(
        `spec_id "${spec.spec_id}" doesn't match expected format. ` +
        `Example: ${config.spec.id_prefix}-2026-event_name (or ${config.spec.id_prefix}-2026-001-event_name)`
      );
    }
  }

  // 4. Version format check
  if (spec.version) {
    const semverPattern = /^\d+\.\d+\.\d+$/;
    if (config.versioning.format === 'semver' && !semverPattern.test(spec.version)) {
      errors.push(`version "${spec.version}" is not valid semver (expected x.y.z)`);
    }
  }

  // 5. Events validation
  if (spec.events && Array.isArray(spec.events)) {
    for (const event of spec.events) {
      const ename = event.name || event.event_name;

      if (!ename) {
        errors.push(`Event is missing a "name" field`);
        continue;
      }

      // 5a. Event name pattern
      if (!EVENT_PATTERN.test(ename)) {
        errors.push(
          `Event name "${ename}" doesn't match pattern ${conventions.event_names.pattern} ` +
          `(${conventions.event_names.format} only)`
        );
      }

      // 5b. Length
      if (ename.length > EVENT_MAX_LEN) {
        errors.push(`Event name "${ename}" exceeds max length of ${EVENT_MAX_LEN} characters`);
      }
      if (ename.length < EVENT_MIN_LEN) {
        errors.push(`Event name "${ename}" is shorter than min length of ${EVENT_MIN_LEN} characters`);
      }

      // 5c. Forbidden suffixes
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(ename)) {
          errors.push(`Event name "${ename}" uses a forbidden suffix pattern`);
        }
      }

      // 5d. Parameter name validation (only when parameters is an array of objects)
      const params = Array.isArray(event.parameters) ? event.parameters : [];
      for (const param of params) {
        const pname = param.name || param.parameter_name;
        if (pname && !PARAM_PATTERN.test(pname)) {
          errors.push(
            `Parameter "${pname}" on event "${ename}" doesn't match pattern ${conventions.parameter_names.pattern}`
          );
        }
      }

      // 5e. trigger.selector required for interaction-based events      ← ADD FROM HERE
      const INTERACTION_TRIGGERS = ['button_click', 'form_submit'];
      if (INTERACTION_TRIGGERS.includes(event.trigger?.action)) {
        if (!event.trigger?.selector || String(event.trigger.selector).trim() === '') {
          errors.push(
            `[${ename}] trigger.action is "${event.trigger.action}" ` +
            `but trigger.selector is missing. ` +
            `Add a selector (e.g. data-testid, CSS selector) so the Playwright ` +
            `test generator knows what to click.`
          );
        }
      }

      // 5f. trigger.page_path recommended for non-page_load events
      const triggerStr = typeof event.trigger === 'string'
        ? event.trigger.toLowerCase()
        : (event.trigger?.action || '').toLowerCase();

      const isPageLoad = triggerStr.includes('page_load') || triggerStr.includes('page load');

      if (!isPageLoad) {
        const hasPagePath = event.trigger?.page_path &&
          String(event.trigger.page_path).trim() !== '';
        if (!hasPagePath) {
          warnings.push(
            `[${ename}] trigger does not appear to be a page_load but trigger.page_path is not set. ` +
            `Add trigger.page_path (e.g. /products/sample) so Playwright knows which page to load ` +
            `before triggering the interaction.`
          );
        }
      }
    }
  } else if ('events' in spec) {
    warnings.push(`"events" field exists but is empty or not an array`);
  }

  // 6. Warn on NEEDS_CLARIFICATION fields
  const specStr = JSON.stringify(spec);
  const clarificationCount = (specStr.match(/NEEDS_CLARIFICATION/g) || []).length;
  if (clarificationCount > 0) {
    warnings.push(`Spec contains ${clarificationCount} NEEDS_CLARIFICATION placeholder(s) — analyst review required before approval`);
  }

  return { filePath, errors, warnings };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const specFiles = process.argv.slice(2);

if (specFiles.length === 0) {
  console.error('[linter] ✗ No spec files provided.');
  console.error('  Usage: node scripts/linter/spec-linter.js specs/SPEC-2026-001.yaml');
  process.exit(1);
}

let totalErrors   = 0;
let totalWarnings = 0;

for (const file of specFiles) {
  const { filePath, errors, warnings } = lintSpec(file);
  const label = filePath.split('/').pop();

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✓ ${label}`);
  } else {
    if (errors.length > 0) {
      console.log(`✗ ${label} — ${errors.length} error(s)`);
      for (const e of errors) console.log(`    ERROR:   ${e}`);
    }
    if (warnings.length > 0) {
      if (errors.length === 0) console.log(`⚠ ${label} — ${warnings.length} warning(s)`);
      for (const w of warnings) console.log(`    WARNING: ${w}`);
    }
  }

  totalErrors   += errors.length;
  totalWarnings += warnings.length;
}

console.log('');
console.log(`Linter summary: ${specFiles.length} file(s) checked, ${totalErrors} error(s), ${totalWarnings} warning(s)`);

if (totalErrors > 0 && config.ci.linter_fail_on_error) {
  process.exit(1);
}
if (totalWarnings > 0 && config.ci.linter_fail_on_warning) {
  process.exit(1);
}

process.exit(0);
