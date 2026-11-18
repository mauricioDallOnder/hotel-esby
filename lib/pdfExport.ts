import jsPDF from "jspdf";
import { displayDate, statuses, type Issue, type State } from "./domain";
import { loadPhotoData, photoSource } from "./photos";
import { indexReportPhotos, reportPeriodEnd, reportRows, reportScopes, type ReportPhoto, type ReportScope } from "./reportData";
export { dailyIssues } from "./reportData";

type ReportOptions = {
  kind: "daily" | "monthly";
  period: string;
  hotelName: string;
  state: State;
  scope?: ReportScope;
};

type PhotoLoader = (issue: Issue, index: number, photo: ReportPhoto) => Promise<string | null>;

export async function buildReport(
  { kind, period, state, scope = "all" }: ReportOptions,
  photoLoader: PhotoLoader = loadPhoto
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const PAGE_WIDTH = 210;
  const LEFT = 14;
  const RIGHT = 14;
  const TEXT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
  const CONTENT_BOTTOM = 277;
  const PHOTO_COLUMNS = 3;
  const PHOTO_GAP = 6;
  const PHOTO_WIDTH = (TEXT_WIDTH - PHOTO_GAP * (PHOTO_COLUMNS - 1)) / PHOTO_COLUMNS;
  const PHOTO_HEIGHT = 48;
  const PHOTO_ROW_HEIGHT = PHOTO_HEIGHT + 12;
  let y = 32;

  const end = reportPeriodEnd(kind, period);
  const subtitle = kind === "daily"
    ? `Rapport du ${displayDate(period)}`
    : `Rapport mensuel · ${period.split("-").reverse().join("/")}`;

  function normalizeText(value: string): string {
    return String(value ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-");
  }
  function split(value: string, size: number, style = "normal"): string[] {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    return doc.splitTextToSize(normalizeText(value), TEXT_WIDTH) as string[];
  }
  function pageHeader() {
    doc.setFillColor(23, 62, 54);
    doc.rect(0, 0, PAGE_WIDTH, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Hôtel Contrôle", LEFT, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(normalizeText(subtitle), PAGE_WIDTH - RIGHT, 13, { align: "right" });
  }
  function checkPage(neededSpace: number, continuedIssue?: Pick<Issue, "title" | "location">) {
    if (y + neededSpace <= CONTENT_BOTTOM) return;
    doc.addPage();
    pageHeader();
    y = 32;
    if (continuedIssue) {
      // Keep each photo associated with its problem when a gallery continues on another page.
      for (const line of split(`${continuedIssue.title} (suite)`, 11, "bold")) {
        doc.setTextColor(35, 50, 45);
        doc.text(line, LEFT, y);
        y += 5;
      }
      for (const line of split(continuedIssue.location, 9, "italic")) {
        doc.setTextColor(100);
        doc.text(line, LEFT, y);
        y += 4.5;
      }
      y += 3;
    }
  }
  function writeLines(lines: string[], size: number, style: string, lineHeight: number, color: number, issue?: Pick<Issue, "title" | "location">) {
    for (const line of lines) {
      checkPage(lineHeight, issue);
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      doc.setTextColor(color);
      doc.text(line, LEFT, y);
      y += lineHeight;
    }
  }
  async function getPhoto(issue: Issue, index: number, photo: ReportPhoto) {
    try { return await photoLoader(issue, index, photo); }
    catch { return null; }
  }

  pageHeader();
  doc.setTextColor(35, 50, 45);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(reportScopes[scope].heading, LEFT, y);
  y += 12;

  const rows = reportRows(state, kind, period, scope);
  const getPhotos = indexReportPhotos(state, end);
  if (!rows.length) writeLines([reportScopes[scope].empty], 11, "normal", 5, 50);

  for (const [issueIndex, { issue, title, description, status, photos }] of rows.entries()) {
    const attachments = photos ?? getPhotos(issue);
    const continuedIssue = { title, location: issue.location };
    const titleLines = split(title, 12, "bold");
    const statusLabel = scope === "complete" || scope === "resolved" ? ` · ${statuses[status]}` : "";
    const metaLines = split(`${issue.location} · Constat du ${displayDate(issue.date)}${statusLabel}`, 9, "italic");
    const descLines = split(description, 10);
    const headingHeight = titleLines.length * 5.5 + metaLines.length * 4.5 + 3;
    const blockHeight = headingHeight + descLines.length * 4.5 + 4 + Math.ceil(attachments.length / PHOTO_COLUMNS) * PHOTO_ROW_HEIGHT;
    // Keep normal-size problems together. Longer descriptions flow across pages instead of being clipped.
    checkPage(issueIndex > 0 && blockHeight <= CONTENT_BOTTOM - 32 ? blockHeight : headingHeight + 4.5);
    writeLines(titleLines, 12, "bold", 5.5, 35);
    writeLines(metaLines, 9, "italic", 4.5, 100);
    y += 3;
    writeLines(descLines, 10, "normal", 4.5, 50, continuedIssue);
    y += 4;

    // Load at most one row at a time, preserving every attachment and its original index.
    for (let start = 0; start < attachments.length; start += PHOTO_COLUMNS) {
      const photos = await Promise.all(attachments.slice(start, start + PHOTO_COLUMNS).map((photo, column) => getPhoto(issue, start + column, photo)));
      checkPage(PHOTO_ROW_HEIGHT, continuedIssue);
      for (const [column, data] of photos.entries()) {
        const index = start + column;
        const x = LEFT + column * (PHOTO_WIDTH + PHOTO_GAP);
        const imageTop = y + 7;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(70);
        doc.text(`Photo ${index + 1} / ${attachments.length} · ${displayDate(attachments[index].date)}`, x, y + 3);
        doc.setDrawColor(210); doc.setLineWidth(0.2);
        doc.rect(x, imageTop, PHOTO_WIDTH, PHOTO_HEIGHT);
        let available = false;
        if (data) {
          try {
            const props = doc.getImageProperties(data);
            if (!Number.isFinite(props.width) || !Number.isFinite(props.height) || props.width <= 0 || props.height <= 0) throw new Error("Photo invalide.");
            const scale = Math.min(PHOTO_WIDTH / props.width, PHOTO_HEIGHT / props.height);
            const width = props.width * scale;
            const height = props.height * scale;
            doc.addImage(data, x + (PHOTO_WIDTH - width) / 2, imageTop + (PHOTO_HEIGHT - height) / 2, width, height);
            available = true;
          } catch { /* An invalid image must not hide the remaining attachments. */ }
        }
        if (!available) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(120);
          doc.text("Photo indisponible", x + PHOTO_WIDTH / 2, imageTop + PHOTO_HEIGHT / 2, { align: "center" });
        }
      }
      y += PHOTO_ROW_HEIGHT;
    }

    if (y + 8 <= CONTENT_BOTTOM) {
      doc.setDrawColor(230);
      doc.line(LEFT, y + 2, PAGE_WIDTH - RIGHT, y + 2);
    }
    y += 8;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`Page ${page} / ${pages}`, PAGE_WIDTH - RIGHT, 290, { align: "right" });
  }
  return doc;
}

function loadPhoto(_issue: Issue, _index: number, photo: ReportPhoto): Promise<string | null> {
  return loadPhotoData(photoSource(photo.sourceId, photo.index, photo.collection));
}

export async function downloadReport(options: ReportOptions) {
  const doc = await buildReport(options);
  const prefix = {
    all: options.kind === "daily" ? "rapport-quotidien" : "bilan-mensuel",
    room_clutter: "chambres-encombrees",
    technical: "problemes-techniques",
    resolved: "problemes-resolus",
    complete: "rapport-complet",
  }[options.scope ?? "all"];
  doc.save(`${prefix}-${options.period}.pdf`);
}
