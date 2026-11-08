import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEventOperationalCapacityResult } from "../../src/events/event-operational-capacity";

test("capacidade exige Staff apto e estação disponível", () => {
  assert.deepEqual(buildEventOperationalCapacityResult(true, true), {
    hasAuthorizedStaff: true,
    hasAvailableStation: true,
    hasOperationalCapacity: true,
  });
  assert.equal(buildEventOperationalCapacityResult(false, true).hasOperationalCapacity, false);
  assert.equal(buildEventOperationalCapacityResult(true, false).hasOperationalCapacity, false);
  assert.deepEqual(buildEventOperationalCapacityResult(false, false), {
    hasAuthorizedStaff: false,
    hasAvailableStation: false,
    hasOperationalCapacity: false,
  });
});
