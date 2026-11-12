import { createId, issueResponsible, today, type Command, type Issue, type IssueFields, type Status } from "./domain";
import { issueFindingStates, type FindingDetail, type FindingState } from "./issueFindings";

export type IssueDefaults = { title?: string; location?: string; actor?: string; priority?: IssueFields["priority"]; date?: string };
export type IssueDraft = {
  id: string;
  commandId: string;
  expectedVersion?: number;
  fields: IssueFields;
  baseline: IssueFields;
  baselineStatus: Status;
  baselineDate: string;
  baselineActor: string;
  date: string;
  actor: string;
  status: Status;
  note: string;
  photos: string[];
  customTitle: string;
  cafardMode: boolean;
  findingStates: FindingState[];
  findingDetails: FindingDetail[];
  findingDetailsReviewed: boolean;
  distinctFromIssueIds: string[];
  distinctReason: string;
  attempt?: Command;
};

export function issueDraftKey(issue?: Issue, defaults?: IssueDefaults) {
  return issue ? "draft:issue:" + issue.id : "draft:issue:new" +
    (defaults?.title || defaults?.location ? ":" + encodeURIComponent([defaults.title || "", defaults.location || "", defaults.date || ""].join("|")) : "");
}

export function freshIssueDraft(issue?: Issue, defaults?: IssueDefaults): IssueDraft {
  const fields: IssueFields = { title: issue?.title || defaults?.title || "", location: issue?.location || defaults?.location || "",
    category: issue?.category || "Plomberie", priority: issue?.priority || defaults?.priority || "normale",
    description: issue?.description || "", assignee: issue ? issueResponsible(issue) : "",
    ...(issue?.problemType ? { problemType: issue.problemType } : {}) };
  const date = defaults?.date || today(), actor = issue ? "" : defaults?.actor || "";
  return { id: issue?.id || createId(), commandId: createId(), expectedVersion: issue?.version,
    fields, baseline: fields, baselineStatus: issue?.status || "ouvert", baselineDate: date, baselineActor: actor,
    date, actor, status: issue?.status || "ouvert", note: "", photos: [], customTitle: fields.title, cafardMode: false,
    findingStates: issue ? issueFindingStates(issue) : [],
    findingDetails: (issue?.roomFindings || []).map(({ key, label, problemType, description }) => ({ key, label, ...(problemType ? { problemType } : {}), ...(description ? { description } : {}) })),
    findingDetailsReviewed: issue?.roomFindingsActive !== false,
    distinctFromIssueIds: issue?.distinctFromIssueIds || [], distinctReason: issue?.distinctReason || "" };
}

export function issueDraftIsStale(draft: IssueDraft, issue?: Issue) {
  if (draft.expectedVersion === undefined) return false;
  if (!issue) return true;
  return issue.version !== draft.expectedVersion && !issue.history.some(event => event.commandId === draft.commandId);
}

/** An uncertain request is retried byte-for-byte, never rebuilt from later form edits. */
export function issueDraftCommand(draft: IssueDraft, issue?: Issue): Command {
  if (draft.attempt) return draft.attempt;
  const fields = { ...draft.fields, description: draft.fields.problemType && draft.fields.problemType !== "other" && !draft.fields.description.trim() ? draft.fields.title : draft.fields.description,
    assignee: issue ? issueResponsible(issue) : draft.actor.trim() };
  const distinction = draft.distinctFromIssueIds.length ? { distinctFromIssueIds: draft.distinctFromIssueIds, distinctReason: draft.distinctReason } : {};
  if (draft.expectedVersion !== undefined) return { type: "updateIssue", id: draft.id, commandId: draft.commandId, version: draft.expectedVersion,
    actor: draft.actor, note: draft.note, status: draft.status, fields, ...distinction,
    ...(draft.findingStates.length ? { findingStates: draft.findingStates } : {}),
    // Grouped details have their own editor. A single free-text correction must
    // not silently reaffirm its original structured classification.
    ...(draft.findingDetails.length > 1 && draft.findingDetailsReviewed ? { findingDetails: draft.findingDetails } : {}) };
  return { type: "createIssue", id: draft.id, date: draft.date, actor: draft.actor, fields, photosData: draft.photos, ...distinction };
}

export type ActiveIssueDraft = { key: string; issueId?: string };
