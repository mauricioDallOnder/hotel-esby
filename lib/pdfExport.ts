import jsPDF from "jspdf";
import { displayDate, eventAt, issuePhotoIds, monthlySummary, today, type Issue, type State } from "./domain";

export function dailyIssues(state: State, date: string): Issue[] {
  const linked = new Set(
    state.inspections
      .filter((inspection) => inspection.date === date)
      .flatMap((inspection) => inspection.checks.map((check) => check.issueId))
  );

  return state.issues.filter(
    (issue) =>
      issue.date <= date &&
      (issue.date === date ||
        (eventAt(issue, date)?.status ?? "ouvert") !== "resolu" ||
        linked.has(issue.id) ||
        issue.history.some((event) => today(new Date(event.at)) === date))
  );
}

type ReportOptions = {
  kind: "daily" | "monthly";
  period: string;
  hotelName: string;
  state: State;
};

type PhotoLoader = (issue: Issue, index: number) => Promise<string | null>;

export async function buildReport(
  { kind, period, state }: ReportOptions,
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

  const monthly = kind === "monthly" ? monthlySummary(state, period) : null;
  const end = monthly?.end || period;
  const issues = monthly?.issues || dailyIssues(state, period);
  const subtitle = kind === "daily"
    ? `Rapport anomalies · ${displayDate(period)}`
    : `Anomalies du mois · ${period.split("-").reverse().join("/")}`;

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
  function checkPage(neededSpace: number, continuedIssue?: Issue) {
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
  function writeLines(lines: string[], size: number, style: string, lineHeight: number, color: number, issue?: Issue) {
    for (const line of lines) {
      checkPage(lineHeight, issue);
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      doc.setTextColor(color);
      doc.text(line, LEFT, y);
      y += lineHeight;
    }
  }
  async function getPhoto(issue: Issue, index: number) {
    try { return await photoLoader(issue, index); }
    catch { return null; }
  }

  pageHeader();
  doc.setTextColor(35, 50, 45);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Problèmes à traiter", LEFT, y);
  y += 12;

  // Keep the report's existing date/status selection; only its photo coverage changes.
  const unresolvedIssues = issues.filter(issue => (eventAt(issue, end)?.status ?? "ouvert") !== "resolu");
  if (!unresolvedIssues.length) writeLines(["Aucun problème en attente."], 11, "normal", 5, 50);

  for (const [issueIndex, issue] of unresolvedIssues.entries()) {
    const photoIds = issuePhotoIds(issue);
    const titleLines = split(issue.title, 12, "bold");
    const metaLines = split(`${issue.location} · Constat du ${displayDate(issue.date)}`, 9, "italic");
    const descLines = split(issue.description, 10);
    const headingHeight = titleLines.length * 5.5 + metaLines.length * 4.5 + 3;
    const blockHeight = headingHeight + descLines.length * 4.5 + 4 + Math.ceil(photoIds.length / PHOTO_COLUMNS) * PHOTO_ROW_HEIGHT;
    // Keep normal-size problems together. Longer descriptions flow across pages instead of being clipped.
    checkPage(issueIndex > 0 && blockHeight <= CONTENT_BOTTOM - 32 ? blockHeight : headingHeight + 4.5);
    writeLines(titleLines, 12, "bold", 5.5, 35);
    writeLines(metaLines, 9, "italic", 4.5, 100);
    y += 3;
    writeLines(descLines, 10, "normal", 4.5, 50, issue);
    y += 4;

    // Load at most one row at a time, preserving every attachment and its original index.
    for (let start = 0; start < photoIds.length; start += PHOTO_COLUMNS) {
      const photos = await Promise.all(photoIds.slice(start, start + PHOTO_COLUMNS).map((_, column) => getPhoto(issue, start + column)));
      checkPage(PHOTO_ROW_HEIGHT, issue);
      for (const [column, data] of photos.entries()) {
        const index = start + column;
        const x = LEFT + column * (PHOTO_WIDTH + PHOTO_GAP);
        const imageTop = y + 7;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(70);
        doc.text(`Photo ${index + 1} / ${photoIds.length}`, x, y + 3);
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

// Mantido o Retry Anti-Crash
async function loadPhoto(issue: Issue, index: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`/api/photos/${issue.id}?index=${index}&collection=issues`, { cache: "no-store" });
      if (response.ok) {
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
          reader.readAsDataURL(blob);
        });
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

export async function downloadReport(options: ReportOptions) {
  const doc = await buildReport(options);
  const prefix = options.kind === "daily" ? "rapport-quotidien" : "bilan-mensuel";
  doc.save(`${prefix}-${options.period}.pdf`);
}
