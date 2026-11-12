// Pure projections: also bundled into the Apps Script write boundary.
import type { Issue, Status } from "./domain";

export type IssueFinding = NonNullable<Issue["roomFindings"]>[number];
export type FindingState = { key: string; status: Status };
export type FindingDetail = Pick<IssueFinding, "key" | "label" | "problemType" | "description">;

export function issueFindingStatus(issue: Pick<Issue, "status">, finding: IssueFinding): Status {
  // Older records have only a global status. A globally resolved legacy record
  // must not reopen merely because one imported item has no individual state.
  return issue.status === "resolu" ? "resolu" : finding.status || issue.status;
}

export function issueFindingStates(issue: Pick<Issue, "status" | "roomFindings">): FindingState[] {
  return (issue.roomFindings || []).map(finding => ({ key: finding.key, status: issueFindingStatus(issue, finding) }));
}

export function aggregateFindingStatus(findings: readonly { status: Status }[], fallback: Status): Status {
  if (!findings.length) return fallback;
  if (findings.every(finding => finding.status === "resolu")) return "resolu";
  return findings.some(finding => finding.status !== "ouvert") ? "en_cours" : "ouvert";
}

export function issueFindingProgress(issue: Pick<Issue, "status" | "roomFindings">) {
  const states = issueFindingStates(issue);
  const resolved = states.filter(finding => finding.status === "resolu").length;
  return { total: states.length, resolved, pending: states.length - resolved };
}

export function findingDetailsText(findings: readonly FindingDetail[]): string {
  return findings.map(finding => [finding.label, finding.description && !finding.label.includes(finding.description) ? finding.description : ""].filter(Boolean).join(" : ")).join("\n");
}

/** Resolved items and superseded classifications cannot identify a new repair. */
export function issueMatchingSnapshot<T extends Partial<Issue>>(issue: T): T {
  if (issue.roomFindingsActive === false) {
    const partiallyResolved = issue.roomFindings?.some(finding => finding.status === "resolu");
    // Once the free text and the original item list diverge, a partial repair
    // cannot safely tell which sentence still identifies an open fitting.
    return { ...issue, roomFindings: undefined, ...(partiallyResolved ? { title: "", description: "", problemType: undefined } : {}) };
  }
  if (!issue.roomFindings?.length) return issue;
  const findings = issue.roomFindings.filter(finding => issueFindingStatus({ status: issue.status || "ouvert" }, finding) !== "resolu");
  if (findings.length === issue.roomFindings.length) return issue;
  return { ...issue, roomFindings: findings, title: "", description: findingDetailsText(findings), problemType: undefined };
}

export function validateIssueFindingUpdate(current: Issue, requestedStatus: Status, states?: readonly FindingState[], details?: readonly FindingDetail[]): string | undefined {
  const findings = current.roomFindings || [];
  const validKeys = new Set(findings.map(finding => finding.key));
  for (const values of [states, details]) {
    if (values === undefined) continue;
    if (values.length !== findings.length || new Set(values.map(value => value.key)).size !== values.length || values.some(value => !validKeys.has(value.key)))
      return "La liste des problèmes a changé. Rechargez la fiche avant de modifier ses éléments.";
  }
  if (states?.length && requestedStatus === "resolu" && states.some(finding => finding.status !== "resolu"))
    return "Terminez chaque problème avant de résoudre toute la fiche, ou conservez la fiche en cours.";
  return undefined;
}

export function updatedIssueFindings(current: Issue, requestedStatus: Status, states?: readonly FindingState[], details?: readonly FindingDetail[]) {
  if (!current.roomFindings?.length) return { roomFindings: current.roomFindings, status: requestedStatus };
  const roomFindings = current.roomFindings.map(finding => {
    const detail = details?.find(value => value.key === finding.key);
    const status = states?.find(value => value.key === finding.key)?.status ||
      (requestedStatus !== current.status ? requestedStatus : issueFindingStatus(current, finding));
    return { ...(detail || finding), status };
  });
  return { roomFindings, status: aggregateFindingStatus(roomFindings, requestedStatus) };
}
