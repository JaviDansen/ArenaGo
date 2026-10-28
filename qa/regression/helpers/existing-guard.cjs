// Execute only the existing pure unit tests, never integration module setup.
const { loadTs } = require('./source.cjs');
const guard = loadTs('backend/test/integration/test-db-guard.ts', {
  'node:url': require('node:url'),
});
loadTs('backend/test/unit/test-db-guard.unit.test.ts', {
  'node:assert/strict': require('node:assert/strict'),
  'node:test': require('node:test'),
  '../integration/test-db-guard': guard,
});
