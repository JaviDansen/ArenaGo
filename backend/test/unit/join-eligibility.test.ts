import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventAvailabilityResult } from "../../src/events/event-availability";
import { combineJoinEligibility } from "../../src/participations/join-eligibility";

function availableEvent(): Extract<EventAvailabilityResult, { eventExists: true }> {
  return {
    eventExists: true,
    eventId: "event-1",
    ready: true,
    withinEntryWindow: true,
    eventAcceptingNewEntries: true,
    checks: {
      nameAndAccessCode: true,
      validScheduleAndTimezone: true,
      externalQueueConfigured: true,
      hasAuthorizedStaff: true,
      hasAvailableStation: true,
      hasOperationalCapacity: true,
    },
    missing: [],
    cutoffAt: new Date("2030-01-01T14:00:00Z"),
  };
}

function eligibleFacts() {
  return {
    eventAvailability: availableEvent(),
    userExists: true,
    hasCompletedQuestionnaire: true,
    questionnaireVersionValid: true,
    hasSelectedGames: true,
    hasCurrentParticipation: false,
  };
}

test("returns eligible when event, profile and account prerequisites pass", () => {
  const result = combineJoinEligibility(eligibleFacts());
  assert.equal(result.eligible, true);
  assert.equal(result.checks.eventAcceptingNewEntries, true);
  assert.deepEqual(result.blockingReasons, []);
});

test("reports event readiness and window impediments", () => {
  const event = availableEvent();
  const result = combineJoinEligibility({
    ...eligibleFacts(),
    eventAvailability: {
      ...event,
      ready: false,
      withinEntryWindow: false,
      eventAcceptingNewEntries: false,
      missing: ["EVENT_NOT_STARTED", "EVENT_HAS_NO_AVAILABLE_STATION"],
    },
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockingReasons, ["EVENT_NOT_READY", "EVENT_NOT_STARTED"]);
});

test("maps the temporal cutoff and administrative closure to registration closed", () => {
  const event = availableEvent();
  const temporal = combineJoinEligibility({
    ...eligibleFacts(),
    eventAvailability: {
      ...event,
      withinEntryWindow: false,
      eventAcceptingNewEntries: false,
      missing: ["EVENT_ENTRY_CLOSED"],
    },
  });
  assert.ok(temporal.blockingReasons.includes("EVENT_REGISTRATION_CLOSED"));

  const administrative = combineJoinEligibility({
    ...eligibleFacts(),
    eventAvailability: {
      ...event,
      eventAcceptingNewEntries: false,
      missing: ["EVENT_ADMIN_CLOSING"],
    },
  });
  assert.ok(administrative.blockingReasons.includes("EVENT_REGISTRATION_CLOSED"));
});

test("reports incomplete questionnaire, invalid version and absent game as one profile code", () => {
  const result = combineJoinEligibility({
    ...eligibleFacts(),
    hasCompletedQuestionnaire: false,
    questionnaireVersionValid: false,
    hasSelectedGames: false,
  });
  assert.deepEqual(result.blockingReasons, ["PROFILE_INCOMPLETE"]);
});

test("blocks a user with a current participation", () => {
  const result = combineJoinEligibility({ ...eligibleFacts(), hasCurrentParticipation: true });
  assert.deepEqual(result.blockingReasons, ["PARTICIPATION_ALREADY_CURRENT"]);
});

test("preserves multiple independent impediments and explicit event absence", () => {
  const result = combineJoinEligibility({
    ...eligibleFacts(),
    eventAvailability: { eventExists: false },
    userExists: false,
    hasCompletedQuestionnaire: false,
    questionnaireVersionValid: false,
    hasSelectedGames: false,
    hasCurrentParticipation: true,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.eventExists, false);
  assert.equal(result.userExists, false);
  assert.deepEqual(result.blockingReasons, [
    "EVENT_NOT_FOUND",
    "USER_NOT_FOUND",
    "PROFILE_INCOMPLETE",
    "PARTICIPATION_ALREADY_CURRENT",
  ]);
});
