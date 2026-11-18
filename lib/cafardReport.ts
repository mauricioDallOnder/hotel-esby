import { cafardCases, cafardStatusLabels } from "./cafards";
import { cafardSeedsFromIssues } from "./cafardsLegacy";
import { displayDate, issuePhotoIds, today, type Issue, type State, type Status } from "./domain";
import { findingKind, standaloneIssueKind } from "./issueCategory";
import type { ReportRow, ReportScope } from "./reportData";
import { indexReportPhotos, type ReportPhoto } from "./reportPhotos";
import { issueRoom } from "./roomIssueMatching";

function recordedBy(timestamp: string, end: string) {
  const instant = new Date(timestamp);
  return Number.isFinite(instant.getTime()) && today(instant) <= end;
}

/** Project saved room follow-ups as they stood on the report's last day. */
export function cafardReportRows(state: State, start: string, end: string, scope: ReportScope) {
  const rows: ReportRow[] = [];
  const replacedIssueIds = new Set<string>();
  const mixedIssueIds = new Set<string>();
  const result = { rows, replacedIssueIds, mixedIssueIds };
  if (scope === "technical" || scope === "room_clutter") return result;

  const controls = (state.roomInspections || []).filter(control => control.bugs === "oui" && control.date <= end);
  const events = (state.workEvents || []).filter(event => event.kind === "cafardFollowup" && event.date <= end);
  const trackedRooms = new Set([...controls.map(control => control.room), ...events.map(event => event.room)]);
  if (!trackedRooms.size) return result;

  const issues = state.issues.filter(issue => issue.date <= end && trackedRooms.has(issueRoom(issue) || ""))
    .map(issue => {
      const history = issue.history.filter(event => recordedBy(event.at, end));
      const current = recordedBy(issue.updatedAt, end);
      const roomFindings = current && issue.roomFindingsActive === false ? [] : history.at(-1)?.findingDetails ?? issue.roomFindings;
      return { ...issue, history, roomFindings };
    });
  const seeds = cafardSeedsFromIssues(issues);
  const issueById = new Map(issues.map(issue => [issue.id, issue]));
  const legacyByRoom = new Map<string, Issue[]>();
  for (const seed of seeds) {
    const legacy: Issue[] = [];
    for (const id of seed.sourceIssueIds) {
      const issue = issueById.get(id)!;
      const kinds = issue.roomFindings?.map(findingKind);
      const onlyCafards = kinds?.length ? kinds.every(kind => kind === "cafards") : standaloneIssueKind(issue) === "cafards";
      if (onlyCafards) {
        legacy.push(issue);
        replacedIssueIds.add(id);
      } else if (kinds?.includes("cafards")) mixedIssueIds.add(id);
    }
    legacyByRoom.set(seed.room, legacy);
  }

  const photosByRoom = new Map<string, ReportPhoto[]>();
  for (const control of controls) {
    const photos = photosByRoom.get(control.room) || [];
    issuePhotoIds(control).forEach((photoId, index) => photos.push({
      photoId, sourceId: control.id, index, collection: "roomInspections", date: control.date,
    }));
    photosByRoom.set(control.room, photos);
  }
  const legacyPhotos = replacedIssueIds.size ? indexReportPhotos(state, end) : undefined;
  for (const record of cafardCases(controls, events, seeds)) {
    const resolved = record.status === "resolu";
    if (resolved && (scope === "all" || !record.resolvedOn || record.resolvedOn < start || record.resolvedOn > end)) continue;
    if (!resolved && scope === "resolved") continue;
    const latest = record.history.find(item => item.id === record.lastEventId);
    const description = [
      cafardStatusLabels[record.status],
      !record.detectedOn && record.updatedOn && `Dernier suivi le ${displayDate(record.updatedOn)}`,
      record.treatedOn && `Produit appliqué le ${displayDate(record.treatedOn)}${record.product ? " · " + record.product : ""}`,
      resolved && record.resolvedOn && `Résolu le ${displayDate(record.resolvedOn)}${latest?.actor ? " · " + latest.actor : ""}`,
      record.notes,
    ].filter(Boolean).join("\n");
    const title = `Cafards · Chambre ${record.room}`;
    const status: Status = resolved ? "resolu" : record.status === "signale" ? "ouvert" : "en_cours";
    // A report row never creates a maintenance issue. Photo references retain
    // their original authenticated collection, record ID and attachment index.
    const issue: Issue = {
      id: "cafards:" + record.room, title, description, room: record.room, location: "Chambre " + record.room,
      date: record.detectedOn || "", status, category: "Autre", priority: "normale", assignee: "", reportedBy: "",
      version: record.revision, createdAt: "", updatedAt: latest?.at || "", photoId: null, history: [],
    };
    const photos = new Map<string, ReportPhoto>();
    for (const original of legacyByRoom.get(record.room) || []) {
      for (const photo of legacyPhotos!(original)) photos.set(photo.photoId, photo);
    }
    for (const photo of photosByRoom.get(record.room) || []) {
      if (!photos.has(photo.photoId)) photos.set(photo.photoId, photo);
    }
    rows.push({ issue, title, description, status, photos: [...photos.values()] });
  }
  return result;
}
