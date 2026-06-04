/**
 * lib/config-reader.js
 * Shared config loader for the Web Tracking CI/CD pipeline.
 *
 * Reads pipeline.config.yaml from the repo root and exports typed helpers
 * used by every script in the repo — spec-generator, linter, codegen,
 * Playwright tests, and any future tooling.
 *
 * Usage (ESM):
 *   import { config, buildSpecId, paths, agentModel } from '../../lib/config-reader.js';
 *
 * The relative path to lib/ depends on where your script lives:
 *   agents/spec-generator/run.js      → '../../lib/config-reader.js'
 *   scripts/linter/spec-linter.js     → '../../lib/config-reader.js'
 *   scripts/codegen/generate-artifacts.js → '../../lib/config-reader.js'
 *   tests/playwright/tracking.spec.js → '../../lib/config-reader.js'
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

// ── Locate repo root (lib/ is one level below root) ─────────────────────────
const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '../');
const CONFIG_PATH = resolve(REPO_ROOT, 'pipeline.config.yaml');

// ── Load & parse ─────────────────────────────────────────────────────────────
let _raw;
try {
  _raw = yaml.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error(`[config-reader] ✗ Failed to load pipeline.config.yaml`);
  console.error(`  Expected at: ${CONFIG_PATH}`);
  console.error(`  Error: ${err.message}`);
  process.exit(1);
}

/** The full parsed config object. Use specific helpers below where possible. */
export const config = _raw;

// ── Path helpers ─────────────────────────────────────────────────────────────

/**
 * All configured paths, resolved to absolute paths from repo root.
 * Use these in scripts instead of hardcoding paths.
 *
 * @example
 * import { paths } from '../../lib/config-reader.js';
 * const spec = readFileSync(paths.specs_output_dir + 'SPEC-2026-001.yaml');
 */
export const paths = Object.fromEntries(
  Object.entries(config.paths).map(([key, rel]) => [key, resolve(REPO_ROOT, rel)])
);

// ── Spec ID helpers ──────────────────────────────────────────────────────────

function resolvedYear() {
  const s = config.spec;
  return s.year_source === 'fixed'
    ? String(s.year_fixed)
    : String(new Date().getFullYear());
}

/**
 * Build a spec_id from a sequence number and optional event slug.
 *
 * Reads format rules from pipeline.config.yaml — changing the config
 * changes the output here automatically.
 *
 * @param {number} sequence    - e.g. 3
 * @param {string} [eventSlug] - e.g. 'view_cart'
 * @returns {string}           - e.g. 'SPEC-2026-003-view_cart'
 *
 * @example
 * buildSpecId(3, 'view_cart')  // → 'SPEC-2026-003-view_cart'
 * buildSpecId(3)               // → 'SPEC-2026-003'  (if include_event_slug is false)
 */
export function buildSpecId(sequence, eventSlug = '') {
  const s = config.spec;
  const year   = resolvedYear();
  const padded = String(sequence).padStart(s.sequence_digits, '0');
  const base   = `${s.id_prefix}-${year}-${padded}`;

  if (s.include_event_slug && eventSlug) {
    return `${base}${s.event_slug_separator}${eventSlug}`;
  }
  return base;
}

/**
 * Build the output filename for a spec file.
 *
 * @param {string} specId - e.g. 'SPEC-2026-003-view_cart'
 * @returns {string}       - e.g. 'SPEC-2026-003-view_cart.yaml'
 */
export function buildSpecFilename(specId) {
  return `${specId}${config.spec.file_extension}`;
}

// ── Linter helpers ───────────────────────────────────────────────────────────

/** Fields every spec must contain. Used by spec-linter.js. */
export const requiredFields = config.spec.required_fields;

/** Allowed status values. Used by spec-linter.js. */
export const allowedStatuses = config.spec.allowed_statuses;

// ── Agent helpers ────────────────────────────────────────────────────────────

/** Claude model to use for spec generation. */
export const agentModel = config.agent.model;

/** max_tokens for Claude API calls. */
export const agentMaxTokens = config.agent.max_tokens;

/** Temperature for Claude API calls. */
export const agentTemperature = config.agent.temperature;

/** Tag written into every generated spec's generated_by field. */
export const generatorTag = config.agent.generator_tag;

/**
 * Build the clarification placeholder string.
 * Written into spec fields the agent can't infer from the brief.
 *
 * @param {string} [reason] - why clarification is needed
 * @returns {string}         - e.g. 'NEEDS_CLARIFICATION: trigger condition unclear'
 */
export function clarificationPlaceholder(reason = '') {
  if (!reason) return config.agent.clarification_placeholder;
  return config.agent.clarification_format.replace('{reason}', reason);
}

// ── Playwright helpers ───────────────────────────────────────────────────────

/**
 * Base URL for Playwright tests.
 * Respects TEST_BASE_URL env var so CI can override without touching config.
 */
export const playwrightBaseUrl =
  process.env.TEST_BASE_URL || config.playwright.base_url;

/** dataLayer variable path used in Playwright assertions. */
export const dataLayerVariable = config.playwright.dataLayer_variable;

/** Timeout (ms) Playwright waits for a dataLayer push event. */
export const playwrightTimeout = config.playwright.timeout_ms;
