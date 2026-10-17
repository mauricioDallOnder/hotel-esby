import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

// Keep the deployable Code.gs self-contained without maintaining a second matcher.
export function roomIssueBundle() {
  const code = ts.transpileModule(readFileSync("lib/roomIssueMatching.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return `// BEGIN GENERATED ROOM ISSUE MATCHING — npm run build:apps-script\nvar RoomIssueMatching = (function () {\nvar exports = {};\n${code}\nreturn exports;\n})();\n// END GENERATED ROOM ISSUE MATCHING\n`;
}
function workBundle() {
  const code = ts.transpileModule(readFileSync("lib/work.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return `// BEGIN GENERATED WORK EVENTS — npm run build:apps-script\nvar WorkLogic = (function () {\nvar exports = {};\n${code}\nreturn exports;\n})();\n// END GENERATED WORK EVENTS\n`;
}
const path = "google-apps-script/Code.gs";
const original = readFileSync(path, "utf8").split("// BEGIN GENERATED ROOM ISSUE MATCHING")[0];
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== original + roomIssueBundle() + workBundle()) throw new Error("Run npm run build:apps-script before committing.");
} else writeFileSync(path, original + roomIssueBundle() + workBundle());
