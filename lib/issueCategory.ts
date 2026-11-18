import type { Issue } from "./domain";
import type { FindingDetail } from "./issueFindings";
import { hasRoomClutter, isCafardTechnicalReport } from "./roomIssueMatching";

export const issueKindLabels = {
  technical: "Problèmes techniques",
  room_clutter: "Chambres encombrées",
  cafards: "Cafards",
} as const;

export type IssueKind = keyof typeof issueKindLabels;

export function standaloneIssueKind(issue: Pick<Issue, "title" | "description" | "problemType">): IssueKind {
  if (issue.problemType === "room_cluttered") return "room_clutter";
  if (issue.problemType && issue.problemType !== "other") return "technical";
  if (hasRoomClutter(issue.title + "\n" + issue.description)) return "room_clutter";
  return isCafardTechnicalReport(issue, "historical") ? "cafards" : "technical";
}

export function findingKind(finding: FindingDetail): IssueKind {
  if (finding.key === "room_clutter" || finding.problemType === "room_cluttered") return "room_clutter";
  if (finding.key === "bugs") return "cafards";
  // Older generic findings have only a label and sometimes a description.
  if (["observation", "damage", "other"].includes(finding.key)) {
    return standaloneIssueKind({ title: finding.label, description: finding.description || "", problemType: finding.problemType });
  }
  return "technical";
}
