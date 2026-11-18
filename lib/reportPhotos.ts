import { issuePhotoIds, type Issue, type State } from "./domain";
import type { RoomInspection } from "./rooms";

export type ReportPhoto = {
  photoId: string;
  sourceId: string;
  index: number;
  collection: "issues" | "roomInspections";
  date: string;
};

/** Index confirmed inspection links once for all issues in the report. */
export function indexReportPhotos(state: State, end: string) {
  const byIssue = new Map<string, RoomInspection[]>();
  const controls = (state.roomInspections || [])
    .filter(record => record.date <= end && issuePhotoIds(record).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  for (const record of controls) {
    for (const id of new Set([record.id, ...(record.relatedIssueIds || [])])) {
      const existing = byIssue.get(id);
      if (existing) existing.push(record);
      else byIssue.set(id, [record]);
    }
  }

  return (issue: Issue): ReportPhoto[] => {
    const photos: ReportPhoto[] = [];
    const seen = new Set<string>();
    function add(record: Pick<Issue, "id" | "date" | "photoId" | "photoIds">, collection: ReportPhoto["collection"]) {
      issuePhotoIds(record).forEach((photoId, index) => {
        if (seen.has(photoId)) return;
        seen.add(photoId);
        photos.push({ photoId, sourceId: record.id, index, collection, date: record.date });
      });
    }
    if (issue.date <= end) add(issue, "issues");
    for (const record of byIssue.get(issue.id) || []) add(record, "roomInspections");
    return photos;
  };
}

export function reportPhotos(issue: Issue, state: State, end: string) {
  return indexReportPhotos(state, end)(issue);
}
