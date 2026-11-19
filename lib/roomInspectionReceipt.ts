import type { Issue } from "./domain";
import type { RoomInspection } from "./rooms";

/** A later issue version is also a receipt if its history retains this inspection. */
export function hasInspectionUpdates(record: RoomInspection, issues: readonly Issue[] | undefined, links = record.issueLinks) {
  return (links || []).every(link => !link.outcome || (
    record.issueAssociations?.some(item => item.key === link.key && item.issueId === link.issueId &&
      item.outcome === link.outcome && (!link.findingKey || item.findingKey === link.findingKey)) &&
    issues?.some(issue => issue.id === link.issueId && issue.history?.some(event => event.inspectionId === record.id))
  ));
}
