import { eventAt, issuePhotoIds, monthlySummary, today, type Issue, type State } from "./domain";

export type ReportScope = "all" | "room_clutter";
export type ReportKind = "daily" | "monthly";

export function dailyIssues(state: State, date: string): Issue[] {
  const linked = new Set(state.inspections.filter(inspection => inspection.date === date)
    .flatMap(inspection => inspection.checks.map(check => check.issueId)));
  return state.issues.filter(issue => issue.date <= date &&
    (issue.date === date || (eventAt(issue, date)?.status ?? "ouvert") !== "resolu" || linked.has(issue.id) ||
      issue.history.some(event => today(new Date(event.at)) === date)));
}

function clutterFindings(issue: Issue, end: string) {
  // A later free-text correction keeps old findings for history but must not
  // classify the current report using equipment that no longer describes it.
  if (issue.roomFindingsActive === false && today(new Date(issue.updatedAt)) <= end) return [];
  const event = eventAt(issue, end);
  const findings = event?.findingDetails || issue.roomFindings || [];
  return findings.filter(finding => finding.key === "room_clutter" || finding.problemType === "room_cluttered");
}

export function isRoomClutterIssue(issue: Issue, end: string): boolean {
  return issue.problemType === "room_cluttered" || clutterFindings(issue, end).length > 0;
}

export function reportPeriodEnd(kind: ReportKind, period: string): string {
  if (kind === "daily") return period;
  const [year, month] = period.split("-").map(Number);
  return `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
}

export function reportPendingIssues(state: State, kind: ReportKind, period: string, scope: ReportScope = "all"): Issue[] {
  const end = reportPeriodEnd(kind, period);
  const issues = kind === "monthly" ? monthlySummary(state, period).issues : dailyIssues(state, period);
  return issues.filter(issue => {
    const event = eventAt(issue, end);
    if ((event?.status ?? "ouvert") === "resolu") return false;
    if (scope === "all") return true;
    if (!isRoomClutterIssue(issue, end)) return false;
    const findings = clutterFindings(issue, end);
    // A grouped issue may remain open for another repair after the room has
    // been cleared. Use the states recorded at the report date, not today's.
    return !findings.length || findings.some(finding =>
      event?.findingStates?.find(state => state.key === finding.key)?.status !== "resolu");
  });
}

export type ReportPhoto = {
  photoId: string;
  sourceId: string;
  index: number;
  collection: "issues" | "roomInspections";
  date: string;
};

/** Only persisted issue links may attach another control's photos to a report. */
export function reportPhotos(issue: Issue, state: State, end: string): ReportPhoto[] {
  const photos: ReportPhoto[] = [];
  const seen = new Set<string>();
  const add = (record: Pick<Issue, "id" | "date" | "photoId" | "photoIds">, collection: ReportPhoto["collection"]) => {
    if (record.date > end) return;
    issuePhotoIds(record).forEach((photoId, index) => {
      if (seen.has(photoId)) return;
      seen.add(photoId);
      photos.push({ photoId, sourceId: record.id, index, collection, date: record.date });
    });
  };
  add(issue, "issues");
  const related = (state.roomInspections || []).filter(record => record.date <= end &&
    (record.id === issue.id || record.relatedIssueIds?.includes(issue.id)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  for (const record of related) add(record, "roomInspections");
  return photos;
}
