import { today, type Issue } from "./domain";
import { issueRoom, normalizeIssueText } from "./roomIssueMatching";
import { rooms } from "./rooms";
import type { CafardSeed, CafardStatus } from "./cafards";

// Stable checkpoint for the change of workflow, not a hotel observation date.
// Never advance this on rendering: that would hide newer room inspections.
const FLOW_STARTED_AT = "2026-11-05T12:39:26.000Z";
const pests = /\b(?:cafards?|blattes?)\b/;
const product = /\b(?:gel|produit|insecticide)\b/;
const application = /\b(?:appliques?|appliquees?|applications?|aplications?|pulverises?|pulverisees?|pulverisations?)\b/;

function day(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + "T12:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function instant(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function clauses(value: string | undefined): string[] {
  return (value || "").split(/[.!?;\n]+/).map(normalizeIssueText).filter(Boolean);
}
function planned(text: string): boolean {
  return /\b(?:a verifier|a controler|verifier si|controler si|voir si|s il|si les|si des|si aucun)\b/.test(text);
}
function absent(text: string): boolean {
  if (!pests.test(text) || planned(text)) return false;
  return /\b(?:aucuns?|sans)\s+(?:cafards?|blattes?)\b/.test(text) ||
    /\b(?:aucune|absence de)\s+(?:(?:presence|trace|traces|signe|signes)\s+de\s+)?(?:cafards?|blattes?)\b/.test(text) ||
    /\bpas\s+(?:du tout\s+)?de\s+(?:cafards?|blattes?)\b/.test(text) ||
    /\b(?:ne|n)\s+(?:\w+\s+){0,4}plus\s+de\s+(?:cafards?|blattes?)\b/.test(text) ||
    /\b(?:cafards?|blattes?)\s+(?:(?:ne|n)\s+(?:\w+\s+){0,3}plus|non|pas)\s+(?:presents?|detectes?|observes?|trouves?)\b/.test(text) ||
    /\b(?:cafards?|blattes?)\s+(?:sont\s+)?absents?\b/.test(text);
}
function applied(text: string): boolean {
  if (!product.test(text) || !application.test(text)) return false;
  return !/\b(?:pas|non|sans)\s+(?:\w+\s+){0,3}(?:application|aplication|applique|appliquee)\b/.test(text) &&
    !/\b(?:a|doit|doivent|sera|seront)\s+(?:etre\s+)?appliquer?\b/.test(text) &&
    !/\b(?:application|aplication)\s+(?:(?:de|du)\s+\w+\s+)?(?:prevue|a prevoir|a faire|a realiser)\b/.test(text) &&
    !/\b(?:application|aplication)\b.*\b(?:non|pas|jamais)\s+(?:realisee|effectuee|faite)\b/.test(text);
}
function positive(text: string): boolean {
  return pests.test(text) && !absent(text) && !planned(text) &&
    (!applied(text) || /\b(?:presence|presents?|detectes?|observes?|trouves?|continuent|persistent)\b/.test(text));
}
function persistent(text: string): boolean {
  return positive(text) && /\b(?:toujours|encore|continu\w*|persist\w*|restent|reappar\w*)\b/.test(text);
}

type Observation = {
  date: string | null;
  at: string | null;
  sourceIssueId: string;
  notes: string;
  detected: boolean;
  absent: boolean;
  persistent: boolean;
  applied: boolean;
  product: string;
};

/** Derive the initial follow-up only from anomaly data already loaded after login. */
export function cafardSeedsFromIssues(issues: readonly Issue[]): CafardSeed[] {
  const grouped = new Map<string, { ids: Set<string>; observations: Observation[] }>();
  for (const issue of issues) {
    const room = issueRoom(issue);
    if (!room || !rooms.includes(room)) continue;
    const description = clauses(issue.description), title = clauses(issue.title);
    const history = issue.history || [];
    const flagged = issue.roomFindings?.some(finding => finding.key === "bugs") || false;
    if (!flagged && ![...description, ...title, ...history.flatMap(event => clauses(event.note))].some(text => pests.test(text))) continue;
    let group = grouped.get(room);
    if (!group) { group = { ids: new Set(), observations: [] }; grouped.set(room, group); }
    group.ids.add(issue.id);
    const initial = description.some(text => pests.test(text)) ? description : title;
    const date = day(issue.date), created = instant(issue.createdAt);
    group.observations.push({
      date, at: created && date === today(new Date(created)) ? created : null,
      sourceIssueId: issue.id, notes: issue.description || issue.title || "",
      detected: flagged || initial.some(positive), absent: !flagged && initial.some(absent),
      persistent: false, applied: false, product: "",
    });
    for (const event of history) {
      const at = instant(event.at);
      if (!at) continue;
      const text = clauses(event.note), treatment = text.some(applied);
      const detected = text.some(positive), negative = text.some(absent), persists = text.some(persistent);
      if (!treatment && !detected && !negative && !persists) continue;
      group.observations.push({
        date: today(new Date(at)), at, sourceIssueId: issue.id, notes: event.note,
        detected, absent: negative && !detected, persistent: persists || (negative && detected),
        applied: treatment, product: treatment && text.some(value => applied(value) && /\bgel\b/.test(value)) ? "Gel" : "",
      });
    }
  }

  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([room, group]) => {
    const observations = group.observations.sort((a, b) => (a.date || "").localeCompare(b.date || "") ||
      (a.at || "").localeCompare(b.at || "") || a.sourceIssueId.localeCompare(b.sourceIssueId));
    const detections = observations.filter(event => event.detected && event.date).map(event => event.date!);
    const treatments = new Map<string, { date: string; product: string; sourceIssueIds: string[] }>();
    let status: CafardStatus = "a_verifier", updatedOn: string | null = null, resolvedOn: string | null = null;
    let notes = "", importedAt = FLOW_STARTED_AT;
    for (const event of observations) {
      if (event.at && event.at > importedAt) importedAt = event.at;
      if (event.date) updatedOn = event.date;
      notes = event.notes;
      if (event.applied && event.date) {
        const key = event.date + "|" + event.product;
        const treatment = treatments.get(key) || { date: event.date, product: event.product, sourceIssueIds: [] };
        if (!treatment.sourceIssueIds.includes(event.sourceIssueId)) treatment.sourceIssueIds.push(event.sourceIssueId);
        treatments.set(key, treatment);
      }
      if (event.persistent || (event.detected && status === "resolu")) {
        status = "signale"; resolvedOn = null;
      } else if (event.absent && event.date) {
        status = "resolu"; resolvedOn = event.date;
      } else if (event.applied) {
        status = "a_verifier"; resolvedOn = null;
      }
    }
    const applications = [...treatments.values()], latest = applications.at(-1);
    return {
      room, status, detectedOn: detections.sort()[0] || null, treatedOn: latest?.date || null,
      updatedOn, resolvedOn, product: latest?.product || "", notes, importedAt,
      sourceIssueIds: [...group.ids].sort(), treatments: applications,
    };
  });
}
