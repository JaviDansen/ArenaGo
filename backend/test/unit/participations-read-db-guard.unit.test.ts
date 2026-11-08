import assert from "node:assert/strict";
import { test } from "node:test";
import { assertParticipationsReadTestDatabaseUrls } from "../integration/participations-read-db-guard";

const allowed = "postgresql://fixture:placeholder@127.0.0.1:55432/arenago_events_test";
const urls = (value: string | undefined) => ({
  DATABASE_URL: value,
  DATABASE_DIRECT_URL: value,
  EVENTS_TEST_DATABASE_URL: value,
});

test("E08-EST04 valida as três URLs sem abrir conexão PostgreSQL", async (t) => {
  await t.test("aceita o destino local com credenciais explícitas", () => {
    assert.equal(assertParticipationsReadTestDatabaseUrls(urls(allowed)), allowed);
    assert.equal(assertParticipationsReadTestDatabaseUrls(urls(allowed.replace("postgresql:", "postgres:"))),
      allowed.replace("postgresql:", "postgres:"));
  });

  await t.test("rejeita host remoto, porta e banco fora do destino da fixture", () => {
    for (const value of [
      allowed.replace("127.0.0.1", "db.example.test"),
      allowed.replace("55432", "55433"),
      allowed.replace("arenago_events_test", "arenago_test"),
      allowed.replace("127.0.0.1", "localhost"),
    ]) assert.throws(() => assertParticipationsReadTestDatabaseUrls(urls(value)));
  });

  await t.test("rejeita parâmetros de host e porta, inclusive codificados e com outra caixa", () => {
    for (const query of ["?host=servidor-remoto", "?h%6fst=servidor-remoto", "?HOST=servidor-remoto",
      "?port=5432", "?p%6frt=5432", "?PORT=55432", "?host=127.0.0.1"]) {
      assert.throws(() => assertParticipationsReadTestDatabaseUrls(urls(allowed + query)));
    }
  });

  await t.test("rejeita database, dbname, outras queries e fragmentos", () => {
    for (const suffix of ["?database=outro", "?dbname=outro", "?data%62ase=outro", "?DBNAME=outro",
      "?application_name=teste", "?", "#fragmento", "#"]) {
      assert.throws(() => assertParticipationsReadTestDatabaseUrls(urls(allowed + suffix)));
    }
  });

  await t.test("rejeita credenciais ausentes, protocolo errado e URLs ausentes", () => {
    for (const value of [allowed.replace("fixture:placeholder@", "fixture@"),
      allowed.replace("fixture:placeholder@", ":placeholder@"), allowed.replace("postgresql:", "https:"), undefined]) {
      assert.throws(() => assertParticipationsReadTestDatabaseUrls(urls(value)));
    }
  });

  await t.test("rejeita ausência ou divergência em qualquer uma das três variáveis", () => {
    for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const) {
      assert.throws(() => assertParticipationsReadTestDatabaseUrls({ ...urls(allowed), [name]: undefined }));
      assert.throws(() => assertParticipationsReadTestDatabaseUrls({ ...urls(allowed), [name]: allowed.replace("postgresql:", "postgres:") }));
    }
  });
});
