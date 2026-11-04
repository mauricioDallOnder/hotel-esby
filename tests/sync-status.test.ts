import assert from "node:assert/strict";
import test from "node:test";
import { syncSummary } from "../lib/syncStatus";

const connected = { ready: true, online: true, working: false, pending: [], storageError: "", saving: false, saveError: "", stale: false, refreshing: false };

test("an empty queue is only up to date after it has loaded and data are available", () => {
  assert.equal(syncSummary(connected).color, "success");
  for (const incomplete of [
    { ready: false }, { online: false }, { stale: true }, { refreshing: true },
    { storageError: "Stockage indisponible" },
    { saving: true }, { saveError: "Enregistrement impossible" },
  ]) {
    assert.notEqual(syncSummary({ ...connected, ...incomplete }).color, "success");
  }
});

test("a failed direct save cannot hide a failed refresh after the message is dismissed", () => {
  const stale = { ...connected, stale: true };
  assert.equal(syncSummary({ ...stale, saving: true }).color, "info");
  assert.equal(syncSummary({ ...stale, saveError: "Serveur indisponible" }).color, "error");
  assert.equal(syncSummary(stale).label, "Données à actualiser");
});

test("an interrupted save stays pending until its receipt removes it from the queue", () => {
  const queued = { ...connected, pending: [{ error: "Connexion interrompue" }] };
  assert.match(syncSummary({ ...queued, online: false, working: true }).label, /Hors connexion.*1 en attente/);
  assert.equal(syncSummary(queued).color, "warning");
  assert.match(syncSummary({ ...queued, working: true }).label, /Envoi en cours/);
  assert.equal(syncSummary({ ...queued, pending: [] }).color, "success");
});

test("a refused save remains visible even offline or while another save is sending", () => {
  const summary = syncSummary({ ...connected, online: false, working: true, stale: true, pending: [{ blocked: true }, {}] });
  assert.equal(summary.color, "error");
  assert.equal(summary.label, "1 envoi à vérifier");
  assert.match(summary.detail, /Hors connexion/);
  assert.match(summary.detail, /pas été acceptées/);
});
