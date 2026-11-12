import { createHash } from "node:crypto";
import type { Issue } from "../../../lib/domain";
import { parseEntry, roomIssue, workEntrySchema, type EntryChange, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "../../../lib/rooms";
import { planRoomIssue } from "../../../lib/roomIssueMatching";

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
  const plan = planRoomIssue(roomIssue(record), record, issues);
  if (plan.conflicts.length) throw new Error("The fixture must handle the room issue conflict explicitly.");
  record.relatedIssueIds = plan.relatedIssueIds;
  record.createdIssue = !!plan.issue;
  record.issueSyncVersion = 2;
  record.newIssueFindingKeys = plan.issue?.roomFindings?.map(finding => finding.key) || [];
  return { collection: "roomInspections", record, ...(plan.issue ? { issue: plan.issue } : {}) };
}
