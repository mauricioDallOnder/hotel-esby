import { createHash } from "node:crypto";
import type { Issue } from "../../../lib/domain";
import { parseEntry, roomIssue, workEntrySchema, type EntryChange, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "../../../lib/rooms";
import { prepareRoomInspection } from "../../../lib/roomIssueMatching";

// Use the same canonical payload as the API and offline recovery checks.
export function entryHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(parseEntry(input))).digest("hex");
}

export function workReceipt(input: WorkEntry): WorkEvent {
  const entry = workEntrySchema.parse(input);
  return { ...entry, version: 1, updatedAt: entry.occurredAt, submissionHash: entryHash(entry) };
}

export function roomReceipt(input: RoomEntry, issues: Issue[] = [], at = input.inspectedAt || `${input.date}T12:00:00.000Z`): Extract<EntryChange, { collection: "roomInspections" }> {
  const entry = parseEntry(input);
  if (entry.type !== "createRoomInspection") throw new Error("A room inspection is required.");
  const { photosData, ...fields } = entry;
  if (photosData.length) throw new Error("Use the real photo endpoint for fixtures with uploaded photos.");
  const record: RoomInspection = { ...fields, version: 1, updatedAt: at, submissionHash: entryHash(entry), photoIds: [], photoId: null };
  const { issue, updatedIssues } = prepareRoomInspection(roomIssue(record), record, issues);
  return { collection: "roomInspections", record, updatedIssues, ...(issue ? { issue } : {}) };
}
