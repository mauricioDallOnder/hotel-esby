import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { createId } from "../lib/domain";
import { buildRoomChecklist } from "../lib/roomChecklistPdf";
import { roomChecks, type RoomEntry, type RoomInspection } from "../lib/rooms";

const date = "2026-10-20";
const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", schemaVersion: 6, id: createId(), room: "114", date,
  inspectedAt: `${date}T10:00:00Z`, actor: "Marie", occupied: false,
  condition: "bon", cleaning: "faite", bugs: "non", carpet: "ok", carpetNotes: "",
  microwave: "oui", microwaveCleaning: "propre", fridgeCleaning: "propre",
  notes: "", photosData: [], checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
  ...patch,
});
const saved = (patch: Partial<RoomInspection> = {}): RoomInspection => ({
  ...entry(), version: 1, updatedAt: `${date}T10:00:00Z`, submissionHash: "hash",
  photoIds: [], photoId: null, ...patch,
});

// These documents use standard fonts and compressed page streams, without embedded images.
function pageText(doc: ReturnType<typeof buildRoomChecklist>) {
  return [...doc.output().matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match => {
    const stream = new TextDecoder("windows-1252").decode(inflateSync(Buffer.from(match[1], "binary")));
    return [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
      .map(text => text[1].replace(/\\([\\()])/g, "$1"))
      .join(" ").replace(/\s+/g, " ").trim();
  });
}

test("a blank checklist fits one portrait A4 page and includes every room inspection point", () => {
  const doc = buildRoomChecklist({ hotelName: "Hôtel test", date, mode: "blank" });
  assert.match(doc.output(), /^%PDF/);
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(doc.internal.pageSize.getHeight() - 297) < 0.1);
  const [text] = pageText(doc);
  for (const { label } of roomChecks) assert.ok(text.includes(label), `Missing equipment: ${label}`);
  for (const label of ["Chambre :", "Date du contrôle :", "Inspecteur :", "Occupation au contrôle", "État général", "Ménage", "Cafards / nuisibles", "Moquette", "Micro-ondes", "Propreté du micro-ondes", "Minibar / réfrigérateur", "Propreté du minibar", "Observations et problèmes constatés"])
    assert.ok(text.includes(label), `Missing field: ${label}`);
  assert.match(text, /Fiche vierge/);
  assert.match(text, /OK Problème Absent/);
  assert.match(text, /Chauffage \/ radiateur Libre Caché/);
  assert.match(text, /État général Bon état À revoir Mauvais état Chambre encombrée d’affaires Non Oui/);
  assert.equal((text.match(/Chambre encombrée d’affaires/g) || []).length, 1);
  assert.match(text, /Page 1 \/ 1/);
  assert.doesNotMatch(text, /Enregistré sur le serveur/);
});

test("printed results retain the selected problem type and precise fitting even without general notes", () => {
  const record = saved({ checks: roomChecks.map(check => ({ key: check.key, result: check.key === "damage" ? "probleme" : "ok" })),
    problemDetails: [{ key: "damage", problemType: "electrical_socket", description: "Prise du mur nord près de la commode." }], notes: "" });
  const doc = buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms: [record.room], history: [record] });
  const text = pageText(doc).join(" ");
  assert.match(text, /Prise électrique cassée ou mal fixée/);
  assert.match(text, /Prise du mur nord près de la commode/);
  assert.doesNotMatch(text, /Aucune observation saisie/);
});

test("latest checklists deduplicate selected rooms and choose by inspection date and time up to the export date", () => {
  const history = [
    saved({ notes: "OLDER_DATE", date: "2026-10-19", inspectedAt: "2026-10-21T18:00:00Z" }),
    saved({ notes: "EARLIER_VISIT", inspectedAt: `${date}T08:00:00Z`, updatedAt: "2026-10-21T18:00:00Z" }),
    saved({ notes: "LATEST_VISIT", inspectedAt: `${date}T11:00:00Z` }),
    saved({ notes: "FUTURE_VISIT", date: "2026-10-21", inspectedAt: "2026-10-21T12:00:00Z" }),
    saved({ room: "115", notes: "EARLIER_LEGACY_TIME", inspectedAt: undefined, updatedAt: `${date}T08:00:00Z` }),
    saved({ room: "115", notes: "LATEST_LEGACY_TIME", inspectedAt: undefined, updatedAt: `${date}T12:00:00Z` }),
    saved({ room: "116", notes: "UNSELECTED_ROOM" }),
  ];
  const doc = buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms: ["115", "114", "114", "999"], history });
  const pages = pageText(doc), text = pages.join(" ");
  assert.equal(doc.getNumberOfPages(), 2);
  assert.match(pages[0], /Chambre : 114/);
  assert.match(pages[1], /Chambre : 115/);
  assert.equal((text.match(/Chambre : 114/g) || []).length, 1);
  assert.match(text, /LATEST_VISIT/);
  assert.match(text, /LATEST_LEGACY_TIME/);
  assert.doesNotMatch(text, /OLDER_DATE|EARLIER_VISIT|FUTURE_VISIT|EARLIER_LEGACY_TIME|UNSELECTED_ROOM|Chambre : 999/);
  for (const selectedRooms of [[], ["999"]]) {
    assert.throws(() => buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms, history }), /Aucune chambre sélectionnée/);
  }
});

test("printed results distinguish missing records, absent equipment, unchecked or legacy answers and pending or blocked submissions", () => {
  const legacy = saved({
    schemaVersion: undefined, occupied: null, cleaning: null, bugs: undefined, microwave: "non_verifie",
    microwaveCleaning: undefined, fridgeCleaning: undefined,
    checks: roomChecks.filter(check => !["door_handle_clear", "door_closer", "radiator_clear", "room_clutter"].includes(check.key)).map(check => ({
      key: check.key, result: check.key === "taps" || check.key === "fridge" ? "non_verifie" : "ok",
    })),
  });
  const absent = saved({ room: "115", microwave: "non", checks: roomChecks.map(check => ({
    key: check.key, result: check.key === "fridge" || check.key === "smoke" ? "absent" : "ok",
  })) });
  const pending = entry({ room: "116" }), blocked = entry({ room: "117" });
  const doc = buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms: ["114", "115", "116", "117", "118"], history: [legacy, absent, pending, blocked], blockedIds: [blocked.id] });
  const pages = pageText(doc);
  const roomText = (room: string) => {
    const text = pages.find(page => page.includes(`Chambre : ${room}`));
    assert.ok(text, `Missing room: ${room}`);
    return text;
  };
  assert.match(roomText("114"), /Robinets fonctionnels Non vérifié/);
  assert.match(roomText("114"), /Ferme-porte \(fermeture automatique\) Non renseigné/);
  assert.match(roomText("114"), /Chauffage \/ radiateur Non renseigné/);
  assert.match(roomText("114"), /Chambre encombrée d’affaires Non renseigné/);
  assert.match(roomText("114"), /Occupation au contrôle Non renseignée/);
  assert.match(roomText("114"), /Minibar \/ réfrigérateur Non vérifié/);
  assert.match(roomText("114"), /Enregistré sur le serveur/);
  assert.match(roomText("115"), /Détecteur de fumée fonctionnel Absent/);
  assert.match(roomText("115"), /Minibar fonctionnel Absent/);
  assert.match(roomText("115"), /Minibar \/ réfrigérateur Absent/);
  assert.match(roomText("115"), /Propreté du micro-ondes Non applicable - absent/);
  assert.match(roomText("115"), /Propreté du minibar Non applicable - absent/);
  assert.match(roomText("116"), /En attente d'envoi/);
  assert.match(roomText("116"), /Minibar \/ réfrigérateur Présent/);
  assert.doesNotMatch(roomText("116"), /Enregistré sur le serveur|Envoi bloqué/);
  assert.match(roomText("117"), /Envoi bloqué/);
  assert.doesNotMatch(roomText("117"), /Enregistré sur le serveur|En attente d'envoi/);
  assert.match(roomText("118"), /Aucun contrôle disponible/);
  assert.match(roomText("118"), /Fiche vierge/);
  assert.doesNotMatch(roomText("118"), /Enregistré sur le serveur|Oui \/ OK/);
});

test("printed radiator answers distinguish Libre and Caché", () => {
  const history = [saved(), saved({ room: "115", checks: roomChecks.map(check => ({
    key: check.key, result: check.key === "radiator_clear" ? "probleme" : "ok",
  })) })];
  const doc = buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms: ["114", "115"], history });
  const pages = pageText(doc);
  assert.match(pages[0], /Chauffage \/ radiateur Libre/);
  assert.match(pages[1], /Chauffage \/ radiateur Caché/);
  assert.doesNotMatch(pages.join(" "), /Chauffage \/ radiateur (Oui \/ OK|Problème)/);
});

test("printed clutter answers use Non and Oui in the room condition section", () => {
  const history = [saved(), saved({ room: "115", checks: roomChecks.map(check => ({
    key: check.key, result: check.key === "room_clutter" ? "probleme" : "ok",
  })) })];
  const doc = buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms: ["114", "115"], history });
  const pages = pageText(doc);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /État général Bon état Chambre encombrée d’affaires Non/);
  assert.match(pages[1], /État général Bon état Chambre encombrée d’affaires Oui/);
  assert.doesNotMatch(pages.join(" "), /Chambre encombrée d’affaires (Oui \/ OK|Problème|Absent)/);
  assert.doesNotMatch(pages.join(" "), /Chambre encombrée d’affaires : Chambre encombrée d’affaires/);
});

test("long carpet details and observations continue across pages through the final marker", () => {
  const record = saved({
    carpet: "tachee", carpetNotes: "Tache repérée près de la fenêtre. ".repeat(100) + "FIN_MOQUETTE",
    notes: "Observation détaillée à conserver. ".repeat(100) + "FIN_OBSERVATIONS",
    photoIds: ["photo-1", "photo-2"],
  });
  assert.ok(record.carpetNotes.length <= 4000 && record.notes.length <= 4000);
  const doc = buildRoomChecklist({ hotelName: "Test", date, mode: "latest", selectedRooms: ["114"], history: [record] });
  const pages = pageText(doc);
  assert.ok(doc.getNumberOfPages() > 1);
  assert.match(pages.join(" "), /FIN_MOQUETTE/);
  assert.match(pages.at(-1)!, /FIN_OBSERVATIONS/);
  assert.match(pages.at(-1)!, /2 photo\(s\) associée\(s\), consultable\(s\) dans l'application/);
  pages.forEach((text, index) => {
    assert.ok(text.includes(`Page ${index + 1} / ${pages.length}`));
    if (index) assert.match(text, /Chambre 114 \(suite\)/);
  });
});
