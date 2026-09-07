import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, dailyIssues } from "../lib/pdfExport.ts";
import { applyCommand, type Issue, type State } from "../lib/domain.ts";
const empty: State = { issues: [], inspections: [] };
const issue = applyCommand(empty, { type: "createIssue", id: crypto.randomUUID(), date: "2026-01-10", actor: "Marie", fields: { title: "Fuite du lavabo", location: "Chambre 204", category: "Plomberie", priority: "haute", description: "Description détaillée de la fuite. ".repeat(110), assignee: "Paul" } }, "2026-01-10T10:00:00Z").record as Issue;
test("PDF includes long descriptions, photos, and paginates", async () => {
  // Small embedded PNG accepted by jsPDF's format auto-detection for testing.
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDaYAAAAASUVORK5CYII=";
  let photos = 0;
  const doc = await buildReport({ kind: "monthly", period: "2026-01", hotelName: "Hôtel de test", state: { ...empty, issues: [{ ...issue, photoId: issue.id }] } }, async () => { photos++; return image; });
  assert.ok(doc.getNumberOfPages() >= 3);
  const pdf = doc.output(); assert.ok(pdf.startsWith("%PDF-")); assert.ok(pdf.includes("/Subtype /Image")); assert.equal(photos, 1);
});
test("empty daily report is valid and pending issues carry into later daily reports", async () => {
  const doc = await buildReport({ kind: "daily", period: "2026-01-10", hotelName: "Test", state: empty });
  assert.equal(doc.getNumberOfPages(), 1);
  assert.equal(dailyIssues({ ...empty, issues: [issue] }, "2026-02-01").length, 1);
});
test("a missing photo fails visibly instead of silently omitting evidence", async () => {
  await assert.rejects(buildReport({ kind: "daily", period: "2026-01-10", hotelName: "Test", state: { ...empty, issues: [{ ...issue, photoId: issue.id }] } }, async () => { throw new Error("Photo inaccessible"); }), /Photo inaccessible/);
});
