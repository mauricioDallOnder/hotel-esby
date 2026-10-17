// Pure functions shared by the browser, local storage and the generated Apps Script bundle.
import type { Issue } from "./domain";
import type { RoomInspection } from "./rooms";

export function normalizeIssueText(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function issueRoom(issue: Pick<Issue, "location" | "room">): string | undefined {
  if (issue.room) return issue.room;
  const location = normalizeIssueText(issue.location || "");
  if (/^\d{3}$/.test(location)) return location;
  const matches = [...location.matchAll(/\b(?:chambre|ch)\s+(\d{3})\b/g)];
  return matches.length === 1 && (location.match(/\b\d{3}\b/g) || []).length === 1 ? matches[0][1] : undefined;
}

export function openRoomIssues(issues: Issue[], room: string) {
  return issues.filter(issue => issue.status !== "resolu" && issueRoom(issue) === room);
}

const keywords: Record<string, RegExp> = {
  taps: /\b(robinet\w*|mitigeur\w*)\b/,
  switches: /\binterrupteur\w*\b/,
  leaks: /\b(fuite\w*|infiltration\w*)\b/,
  lights: /\b(eclair\w*|ampoule\w*|lumiere\w*|lampe\w*)\b/,
  smoke: /\b(detecteur\w*|fumee)\b/,
  window: /\b(fenetre\w*|vitrage\w*)\b/,
  bed: /\b(lit|lits|sommier\w*)\b/,
  mattress: /\bmatelas\b/,
  fridge: /\b(minibar\w*|frigo\w*|refrigerateur\w*)\b/,
  door_handle_clear: /\bpoignee\w*\b/,
  door_closer: /\b(ferme porte\w*|groom\w*|fermeture automatique)\b/,
  bugs: /\b(cafard\w*|nuisible\w*|punaise\w*|blatte\w*)\b/,
  carpet: /\bmoquette\w*\b/,
  cleaning: /\b(menage|nettoyage chambre)\b/,
};

export function matchesRoomFinding(issue: Issue, finding: { key: string; label: string }) {
  if (issue.roomFindings?.length) return issue.roomFindings.some(item => item.key === finding.key &&
    (finding.key !== "observation" || normalizeIssueText(item.label) === normalizeIssueText(finding.label)));
  const text = normalizeIssueText(`${issue.title || ""} ${issue.description || ""}`);
  const dirty = /\b(sale\w*|salete\w*|nettoy\w*|proprete)\b/.test(text);
  if (finding.key === "microwave_cleaning") return /\bmicro ondes?\b/.test(text) && dirty;
  if (finding.key === "fridge_cleaning") return keywords.fridge.test(text) && dirty;
  if (finding.key === "fridge" && dirty && !/\b(panne|hs|fonction\w*|casse\w*|refroid\w*)\b/.test(text)) return false;
  if (finding.key === "observation") return normalizeIssueText(issue.description || "") === normalizeIssueText(finding.label);
  return keywords[finding.key]?.test(text) || false;
}

export function planRoomIssue(candidate: Issue | undefined, record: Pick<RoomInspection, "room" | "issueLinks" | "distinctProblemKeys" | "notes">, issues: Issue[]) {
  if (!candidate) return { issue: undefined, relatedIssueIds: [] as string[] };
  const open = openRoomIssues(issues, record.room);
  const related = new Set<string>();
  const remaining = (candidate.roomFindings || []).filter(finding => {
    if (record.distinctProblemKeys?.includes(finding.key)) return true;
    const explicit = record.issueLinks?.find(link => link.key === finding.key);
    const existing = open.find(issue => explicit?.issueId === issue.id) || open.find(issue => matchesRoomFinding(issue, finding));
    if (existing) { related.add(existing.id); return false; }
    return true;
  });
  if (candidate.roomFindings?.length && !remaining.length) return { issue: undefined, relatedIssueIds: [...related] };
  const issue = { ...candidate, roomFindings: remaining,
    description: remaining.length ? [...remaining.map(finding => finding.label), ...(record.notes && !remaining.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) : candidate.description };
  return { issue, relatedIssueIds: [...related] };
}

// Persist the decision before either write. Replays keep that decision even if
// a linked issue was resolved after the inspection or a write was interrupted.
export function prepareRoomIssue(candidate: Issue | undefined, record: RoomInspection, issues: Issue[]) {
  if (record.issueSyncVersion === 2) {
    if (!record.createdIssue || !candidate) return undefined;
    const existing = issues.find(issue => issue.id === record.id);
    if (existing) return existing;
    const findings = (candidate.roomFindings || []).filter(f => record.newIssueFindingKeys?.includes(f.key));
    return { ...candidate, roomFindings: findings,
      description: findings.length ? [...findings.map(f => f.label), ...(record.notes && !findings.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) : candidate.description };
  }
  const plan = planRoomIssue(candidate, record, issues);
  record.relatedIssueIds = plan.relatedIssueIds;
  record.createdIssue = !!plan.issue;
  record.newIssueFindingKeys = plan.issue?.roomFindings?.map(f => f.key) || [];
  record.issueSyncVersion = 2;
  return plan.issue;
}
