/**
 * agents/spec-generator/rag/inject.js
 *
 * Formats the results from query.js into a prompt-ready string block
 * that gets injected into the Claude userMessage in run.js.
 *
 * Keeping this in its own file makes it easy to tune the prompt framing
 * without touching run.js logic.
 */

/**
 * Format retrieved specs as a prompt section.
 *
 * @param {Array<{spec_id, filename, text, score}>} results — from querySpecs()
 * @returns {string} — ready to embed in the Claude prompt, or '' if no results
 */
export function formatRagContext(results) {
  if (!results || results.length === 0) return '';

  const blocks = results.map((r, i) => {
    return `### Similar spec ${i + 1}: ${r.spec_id} (similarity: ${r.score.toFixed(2)})\n\n${r.text}`;
  });

  return `## Reference: Similar Past Specs

The following specs from our library are most similar to this brief.
Use them as structural and naming reference — mirror their parameter naming,
trigger patterns, and dataLayer shape where appropriate.
Do NOT copy them verbatim. The new brief may describe a different event
with different requirements.

${blocks.join('\n\n---\n\n')}

---
`;
}
