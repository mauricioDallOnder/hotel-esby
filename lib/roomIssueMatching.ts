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
  const matches = [...location.matchAll(/\b(?:chambre|ch)\s*(?:n(?:o|umero)?\s*)?(\d{3})\b/g)];
  return matches.length === 1 && (location.match(/\d{3,}/g) || []).length === 1 ? matches[0][1] : undefined;
}

export function openRoomIssues(issues: readonly Issue[], room: string) {
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
  // A heater fault is different from a heater hidden or obstructed by objects.
  if (finding.key === "radiator_clear") return /\b(chauffage\w*|radiateur\w*)\b/.test(text) &&
    /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/.test(text) &&
    !/\b(pas|non|jamais|plus)(?: \w+){0,2} (cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/.test(text);
  const dirty = /\b(sale\w*|salete\w*|nettoy\w*|proprete)\b/.test(text);
  if (finding.key === "microwave_cleaning") return /\bmicro ondes?\b/.test(text) && dirty;
  if (finding.key === "fridge_cleaning") return keywords.fridge.test(text) && dirty;
  if (finding.key === "fridge" && dirty && !/\b(panne|hs|fonction\w*|casse\w*|refroid\w*)\b/.test(text)) return false;
  if (finding.key === "observation") return normalizeIssueText(issue.description || "") === normalizeIssueText(finding.label);
  return keywords[finding.key]?.test(text) || false;
}

type IssueCandidate = Pick<Issue, "location" | "title" | "description"> & Partial<Pick<Issue, "id" | "room" | "roomFindings">>;

const genericText = /^(?:chambre\s+\d{3}\s*)?(?:probleme(?: constate| technique)?|anomalie|a verifier|a reparer|voir (?:la )?photo|voir sur place|test)$/;
const failureKinds: [string, RegExp][] = [
  ["missing", /\b(absent\w*|manquant\w*|manque)\b/],
  ["obstructed", /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/],
  ["leak", /\b(fuite\w*|fuit|infiltr\w*)\b/],
  ["failure", /\b(panne|hs|defectueu\w*|grille[es]*|ne (?:\w+ ){0,2}fonctionne (?:pas|plus))\b/],
  ["broken", /\b(casse[es]*|abime[es]*|endommage[es]*)\b/],
  ["blocked", /\b(bloque[es]*|coince[es]*|ne (?:\w+ ){0,2}ferme (?:pas|plus))\b/],
];

function meaningful(value: string) {
  const text = normalizeIssueText(value || "").replace(/^chambre\s+\d{3}\s+/, "");
  return text.length >= 8 && !genericText.test(text) ? text : "";
}

function sameManualProblem(candidate: IssueCandidate, existing: Issue) {
  const left = normalizeIssueText(`${candidate.title || ""} ${candidate.description || ""}`);
  const right = normalizeIssueText(`${existing.title || ""} ${existing.description || ""}`);
  // Two explicitly different fittings in one room remain independent repairs.
  const positions = (text: string): string[] => text.match(/\b(douche|lavabo|wc|entree|plafond|chevet)\b/g) || [];
  const a = positions(left), b = positions(right);
  if (a.length && b.length && !a.some(position => b.includes(position))) return false;
  const leftFailures = failureKinds.filter(([, pattern]) => pattern.test(left)).map(([kind]) => kind);
  const rightFailures = failureKinds.filter(([, pattern]) => pattern.test(right)).map(([kind]) => kind);
  if (leftFailures.length && rightFailures.length && !leftFailures.some(kind => rightFailures.includes(kind))) return false;
  const description = meaningful(candidate.description), title = meaningful(candidate.title);
  if ((description && description === meaningful(existing.description)) || (title && title === meaningful(existing.title))) return true;
  if (!leftFailures.some(kind => rightFailures.includes(kind))) return false;
  // Paraphrases are matched only with both a named fitting and the same fault;
  // generic titles or a shared category alone must never hide another repair.
  const fittings = Object.entries(keywords).filter(([key]) => !["leaks", "bugs", "cleaning", "carpet"].includes(key));
  return fittings.some(([, pattern]) => pattern.test(left) && pattern.test(right));
}

/** A new or reopened report must not create another copy of an open room fault. */
export function findDuplicateOpenIssue(candidate: IssueCandidate, issues: readonly Issue[]): Issue | undefined {
  const room = issueRoom(candidate);
  if (!room) return undefined;
  return openRoomIssues(issues, room).find(existing => {
    if (candidate.id === existing.id) return false;
    if (candidate.roomFindings?.some(finding => matchesRoomFinding(existing, finding))) return true;
    if (existing.roomFindings?.some(finding => matchesRoomFinding(candidate as Issue, finding))) return true;
    return sameManualProblem(candidate, existing);
  });
}

export function duplicateRoomIssueMessage(issue: Issue) {
  return `Un problème identique est déjà ouvert dans la chambre ${issueRoom(issue)} : ${issue.title}. Ouvrez ce signalement pour le mettre à jour.`;
}

/** Existing duplicate history can still be progressed or resolved, never erased. */
export function shouldCheckIssueDuplicate(candidate: Issue, current?: Issue) {
  return candidate.status !== "resolu" && (!current || current.status === "resolu" ||
    issueRoom(candidate) !== issueRoom(current) || normalizeIssueText(candidate.title || "") !== normalizeIssueText(current.title || "") ||
    normalizeIssueText(candidate.description || "") !== normalizeIssueText(current.description || ""));
}

export function planRoomIssue(candidate: Issue | undefined, record: Pick<RoomInspection, "room" | "issueLinks" | "distinctProblemKeys" | "notes">, issues: Issue[]) {
  if (!candidate) return { issue: undefined, relatedIssueIds: [] as string[] };
  const open = openRoomIssues(issues, record.room);
  const related = new Set<string>();
  const remaining = (candidate.roomFindings || []).filter(finding => {
    // Older queued drafts may still carry distinctProblemKeys. They cannot
    // bypass the single open follow-up for the same room checklist finding.
    const explicit = record.issueLinks?.find(link => link.key === finding.key);
    const existing = open.find(issue => explicit?.issueId === issue.id && matchesRoomFinding(issue, finding)) || open.find(issue => matchesRoomFinding(issue, finding));
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
    if (!record.createdIssue) return undefined;
    const existing = issues.find(issue => issue.id === record.id);
    if (existing) return existing;
    if (!candidate) return undefined;
    const findings = (candidate.roomFindings || []).filter(f => record.newIssueFindingKeys?.includes(f.key));
    // A narrowed rule must not turn an old repair into a different anomaly.
    if (!findings.length) return undefined;
    return { ...candidate, roomFindings: findings,
      description: [...findings.map(f => f.label), ...(record.notes && !findings.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) };
  }
  const plan = planRoomIssue(candidate, record, issues);
  record.relatedIssueIds = plan.relatedIssueIds;
  record.createdIssue = !!plan.issue;
  record.newIssueFindingKeys = plan.issue?.roomFindings?.map(f => f.key) || [];
  record.issueSyncVersion = 2;
  return plan.issue;
}
