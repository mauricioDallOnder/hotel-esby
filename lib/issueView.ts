import { issueResponsible, type Issue } from "./domain";
import { findingKind, standaloneIssueKind, type IssueKind } from "./issueCategory";
import { issueFindingStatus } from "./issueFindings";
import { normalizeIssueText } from "./roomIssueMatching";
import { daysSince } from "./roomRotation";

export type IssueFilters = {
  query: string; status: "all" | "pending" | Issue["status"]; priority: "all" | Issue["priority"];
  kind: "all" | IssueKind; category: string; unassigned: boolean; from: string; to: string;
  sort: "priority" | "oldest" | "recent" | "updated";
};
export const defaultIssueFilters: IssueFilters = { query: "", status: "pending", priority: "all", kind: "all", category: "all", unassigned: false, from: "", to: "", sort: "recent" };
const presets = [
    { id: "pending", label: "Non résolues", priority: "all", unassigned: false },
    { id: "critical", label: "Critiques ouvertes", priority: "critique", unassigned: false },
    { id: "unassigned", label: "Sans responsable", priority: "all", unassigned: true },
] as const;
export function issueAge(issue: Pick<Issue, "date">, day: string) {
  const age = daysSince(issue.date, day);
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}
export function lastIntervention(issue: Issue) { return issue.history.length > 1 ? issue.history.at(-1) : undefined; }

function matchesSearch(issue: Issue, words: string[]) {
  if (!words.length) return true;
  const text = normalizeIssueText([issue.room, issue.title, issue.location, issue.description, issue.category, issueResponsible(issue), issue.assignee, issue.reportedBy, ...issue.history.map(e => `${e.note} ${e.actor} ${e.assignee || ""}`)].join(" "));
  const tokens = new Set(text.split(" "));
  return words.every(word => /^\d+$/.test(word) ? tokens.has(word) : text.includes(word));
}

export function issueView(issues: readonly Issue[], filters: IssueFilters) {
  const words = normalizeIssueText(filters.query).split(" ").filter(Boolean);
  const rank = { critique: 0, haute: 1, normale: 2 };
  const counts = { pending: 0, critical: 0, unassigned: 0 };
  const filtered = issues.filter(issue => {
    if (filters.category !== "all" && issue.category !== filters.category) return false;
    if (filters.from && issue.date < filters.from || filters.to && issue.date > filters.to) return false;
    let pending = issue.status !== "resolu", exactStatus = issue.status === filters.status;
    if (filters.kind !== "all") {
      if (issue.roomFindingsActive !== false && issue.roomFindings?.length) {
        const findings = issue.roomFindings.filter(finding => findingKind(finding) === filters.kind);
        if (!findings.length) return false;
        pending = pending && findings.some(finding => finding.status !== "resolu");
        exactStatus = findings.some(finding => issueFindingStatus(issue, finding) === filters.status);
      } else if (standaloneIssueKind(issue) !== filters.kind) return false;
    }
    if (!matchesSearch(issue, words)) return false;
    const unassigned = !issueResponsible(issue);
    if (pending) {
      counts.pending++;
      if (issue.priority === "critique") counts.critical++;
      if (unassigned) counts.unassigned++;
    }
    if (filters.status === "pending" && !pending) return false;
    if (filters.status !== "all" && filters.status !== "pending" && !exactStatus) return false;
    return (filters.priority === "all" || issue.priority === filters.priority) && (!filters.unassigned || unassigned);
  }).sort((a, b) => {
    if (filters.sort === "recent") return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    if (filters.sort === "updated") return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    if (filters.sort === "oldest") return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    return Number(a.status === "resolu") - Number(b.status === "resolu") || rank[a.priority] - rank[b.priority] || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  });
  const shortcuts = presets.map(preset => {
    const next: IssueFilters = { ...filters, status: "pending", priority: preset.priority, unassigned: preset.unassigned };
    return { id: preset.id, label: preset.label, filters: next, count: counts[preset.id],
      selected: filters.status === next.status && filters.priority === next.priority && filters.unassigned === next.unassigned };
  });
  return { filtered, shortcuts };
}

export function selectIssues(issues: readonly Issue[], filters: IssueFilters) { return issueView(issues, filters).filtered; }
export function issueShortcuts(issues: readonly Issue[], filters: IssueFilters) { return issueView(issues, filters).shortcuts; }
