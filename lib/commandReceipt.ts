import { createHash } from "node:crypto";
import { DomainError, type Change, type Command, type Issue, type State } from "./domain";

export type CommandOperation = { id: string; hash: string };

// Object property order must not turn an exact retry into a different operation.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function commandOperation(command: Command): CommandOperation | undefined {
  const id = command.type === "createIssue" ? command.id : command.type === "updateIssue" ? command.commandId : undefined;
  return id ? { id, hash: createHash("sha256").update(JSON.stringify(canonical(command))).digest("hex") } : undefined;
}

export function hasCommandReceipt(issue: Issue, operation: CommandOperation) {
  const receipt = issue.history?.find(event => event.commandId === operation.id);
  if (!receipt) return false;
  if (receipt.commandHash !== operation.hash)
    throw new DomainError("Cette demande a déjà été enregistrée avec un contenu différent. Actualisez la fiche avant de poursuivre.", 409);
  return true;
}

export function isCommandReplay(state: State, command: Command, operation: CommandOperation | undefined) {
  if (!operation || command.type === "saveInspection") return false;
  const current = state.issues.find(issue => issue.id === command.id);
  return !!current && hasCommandReceipt(current, operation);
}

export function stampCommandReceipt(change: Change, operation: CommandOperation | undefined) {
  if (change.collection !== "issues" || !operation) return;
  change.record.history = change.record.history.map((event, index, events) => index === events.length - 1
    ? { ...event, commandId: operation.id, commandHash: operation.hash } : event);
}
