// Pure functions shared by the browser, local storage and the generated Apps Script bundle.
import type { Issue } from "./domain";
import type { RoomInspection } from "./rooms";
import { getProblemPreset, type ProblemType } from "./problemPresets";

export function normalizeIssueText(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(?:chaffauge|cheffauge)\b/g, "chauffage")
    .replace(/\babbatant\b/g, "abattant")
    .replace(/\bbutton\b/g, "bouton")
    .replace(/\bfrigobar\b/g, "minibar");
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
  electrical_socket: /\bprises?\b/,
  heater: /\b(chauffage\w*|radiateur\w*)\b/,
  toilet_seat: /\babattants?\b/,
  toilet_flush: /\b(chasse(?: d eau)?|bouton\w* (?:du |de la |de )?(?:toilette\w*|wc))\b/,
  drain: /\b(evacuation\w*|canalisation\w*|siphon\w*|douche\w*)\b/,
  door_damage: /\bporte\w*\b/,
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

type Finding = NonNullable<Issue["roomFindings"]>[number];

function inferredProblemTypes(text: string): ProblemType[] {
  const value = normalizeIssueText(text), types: ProblemType[] = [];
  const has = (pattern: RegExp) => pattern.test(value);
  const loose = /\b(detache\w*|descelle\w*|mal fixe\w*|fixation\w*)\b/;
  const obstructed = /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/;
  const negativeObstruction = /\b(pas|non|jamais|plus)(?: \w+){0,2} (cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/;
  if (has(keywords.electrical_socket)) types.push("electrical_socket");
  if (has(keywords.heater)) {
    if (has(loose)) types.push("heater_loose");
    if (has(obstructed) && !has(negativeObstruction)) types.push("radiator_obstructed");
    if (has(/\b(panne|hs|defectueu\w*|froid\w*|ne chauffe (?:pas|plus)|ne (?:fonctionne|marche) (?:pas|plus))\b/) ||
      (!has(loose) && !has(obstructed) && has(/\b(casse\w*|probleme)\b/))) types.push("heater_fault");
  }
  if (has(keywords.leaks)) types.push("water_leak");
  if (has(keywords.toilet_seat)) types.push("toilet_seat");
  if (has(keywords.toilet_flush)) types.push("toilet_flush");
  if (has(keywords.switches)) types.push("electrical_switch");
  if (has(keywords.taps)) types.push("tap_fault");
  if (has(keywords.window)) types.push("window_fault");
  if (has(keywords.lights)) types.push("lighting_fault");
  if (has(keywords.drain) && has(/\b(bouche\w*|bloque\w*|engorge\w*)\b/)) types.push("drain_blocked");
  if (has(keywords.door_damage) && has(/\b(casse\w*|abime\w*|endommage\w*)\b/)) types.push("door_damage");
  if (has(keywords.smoke)) types.push("smoke_detector");
  if (has(keywords.fridge) && has(/\b(panne|hs|defectueu\w*|casse\w*|refroid\w*|ne (?:fonctionne|marche) (?:pas|plus))\b/)) types.push("fridge_fault");
  return types;
}

function findingText(finding: Finding) {
  return [finding.label, finding.description].filter(Boolean).join(" ");
}

function typedFindingMatches(issue: Issue, finding: Finding) {
  const type = finding.problemType;
  const text = findingText(finding);
  const existingText = `${issue.title || ""} ${issue.description || ""}`;
  if (type === "other") return !!finding.description && sameManualProblem({ location: issue.location, title: "", description: finding.description }, issue);
  const explicit = issue.problemType && issue.problemType !== "other" ? issue.problemType : undefined;
  const existingTypes = explicit ? [explicit] : inferredProblemTypes(existingText);
  if (!type || !existingTypes.includes(type)) return false;
  if (differentDetails(text, existingText)) return false;
  // A selected type is a useful suggestion, but never sufficient on its own
  // to silently combine two repairs. planRoomIssue asks for confirmation when
  // there is no precise description identifying the same fitting.
  return true;
}

export function matchesRoomFinding(issue: Issue, finding: Finding) {
  if (finding.problemType) {
    if (issue.roomFindings?.length) return issue.roomFindings.some(item => {
      if (!item.problemType) return typedFindingMatches({ ...issue, roomFindings: undefined }, finding);
      return typedFindingMatches({ ...issue, problemType: item.problemType, title: "", description: findingText(item), roomFindings: undefined }, finding);
    });
    return typedFindingMatches(issue, finding);
  }
  if (finding.key === "damage") {
    if (meaningful(finding.description || ""))
      return sameManualProblem({ location: issue.location, title: "", description: finding.description! }, issue);
    // "Rien de cassé : Problème" does not identify an object. It can suggest
    // existing room repairs for a human choice, but can never auto-link one.
    return !isCafardTechnicalReport(issue);
  }
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

export type IssueCandidate = Pick<Issue, "location" | "title" | "description"> & Partial<Pick<Issue, "id" | "room" | "roomFindings" | "problemType">>;

const genericText = /^(?:chambre\s+\d{3}\s*)?(?:probleme(?: constate| technique)?|anomalie|a verifier|a reparer|voir (?:la )?photo|voir sur place|test)$/;
const failureKinds: [string, RegExp][] = [
  ["missing", /\b(absent\w*|manquant\w*|manque)\b/],
  ["obstructed", /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/],
  ["leak", /\b(fuite\w*|fuit|infiltr\w*)\b/],
  ["failure", /\b(panne|hs|defectueu\w*|grille[es]*|ne (?:\w+ ){0,2}(?:fonctionne|marche) (?:pas|plus))\b/],
  ["broken", /\b(casse[es]*|abime[es]*|endommage[es]*)\b/],
  ["loose", /\b(detache\w*|descelle\w*|mal fixe\w*)\b/],
  ["blocked", /\b(bouche[es]*|bloque[es]*|coince[es]*|ne (?:\w+ ){0,2}ferme (?:pas|plus))\b/],
];

function differentDetails(left: string, right: string) {
  const a = normalizeIssueText(left), b = normalizeIssueText(right);
  for (const dimension of [["gauche", "droite"], ["haut", "bas"]]) {
    const sidesA = dimension.filter(side => new RegExp(`\\b${side}\\b`).test(a));
    const sidesB = dimension.filter(side => new RegExp(`\\b${side}\\b`).test(b));
    if (sidesA.length && sidesB.length && !sidesA.some(side => sidesB.includes(side))) return true;
  }
  // Named positions and components are evidence of different fittings; a
  // common "damage" key, preset or room number is never such evidence.
  const positions = (text: string): string[] => text.match(/\b(douche|lavabo|wc|entree|plafond|chevet|fenetre|television|lit|gauche|droite|bureau|evier)\b/g) || [];
  const locationsA = positions(a), locationsB = positions(b);
  if (locationsA.length && locationsB.length && !locationsA.some(position => locationsB.includes(position))) return true;
  const components = (text: string): string[] => text.match(/\b(bec|flexible|poignee|joint|fixation|bouton|vitre)\b/g) || [];
  const partsA = components(a), partsB = components(b);
  if (partsA.length && partsB.length && !partsA.some(part => partsB.includes(part))) return true;
  const failuresA = failureKinds.filter(([, pattern]) => pattern.test(a)).map(([kind]) => kind);
  const failuresB = failureKinds.filter(([, pattern]) => pattern.test(b)).map(([kind]) => kind);
  return !!(failuresA.length && failuresB.length && !failuresA.some(kind => failuresB.includes(kind)));
}

function meaningful(value: string) {
  const text = normalizeIssueText(value || "").replace(/^chambre\s+\d{3}\s+/, "");
  return text.length >= 8 && !genericText.test(text) ? text : "";
}

function sameManualProblem(candidate: IssueCandidate, existing: Issue) {
  const left = normalizeIssueText(`${candidate.title || ""} ${candidate.description || ""}`);
  const right = normalizeIssueText(`${existing.title || ""} ${existing.description || ""}`);
  if (candidate.problemType && existing.problemType && candidate.problemType !== "other" && existing.problemType !== "other" && candidate.problemType !== existing.problemType) return false;
  if (differentDetails(left, right)) return false;
  const leftFailures = failureKinds.filter(([, pattern]) => pattern.test(left)).map(([kind]) => kind);
  const rightFailures = failureKinds.filter(([, pattern]) => pattern.test(right)).map(([kind]) => kind);
  const description = meaningful(candidate.description), title = meaningful(candidate.title);
  if ((description && description === meaningful(existing.description)) || (title && title === meaningful(existing.title))) return true;
  if (!leftFailures.some(kind => rightFailures.includes(kind))) return false;
  // Paraphrases are matched only with both a named fitting and the same fault;
  // generic titles or a shared category alone must never hide another repair.
  const fittings = Object.entries(keywords).filter(([key]) => !["leaks", "bugs", "cleaning", "carpet", "heater"].includes(key));
  const typedA = inferredProblemTypes(left), typedB = inferredProblemTypes(right);
  if (typedA.some(type => ["heater_fault", "heater_loose", "radiator_obstructed"].includes(type) && typedB.includes(type))) return true;
  return fittings.some(([, pattern]) => pattern.test(left) && pattern.test(right));
}

/** A new or reopened report must not create another copy of an open room fault. */
export function findDuplicateOpenIssue(candidate: IssueCandidate, issues: readonly Issue[]): Issue | undefined {
  const room = issueRoom(candidate);
  if (!room) return undefined;
  return openRoomIssues(issues, room).find(existing => {
    if (candidate.id === existing.id) return false;
    const identified = (finding: Finding) => finding.key !== "damage" || !!finding.problemType || !!meaningful(finding.description || "");
    if (candidate.roomFindings?.some(finding => identified(finding) && matchesRoomFinding(existing, finding))) return true;
    if (existing.roomFindings?.some(finding => identified(finding) && matchesRoomFinding(candidate as Issue, finding))) return true;
    return sameManualProblem(candidate, existing);
  });
}

export function duplicateRoomIssueMessage(issue: Issue) {
  return `Un problème identique est déjà ouvert dans la chambre ${issueRoom(issue)} : ${issue.title}. Ouvrez ce signalement pour le mettre à jour.`;
}

/** Only an unambiguous pest report is routed away from technical repairs. */
export function isCafardTechnicalReport(candidate: IssueCandidate) {
  const pests = /\b(?:cafards?|blattes?)\b/;
  const clauses = (text: string) => text.split(/[.!?;,\n]+|\bmais\b|\bet\s+(?=(?:des?\s+)?(?:cafards?|blattes?)\b)/i).map(normalizeIssueText).filter(Boolean);
  const description = clauses(candidate.description || "");
  // A precise negative observation takes precedence over a generic title.
  const observations = description.some(text => pests.test(text)) ? description : clauses(candidate.title || "");
  const positive = observations.some(text => pests.test(text) &&
    !/\b(?:aucuns?|sans)\s+(?:cafards?|blattes?)\b/.test(text) &&
    !/\b(?:aucune|absence de)\s+(?:(?:presence|traces?|signes?)\s+de\s+)?(?:cafards?|blattes?)\b/.test(text) &&
    !/\bpas\s+(?:du tout\s+)?de\s+(?:cafards?|blattes?)\b/.test(text) &&
    !/\b(?:ne|n)\s+(?:\w+\s+){0,4}plus\s+de\s+(?:cafards?|blattes?)\b/.test(text) &&
    !/\b(?:cafards?|blattes?)\s+(?:(?:ne|n)\s+(?:\w+\s+){0,3}plus|non|pas)\s+(?:presents?|detectes?|observes?|trouves?)\b/.test(text) &&
    !/\b(?:cafards?|blattes?)\s+(?:sont\s+)?absents?\b/.test(text) &&
    !/\b(?:a verifier|a controler|verifier si|controler si|voir si|s il|si les|si des|si aucun)\b/.test(text) &&
    !(/\b(?:gel|produit|insecticide)\b/.test(text) && /\b(?:applique\w*|application\w*|pulveris\w*)\b/.test(text) &&
      !/\b(?:presence|presents?|detectes?|observes?|trouves?|continuent|persistent)\b/.test(text)));
  if (!positive) return false;
  if (candidate.problemType && candidate.problemType !== "other") return false;
  // A fitting can merely locate pests ("cafards près du robinet"). It is a
  // technical repair only when a fault is actually described on that fitting.
  const technical = clauses(`${candidate.title || ""}. ${candidate.description || ""}`).some(text =>
    inferredProblemTypes(text).length > 0 &&
    !/\b(?:pas de|aucune?|sans)\s+(?:fuite\w*|panne\w*|probleme\w*)\b/.test(text) &&
    (failureKinds.some(([, pattern]) => pattern.test(text)) || /\b(?:froid|ne chauffe (?:pas|plus))\b/.test(text) ||
      (!pests.test(text) && /\bprobleme\b/.test(text))));
  return !technical;
}

export function cafardTechnicalReportMessage() {
  return "Pour les cafards, choisissez la chambre dans le menu Suivi des cafards : elle y garde un seul suivi, avec ses traitements et ses vérifications.";
}

/** Existing duplicate history can still be progressed or resolved, never erased. */
export function shouldCheckIssueDuplicate(candidate: Issue, current?: Issue) {
  return candidate.status !== "resolu" && (!current || current.status === "resolu" ||
    issueRoom(candidate) !== issueRoom(current) || normalizeIssueText(candidate.title || "") !== normalizeIssueText(current.title || "") ||
    normalizeIssueText(candidate.description || "") !== normalizeIssueText(current.description || "") || candidate.problemType !== current.problemType);
}

type RoomIssueRecord = Pick<RoomInspection, "room" | "issueLinks" | "distinctProblemKeys" | "notes">;

function exactTypedDescription(issue: Issue, finding: Finding) {
  const detail = meaningful(finding.description || "");
  if (!detail) return false;
  return detail === meaningful(issue.description || "") ||
    !!issue.roomFindings?.some(item => item.problemType === finding.problemType && detail === meaningful(item.description || ""));
}

/** A preview never throws; write boundaries reject conflicts before any photos or rows are written. */
export function planRoomIssue(candidate: Issue | undefined, record: RoomIssueRecord, issues: readonly Issue[]) {
  const conflicts: string[] = [], requiresChoice: string[] = [];
  const findings = candidate?.roomFindings || [];
  const links = record.issueLinks || [];
  for (const link of links) {
    if (links.filter(item => item.key === link.key).length > 1) {
      conflicts.push("Choisissez un seul problème existant par équipement.");
      continue;
    }
    if (!findings.some(finding => finding.key === link.key)) {
      conflicts.push("Le problème associé ne correspond plus à un équipement signalé dans ce contrôle. Vérifiez votre sélection.");
      continue;
    }
    const existing = issues.find(issue => issue.id === link.issueId);
    if (!existing || existing.status === "resolu" || issueRoom(existing) !== record.room)
      conflicts.push("Le problème associé a été résolu, déplacé ou supprimé. Actualisez puis choisissez un problème encore ouvert dans cette chambre.");
  }
  if (!candidate) return { issue: undefined, relatedIssueIds: [] as string[], conflicts, requiresChoice };
  const open = openRoomIssues(issues, record.room);
  const related = new Set<string>();
  const remaining = findings.filter(finding => {
    // Older queued drafts may still carry distinctProblemKeys. They cannot
    // bypass the single open follow-up for the same room checklist finding.
    const explicit = record.issueLinks?.find(link => link.key === finding.key);
    if (explicit) {
      const existing = open.find(issue => explicit.issueId === issue.id);
      if (existing) { related.add(existing.id); return false; }
      return true; // A stale link must never silently create a replacement.
    }
    const matching = open.filter(issue => matchesRoomFinding(issue, finding));
    if (matching.length > 1 || (matching.length === 1 && ((finding.problemType && !exactTypedDescription(matching[0], finding)) ||
      (finding.key === "damage" && !finding.problemType && !meaningful(finding.description || ""))))) {
      requiresChoice.push(finding.key);
      conflicts.push(`Un problème similaire est déjà ouvert pour « ${getProblemPreset(finding.problemType)?.label || finding.label} ». Choisissez le signalement à réutiliser ou précisez un problème différent.`);
      return true;
    }
    if (matching.length === 1) { related.add(matching[0].id); return false; }
    return true;
  });
  if (conflicts.length || (candidate.roomFindings?.length && !remaining.length)) return { issue: undefined, relatedIssueIds: [...related], conflicts, requiresChoice };
  const issue = { ...candidate, roomFindings: remaining,
    description: remaining.length ? [...remaining.map(finding => finding.label), ...(record.notes && !remaining.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) : candidate.description };
  if (isCafardTechnicalReport(issue)) conflicts.push(cafardTechnicalReportMessage());
  return { issue: conflicts.length ? undefined : issue, relatedIssueIds: [...related], conflicts, requiresChoice };
}

export function validateRoomIssuePlan(candidate: Issue | undefined, record: RoomIssueRecord, issues: readonly Issue[]): string | undefined {
  return planRoomIssue(candidate, record, issues).conflicts[0];
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
  if (plan.conflicts.length) throw new Error(plan.conflicts[0]);
  record.relatedIssueIds = plan.relatedIssueIds;
  record.createdIssue = !!plan.issue;
  record.newIssueFindingKeys = plan.issue?.roomFindings?.map(f => f.key) || [];
  record.issueSyncVersion = 2;
  return plan.issue;
}
