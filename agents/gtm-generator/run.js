#!/usr/bin/env node
/**
 * agents/gtm-generator/run.js
 *
 * Reads a spec YAML file and generates an importable GTM client-side
 * container JSON export (one file per event).
 *
 * Output: gtm/[event_name]-gtm-export.json
 *
 * Usage:
 *   node agents/gtm-generator/run.js specs/my-spec.yaml
 *   node agents/gtm-generator/run.js          # auto-detects changed spec via git
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const PIPELINE_CONFIG_PATH = 'pipeline.config.yaml';
const OUTPUT_DIR           = 'gtm-assets';
const FALLBACK_MEASUREMENT_ID = 'G-XXXXXXXXXX';

// IDs start here so they don't clash with GTM's own built-in IDs (1–4 range)
// Each event file is self-contained, so no cross-file collision risk.
const ID_BASE = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(PIPELINE_CONFIG_PATH)) return {};
  try {
    return yaml.load(fs.readFileSync(PIPELINE_CONFIG_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

function getMeasurementId(config) {
  const id = config?.ga4_measurement_id;
  if (!id || id === FALLBACK_MEASUREMENT_ID || id.trim() === '') {
    return FALLBACK_MEASUREMENT_ID;
  }
  return id.trim();
}

function getContainerMeta(config) {
  return {
    accountId:   String(config?.gtm?.account_id  || '0000000000'),
    containerId: String(config?.gtm?.container_id || '000000000'),
  };
}

function loadSpec(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Sanitize NEEDS_CLARIFICATION: values that break YAML parser
  const sanitized = raw.replace(
    /:\s*(NEEDS_CLARIFICATION:[^\n]*)/g,
    ': "$1"'
  );
  return yaml.parse(sanitized);
}

function resolveSpecFile(arg) {
  if (arg) return arg;

  // Auto-detect: find spec files changed in the last commit on main
  try {
    const changed = execSync('git diff --name-only HEAD~1 HEAD -- "specs/**/*.yaml"', {
      encoding: 'utf8',
    }).trim();
    if (changed) {
      const files = changed.split('\n').filter(Boolean);
      if (files.length > 0) return files[0];
    }
  } catch {
    // shallow clone or no previous commit — fall through
  }

  // Last resort: find any spec in specs/
  const found = execSync('find specs -name "*.yaml" | head -1', { encoding: 'utf8' }).trim();
  if (found) return found;

  throw new Error('No spec file provided and none could be auto-detected.');
}

// ─── ID helpers ──────────────────────────────────────────────────────────────

function makeId(offset) {
  return String(ID_BASE + offset);
}

// ─── GTM JSON builders ───────────────────────────────────────────────────────

/**
 * Build one DLV variable object per spec parameter.
 * Variable name convention: "DLV - param_name"
 * Reads from dataLayer key matching the parameter name exactly.
 */
function buildVariables(params, accountId, containerId) {
  return params.map((param, i) => ({
    accountId,
    containerId,
    variableId: makeId(i + 10),           // 110, 111, 112 …
    name:       `DLV - ${param.name}`,
    type:       'v',                        // GTM dataLayer variable type
    parameter: [
      { type: 'INTEGER',  key: 'dataLayerVersion', value: '2' },
      { type: 'BOOLEAN',  key: 'setDefaultValue',  value: 'false' },
      { type: 'TEMPLATE', key: 'name',             value: param.name },
    ],
    fingerprint: String(Date.now() + i),
    formatValue: {},
  }));
}

/**
 * Build one CUSTOM_EVENT trigger for the event name.
 */
function buildTrigger(eventName, accountId, containerId) {
  return {
    accountId,
    containerId,
    triggerId: makeId(1),                  // 101
    name:      `Event - ${eventName}`,
    type:      'CUSTOM_EVENT',
    customEventFilter: [
      {
        type: 'EQUALS',
        parameter: [
          { type: 'TEMPLATE', key: 'arg0', value: '{{_event}}' },
          { type: 'TEMPLATE', key: 'arg1', value: eventName },
        ],
      },
    ],
    fingerprint: String(Date.now()),
  };
}

/**
 * Build one GA4 event tag (gaawe) wiring all DLV variables as parameters.
 */
function buildTag(eventName, params, measurementId, triggerId, accountId, containerId) {
  const eventSettingsTable = params.map((param) => ({
    type: 'MAP',
    map: [
      { type: 'TEMPLATE', key: 'parameter',      value: param.name.includes('.') ? param.name.split('.').pop() : param.name },
      { type: 'TEMPLATE', key: 'parameterValue', value: '{{DLV - ' + param.name + '}}' },
    ],
  }));

  return {
    accountId,
    containerId,
    tagId: makeId(2),                      // 102
    name:  `GA4 - ${eventName}`,
    type:  'gaawe',
    parameter: [
      { type: 'BOOLEAN',  key: 'sendEcommerceData',    value: 'false' },
      { type: 'LIST',     key: 'eventSettingsTable',   list: eventSettingsTable },
      { type: 'TEMPLATE', key: 'eventName',            value: eventName },
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: measurementId },
    ],
    fingerprint:     String(Date.now() + 1),
    firingTriggerId: [triggerId],
    tagFiringOption: 'ONCE_PER_EVENT',
    monitoringMetadata: { type: 'MAP' },
    consentSettings:    { consentStatus: 'NOT_SET' },
  };
}

/**
 * Assemble the full GTM export envelope (same structure as a GTM JSON export).
 */
function buildExport({ eventName, params, measurementId, accountId, containerId, containerName }) {
  const variables = buildVariables(params, accountId, containerId);
  const trigger   = buildTrigger(eventName, accountId, containerId);
  const tag       = buildTag(eventName, params, measurementId, trigger.triggerId, accountId, containerId);

  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
    containerVersion: {
      path: `accounts/${accountId}/containers/${containerId}/versions/0`,
      accountId,
      containerId,
      containerVersionId: '0',
      container: {
        path: `accounts/${accountId}/containers/${containerId}`,
        accountId,
        containerId,
        name:        containerName || 'Web Tracking CI/CD',
        publicId:    '',
        usageContext: ['WEB'],
        fingerprint: String(Date.now()),
        features: {
          supportUserPermissions: true,
          supportEnvironments:    true,
          supportWorkspaces:      true,
          supportGtagConfigs:     false,
          supportBuiltInVariables: true,
          supportClients:         false,
          supportFolders:         true,
          supportTags:            true,
          supportTemplates:       true,
          supportTriggers:        true,
          supportVariables:       true,
          supportVersions:        true,
          supportZones:           true,
          supportTransformations: false,
        },
      },
      tag:      [tag],
      trigger:  [trigger],
      variable: variables,
      builtInVariable: [
        { accountId, containerId, type: 'PAGE_URL',      name: 'Page URL' },
        { accountId, containerId, type: 'PAGE_HOSTNAME', name: 'Page Hostname' },
        { accountId, containerId, type: 'PAGE_PATH',     name: 'Page Path' },
        { accountId, containerId, type: 'REFERRER',      name: 'Referrer' },
        { accountId, containerId, type: 'EVENT',         name: 'Event' },
      ],
      fingerprint: String(Date.now() + 2),
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const specFile     = resolveSpecFile(process.argv[2]);
  const config       = loadConfig();
  const measurementId = getMeasurementId(config);
  const { accountId, containerId } = getContainerMeta(config);
  const containerName = config?.gtm?.container_name || 'Web Tracking CI/CD';

  console.log(`[gtm-generator] Reading spec: ${specFile}`);

  const spec = loadSpec(specFile);

  if (!spec?.events?.length) {
    console.error('[gtm-generator] No events found in spec. Exiting.');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let generated = 0;

  for (const event of spec.events) {
    const eventName = event.name;
    // Read variables from dataLayer block, not parameters.
    // Rules:
    // - Skip 'event' key (trigger name, not a variable)
    // - Skip top-level value/currency if ecommerce block exists (duplicates)
    // - ecommerce object → one DLV for the whole object + one DLV per first-level child key
    // - items stays as a single variable (no per-item-field expansion)
    const dl = event.dataLayer || {};
    const hasEcommerce = dl.ecommerce !== undefined;
    const skipKeys = new Set(['event']);
    if (hasEcommerce) {
      skipKeys.add('value');
      skipKeys.add('currency');
    }
    const params = [];
    for (const k of Object.keys(dl)) {
      if (skipKeys.has(k)) continue;
      if (k === 'ecommerce') {
        // one variable for the whole ecommerce object
        params.push({ name: 'ecommerce' });
        // one variable per first-level key inside ecommerce (e.g. ecommerce.currency)
        const eco = dl.ecommerce || {};
        for (const ek of Object.keys(eco)) {
          params.push({ name: 'ecommerce.' + ek });
        }
        continue;
      }
      if (typeof dl[k] === 'object' && dl[k] !== null) continue; // skip other nested objects
      params.push({ name: k });
    }

    if (!eventName) {
      console.warn('[gtm-generator] Skipping event with no name.');
      continue;
    }

    console.log(`[gtm-generator] Generating GTM config for: ${eventName} (${params.length} params)`);

    const exportJson = buildExport({
      eventName,
      params,
      measurementId,
      accountId,
      containerId,
      containerName,
    });

    const outFile = path.join(OUTPUT_DIR, `${eventName}-gtm-export.json`);
    fs.writeFileSync(outFile, JSON.stringify(exportJson, null, 2));
    console.log(`[gtm-generator] Written: ${outFile}`);
    generated++;
  }

  if (generated === 0) {
    console.error('[gtm-generator] No GTM configs generated. Check spec format.');
    process.exit(1);
  }

  console.log(`[gtm-generator] Done. ${generated} file(s) generated in ${OUTPUT_DIR}/`);
}

main();
