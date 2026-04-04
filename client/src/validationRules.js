/**
 * Validation helpers.
 */

// ── Summary helpers ──

export function getSectionSummary(results) {
  const pass = results.filter((r) => r.status === 'pass').length;
  const warning = results.filter((r) => r.status === 'warning').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  return { pass, warning, fail, total: results.length };
}
