import assert from "node:assert/strict";
import test from "node:test";
import { parseSejours } from "../lib/parseSejours";
import { makeSejoursFixture } from "./fixtures/sejours";

const file = (date: string, headers?: string[]) => new File([new Uint8Array(makeSejoursFixture(headers))], `Sejours_${date}_${date}.xlsx`);

test("la date sélectionne le séjour fusionné, les cellules blanches et les deux rouges du planning", async () => {
  const report = await parseSejours(file("20261120"));
  assert.deepEqual(report, {date:"2026-11-20", ignoredRooms:[], rows:[
    {room:"101", status:"occupied", guestName:"Famille Exemple", stayUntil:"2026-11-21"},
    {room:"102", status:"available"}, {room:"103",status:"works"}, {room:"104",status:"works"},
  ]});
});

test("le séjour futur ne devient occupé que le jour indiqué, y compris au changement d’année", async () => {
  const report = await parseSejours(file("20270101", ["mer 30/12","jeu 31/12","ven 01/01","sam 02/01"]));
  assert.equal(report.rows[0].stayUntil,"2027-01-01");
  assert.deepEqual(report.rows[1], {room:"102",status:"occupied",guestName:"Séjour futur",stayUntil:"2027-01-01"});
});

test("un fichier sans date correspondante ou avec un calendrier discontinu est refusé", async () => {
  await assert.rejects(parseSejours(file("20261125")), /date/);
  await assert.rejects(parseSejours(file("20261120", ["jeu 19/11","sam 21/11"])), /incomplète/);
});
