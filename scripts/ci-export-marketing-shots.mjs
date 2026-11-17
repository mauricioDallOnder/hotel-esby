// Temporary one-off transfer: screenshots from synthetic Playwright tests only.
import { globSync, readFileSync } from "node:fs";
const names = {
  checklist: "checklist-uniform-1440.png",
  occupation: "room-vacancy-dialog-mobile-dark.png",
  laundry: "laundry-desktop.png",
  cafards: "cafards-desktop.png",
  objects: "collected-items-desktop.png",
  reports: "clutter-reports-mobile.png",
  radiator: "radiator-choice-mobile.png",
};
const paths = globSync("test-results/**/*.png");
for (const [slug, filename] of Object.entries(names)) {
  const matches = paths.filter(path => path.endsWith("/" + filename));
  if (matches.length !== 1) throw new Error("Missing/duplicate demo screenshot: " + filename);
  const content = readFileSync(matches[0]).toString("base64");
  console.log("SCREENSHOT_BEGIN " + slug + " " + content.length);
  for (let offset = 0; offset < content.length; offset += 12000) {
    console.log("SCREENSHOT_PART " + slug + " " + offset / 12000 + " " + content.slice(offset, offset + 12000));
  }
  console.log("SCREENSHOT_END " + slug);
}
