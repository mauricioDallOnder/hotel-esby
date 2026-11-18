import { displayDate, eventAt, statuses, today, type Event, type Issue, type State, type Status } from "./domain";
import { findingKind, standaloneIssueKind } from "./issueCategory";
import { aggregateFindingStatus, findingDetailsText, type IssueFinding } from "./issueFindings";
import { cafardReportRows } from "./cafardReport";
import type { ReportPhoto } from "./reportPhotos";
export { reportPhotos, indexReportPhotos, type ReportPhoto } from "./reportPhotos";

export type ReportScope = "all" | "technical" | "room_clutter" | "resolved" | "complete";
export type ReportKind = "daily" | "monthly";

export const reportScopes = {
  all: { label: "Tous les problèmes à traiter", heading: "Problèmes à traiter", empty: "Aucun problème en attente." },
  technical: { label: "Problèmes techniques", heading: "Problèmes techniques à traiter", empty: "Aucun problème technique en attente." },
  room_clutter: { label: "Chambres encombrées", heading: "Chambres encombrées", empty: "Aucune chambre encombrée en attente." },
  resolved: { label: "Problèmes résolus", heading: "Problèmes résolus sur la période", empty: "Aucun problème résolu sur la période." },
  complete: { label: "Rapport complet", heading: "Rapport complet des problèmes", empty: "Aucun problème en attente ou résolu sur la période." },
} as const;

export function dailyIssues(state: State, date: string): Issue[] {
  const linked = new Set(state.inspections.filter(inspection => inspection.date === date)
    .flatMap(inspection => inspection.checks.map(check => check.issueId)));
  return state.issues.filter(issue => issue.date <= date &&
    (issue.date === date || (eventAt(issue, date)?.status ?? "ouvert") !== "resolu" || linked.has(issue.id) ||
      issue.history.some(event => today(new Date(event.at)) === date)));
}

export function reportPeriodEnd(kind: ReportKind, period: string): string {
  if (kind === "daily") return period;
  const [year, month] = period.split("-").map(Number);
  return `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
}

type DatedEvent = { event: Event; day: string };
type Resolution = { event?: Event; day: string };
export type ReportRow = {
  issue: Issue;
  title: string;
  description: string;
  status: Status;
  photos?: ReportPhoto[];
};

function statusIn(event: Event, key?: string): Status {
  if (!key || event.status === "resolu") return event.status;
  return event.findingStates?.find(state => state.key === key)?.status ?? event.status;
}

// A later note on a closed item is not another resolution. A reopening
// starts a new interval, independently for each finding in a grouped issue.
function resolutionSince(history: DatedEvent[], start: string, key?: string) {
  let resolution: DatedEvent | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (statusIn(entry.event, key) !== "resolu") break;
    if (entry.day < start) return;
    resolution = entry;
  }
  return resolution;
}

export function reportRows(state: State, kind: ReportKind, period: string, scope: ReportScope): ReportRow[] {
  const end = reportPeriodEnd(kind, period);
  const start = kind === "daily" ? period : period + "-01";
  const rows: ReportRow[] = [];
  const cafards = cafardReportRows(state, start, end, scope);
  for (const issue of state.issues) {
    if (issue.date > end || cafards.replacedIssueIds.has(issue.id)) continue;
    const history = issue.history.map(event => ({ event, day: today(new Date(event.at)) })).filter(entry => entry.day <= end);
    const last = history.at(-1)?.event;
    const updated = new Date(issue.updatedAt);
    const updatedDay = Number.isFinite(updated.getTime()) ? today(updated) : undefined;
    const currentByEnd = !!updatedDay && updatedDay <= end;
    const latestSnapshot = currentByEnd && last === issue.history.at(-1);
    const status = last?.status ?? (currentByEnd ? issue.status : "ouvert");
    const findings = issue.roomFindingsActive === false && currentByEnd ? [] : last?.findingDetails ?? issue.roomFindings ?? [];
    const row = { issue, title: issue.title, description: issue.description, status };
    const mixedCafards = cafards.mixedIssueIds.has(issue.id);

    if (scope === "all" && !mixedCafards) {
      if (status !== "resolu") rows.push(row);
      continue;
    }

    const categoryOnly = scope === "technical" || scope === "room_clutter";
    if (categoryOnly && status === "resolu") continue;
    const sections: string[] = [];
    const selectedStates: { status: Status }[] = [];
    const resolutions = new Map<Resolution, string[]>();
    const legacyResolution = !issue.history.length && updatedDay && currentByEnd && updatedDay >= start
      ? { day: updatedDay } : undefined;
    // Manual reports have one item. Structured checklists can contain
    // several distinct categories and resolution dates under one issue ID.
    const items: (IssueFinding | undefined)[] = findings.length ? findings : [undefined];
    for (const finding of items) {
      if (mixedCafards && finding && findingKind(finding) === "cafards") continue;
      if (categoryOnly && (finding ? findingKind(finding) : standaloneIssueKind(issue)) !== scope) continue;
      const storedStatus = latestSnapshot && finding && !last?.findingStates && status !== "resolu" ? finding.status : undefined;
      const itemStatus = storedStatus ?? (last ? statusIn(last, finding?.key) : status);
      const detail = finding ? findingDetailsText([finding]) : issue.description;
      if (itemStatus === "resolu") {
        if (scope !== "complete" && scope !== "resolved") continue;
        const resolution = resolutionSince(history, start, finding?.key) ?? legacyResolution;
        if (!resolution) continue;
        const details = resolutions.get(resolution);
        if (details) details.push(detail);
        else resolutions.set(resolution, [detail]);
      } else {
        if (scope === "resolved") continue;
        sections.push(scope === "complete" && finding ? `${statuses[itemStatus]} · ${detail}` : detail);
      }
      selectedStates.push({ status: itemStatus });
    }
    if (!selectedStates.length) continue;
    const partial = selectedStates.length < items.length;
    const useHistoricalDetails = findings.length > 0 && !latestSnapshot;
    if (partial || useHistoricalDetails) row.title = `Constat · ${issue.location}`;
    for (const [{ day, event }, details] of resolutions) {
      const heading = event ? `Résolu le ${displayDate(day)} · ${event.actor}`
        : `Fiche résolue · Dernière mise à jour le ${displayDate(day)} (date de résolution inconnue)`;
      sections.push([heading, ...details, event?.note].filter(Boolean).join("\n"));
    }
    if (scope === "complete" && latestSnapshot && findings.length) {
      // Checklist descriptions start with generated finding labels. Keep the
      // inspector's additional observations without repeating those labels.
      const findingLines = new Set(findings.flatMap(finding =>
        [finding.label, finding.description || "", findingDetailsText([finding])].flatMap(text => text.split("\n").map(line => line.trim()))));
      const notes = issue.description.split("\n").filter(line => line.trim() && !findingLines.has(line.trim()));
      if (notes.length) sections.push(notes.join("\n"));
    }
    if (!categoryOnly || partial || useHistoricalDetails) row.description = sections.join("\n");
    row.status = aggregateFindingStatus(selectedStates, status);
    rows.push(row);
  }
  return rows.concat(cafards.rows);
}

export function reportPendingIssues(state: State, kind: ReportKind, period: string, scope: "all" | "technical" | "room_clutter" = "all"): Issue[] {
  return reportRows(state, kind, period, scope).map(row => row.issue);
}
