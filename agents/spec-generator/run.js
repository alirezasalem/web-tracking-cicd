/**
 * agents/spec-generator/run.js
 *
 * Main entry point for the AI spec generator agent.
 * Reads a feature brief → calls Claude API → outputs a validated spec YAML.
 *
 * All settings (model, paths, spec_id format, etc.) are read from
 * pipeline.config.yaml via lib/config-reader.js. Do NOT hardcode any values here.
 *
 * Usage:
 *   node run.js --brief-file specs/briefs/FB-001.md
 *   node run.js --brief-file specs/briefs/FB-001.md --sequence 3
 *
 * Output: validated YAML written to stdout.
 * Logs/errors: written to stderr only (so stdout stays clean for pipe redirection).
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import { readConventions } from './conventions_reader.js';
import { querySpecs } from './rag/query.js';
import { formatRagContext } from './rag/inject.js';
import {
  config,
  agentModel,
  agentMaxTokens,
  agentTemperature,
  generatorTag,
  buildSpecId,
  clarificationPlaceholder,
  paths,
} from '../../lib/config-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../');

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const briefFileArg = args[args.indexOf('--brief-file') + 1];
const sequenceArg  = args[args.indexOf('--sequence') + 1];

if (!briefFileArg) {
  console.error('[spec-generator] ✗ Missing required arg: --brief-file <path>');
  console.error('  Example: node run.js --brief-file specs/briefs/FB-001.md');
  process.exit(1);
}

const briefPath = resolve(REPO_ROOT, briefFileArg);
const sequence  = sequenceArg ? parseInt(sequenceArg, 10) : null;

// ── Read inputs ───────────────────────────────────────────────────────────────
let briefContent;
try {
  briefContent = readFileSync(briefPath, 'utf8');
} catch (err) {
  console.error(`[spec-generator] ✗ Could not read brief file: ${briefPath}`);
  process.exit(1);
}

let systemPrompt;
try {
  systemPrompt = readFileSync(paths.generator_prompt, 'utf8');
} catch (err) {
  console.error(`[spec-generator] ✗ Could not read prompt.md at: ${paths.generator_prompt}`);
  process.exit(1);
}

const conventions = readConventions();

// ── RAG: retrieve similar past specs ─────────────────────────────────────────
// Query the spec vector index for the 3 most similar past specs.
// If VOYAGE_API_KEY is not set or the index is empty, this returns '' cleanly.
console.error('[spec-generator] Querying spec index for similar past specs...');
const similarSpecs = await querySpecs(briefContent, 3);
const ragContext   = formatRagContext(similarSpecs);

if (ragContext) {
  console.error(`[spec-generator] ✓ RAG: injecting ${similarSpecs.length} similar spec(s) into prompt`);
} else {
  console.error('[spec-generator] RAG: no similar specs found — generating without examples');
}

// ── Build the full prompt ─────────────────────────────────────────────────────
const specIdExample = sequence
  ? buildSpecId(sequence)
  : buildSpecId(1, 'event_name');

const userMessage = `
## Pipeline Configuration (from pipeline.config.yaml)

- spec_id format: ${config.spec.id_prefix}-{YEAR}-{NNN padded to ${config.spec.sequence_digits} digits}${config.spec.include_event_slug ? `-{event_slug}` : ''}
- Example spec_id: ${specIdExample}
- Initial version: ${config.versioning.initial}
- Required fields: ${config.spec.required_fields.join(', ')}
- Allowed statuses: ${config.spec.allowed_statuses.join(', ')}
- generated_by value: ${generatorTag}
- Clarification placeholder: ${clarificationPlaceholder('reason for missing value')}

## Naming Conventions (from conventions.yaml)

${conventions.raw}

${ragContext}## Feature Brief

${briefContent}

---

Generate a complete analytics spec YAML for the events described in this feature brief.
Follow the pipeline configuration and naming conventions above exactly.
For any field you cannot confidently infer from the brief, use: ${clarificationPlaceholder('brief description of what is needed')}
`.trim();

// ── Call Claude API ───────────────────────────────────────────────────────────
console.error(`[spec-generator] Calling Claude API (${agentModel})...`);
console.error(`[spec-generator] Brief: ${briefFileArg}`);

let response;
try {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: agentModel,
      max_tokens: agentMaxTokens,
      temperature: agentTemperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[spec-generator] ✗ Claude API error ${res.status}: ${body}`);
    process.exit(1);
  }

  response = await res.json();
} catch (err) {
  console.error(`[spec-generator] ✗ Network error calling Claude API: ${err.message}`);
  process.exit(1);
}

// ── Extract YAML from response ────────────────────────────────────────────────
const rawText = response.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

// Strip optional ```yaml ... ``` fences if the model wrapped output
const yamlText = rawText
  .replace(/^```ya?ml\s*/i, '')
  .replace(/```\s*$/, '')
  .trim();

// ── Validate output is parseable YAML ────────────────────────────────────────
let parsedSpec;
try {
  const sanitizedYaml = yamlText.replace(
    /^(\s*\w+):\s*(NEEDS_CLARIFICATION:[^\n]+)$/gm,
    '$1: "$2"'
  );
  parsedSpec = yaml.parse(sanitizedYaml);
} catch (err) {
  console.error(`[spec-generator] ✗ Claude returned invalid YAML: ${err.message}`);
  console.error('--- Raw output ---');
  console.error(rawText);
  process.exit(1);
}

// ── Validate required fields ──────────────────────────────────────────────────
const requiredFields = config.spec.required_fields;
const missing = requiredFields.filter(f => !(f in parsedSpec));
if (missing.length > 0) {
  console.error(`[spec-generator] ✗ Generated spec is missing required fields: ${missing.join(', ')}`);
  process.exit(1);
}

// ── Validate status ───────────────────────────────────────────────────────────
if (!config.spec.allowed_statuses.includes(parsedSpec.status)) {
  console.error(`[spec-generator] ✗ Invalid status "${parsedSpec.status}". Allowed: ${config.spec.allowed_statuses.join(', ')}`);
  process.exit(1);
}

// ── Write to stdout ───────────────────────────────────────────────────────────
console.error(`[spec-generator] ✓ Spec generated: ${parsedSpec.spec_id}`);
process.stdout.write(yamlText + '\n');
