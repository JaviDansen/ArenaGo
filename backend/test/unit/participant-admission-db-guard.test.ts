import assert from "node:assert/strict";
import { test } from "node:test";
import { assertParticipantAdmissionTestDatabaseUrls } from "../integration/participant-admission-db-guard";

const url = "postgresql://fixture:placeholder@127.0.0.1:55432/arenago_admission_test";
const env = { NODE_ENV: "test", DATABASE_URL: url, DATABASE_DIRECT_URL: url, EVENTS_TEST_DATABASE_URL: url };
test("Etapa 3 guarda aceita apenas as três URLs idênticas do banco dedicado", () => {
  assert.equal(assertParticipantAdmissionTestDatabaseUrls(env), url);
  for (const candidate of [
    { ...env, NODE_ENV: "development" },
    { ...env, DATABASE_DIRECT_URL: undefined },
    { ...env, EVENTS_TEST_DATABASE_URL: url.replace("127.0.0.1", "localhost") },
    { ...env, DATABASE_URL: url.replace("55432", "5432") },
    { ...env, DATABASE_URL: url.replace("arenago_admission_test", "arenago_events_test") },
    { ...env, DATABASE_URL: url.replace("127.0.0.1", "example.test") },
    { ...env, DATABASE_URL: `${url}?host=example.test` },
  ]) assert.throws(() => assertParticipantAdmissionTestDatabaseUrls(candidate), /SEGURANÇA BLOQUEADA/);
});
