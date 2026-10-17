import type { Issue } from "./domain";
import { normalizeIssueText } from "./roomIssueMatching";
import { daysSince } from "./roomRotation";

export type IssueFilters = {
  query: string; status: "all" | "pending" | Issue["status"]; priority: "all" | Issue["priority"];
  category: string; unassigned: boolean; from: string; to: string;
  sort: "priority" | "oldest" | "recent" | "updated";
};
export const defaultIssueFilters: IssueFilters = { query: "", status: "pending", priority: "all", category: "all", unassigned: false, from: "", to: "", sort: "priority" };
export function issueAge(issue: Pick<Issue, "date">, day: string) {
  const age = daysSince(issue.date, day);
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}
export function lastIntervention(issue: Issue) { return issue.history.slice(1).at(-1); }
export function selectIssues(issues: Issue[], filters: IssueFilters) {
  const words = normalizeIssueText(filters.query).split(" ").filter(Boolean);
  const rank = { critique: 0, haute: 1, normale: 2 };
  return issues.filter(issue => {
    if (filters.status !== "all" && (filters.status === "pending" ? issue.status === "resolu" : issue.status !== filters.status)) return false;
    if (filters.priority !== "all" && issue.priority !== filters.priority) return false;
    if (filters.category !== "all" && issue.category !== filters.category) return false;
    if (filters.unassigned && issue.assignee.trim()) return false;
    if (filters.from && issue.date < filters.from || filters.to && issue.date > filters.to) return false;
    if (!words.length) return true;
    const text = normalizeIssueText([issue.room, issue.title, issue.location, issue.description, issue.category, issue.assignee, issue.reportedBy, ...issue.history.map(e => `${e.note} ${e.actor}`)].join(" "));
    const tokens = new Set(text.split(" "));
    return words.every(word => /^\d+$/.test(word) ? tokens.has(word) : text.includes(word));
  }).sort((a, b) => {
    if (filters.sort === "recent") return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    if (filters.sort === "updated") return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    if (filters.sort === "oldest") return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    return Number(a.status === "resolu") - Number(b.status === "resolu") || rank[a.priority] - rank[b.priority] || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  });
}
