import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { displayDate } from "./domain";
import type { WorkEntry, WorkEvent } from "./rooms";
import { dailyTasks } from "./work";

type Options = { hotelName: string } & (
  | { mode: "blank" }
  | { mode: "day"; date: string; events: (WorkEntry | WorkEvent)[]; pendingIds?: string[]; cachedAt?: string }
);

const margin = 14;
const width = 182;

/** Print the same current task revisions as the selected day, or a reusable blank sheet. */
export function buildDailyTasksPdf(options: Options) {
  const tasks = options.mode === "day" ? dailyTasks(options.events, options.date) : [];
  const done = tasks.filter(task => task.done).length;
  const pending = new Set(options.mode === "day" ? options.pendingIds : []);
  const doc = new jsPDF({ orientation: "portrait", format: "a4", compress: true });
  doc.setProperties({ title: "Tâches du jour", subject: "Liste des tâches à imprimer", author: options.hotelName });
  const dateLabel = options.mode === "day" ? `Date : ${displayDate(options.date)}` : "Date : ____ / ____ / ________";

  function text(value: string, x: number, y: number, size = 10, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(25);
    doc.text(value, x, y);
  }
  function paragraph(value: string, y: number, size = 10, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(value, width) as string[];
    doc.setTextColor(25);
    doc.text(lines, margin, y);
    return y + lines.length * size * 0.43;
  }
  function continuation() {
    text("Tâches du jour (suite)", margin, 18, 14, true);
    text(dateLabel, margin, 26, 10);
  }

  let y = paragraph(options.hotelName || "Hôtel", 15, 10);
  text("Tâches du jour", margin, y + 8, 20, true);
  text(dateLabel, margin, y + 19, 12, true);
  text("Équipe / personne : __________________________________________________", margin, y + 28, 10);
  doc.setDrawColor(150); doc.setLineWidth(0.25);
  doc.line(margin, y + 33, margin + width, y + 33);
  y += 42;

  if (tasks.length) {
    y = paragraph(`${tasks.length} tâche(s) au total  -  ${tasks.length - done} à faire  -  ${done} terminée(s)`, y, 10, true) + 2;
  } else {
    y = paragraph(options.mode === "blank" ? "Fiche vierge à remplir" : "Aucune tâche enregistrée pour cette date.", y, 10, true) + 2;
  }
  if (options.mode === "day" && options.cachedAt) {
    y = paragraph("Données conservées sur cet appareil. Actualisez avec une connexion pour obtenir les dernières modifications partagées.", y, 9) + 2;
  }
  y = paragraph(tasks.length
    ? "Les cases cochées indiquent les tâches déjà terminées. Cochez les autres au fur et à mesure."
    : "Écrivez une tâche par ligne, puis cochez la case « Fait » lorsqu'elle est terminée.", y, 9) + 3;

  // Draw boxes as vectors: standard PDF fonts do not reliably contain checkbox symbols.
  autoTable(doc, {
    startY: y, theme: "grid", tableWidth: width,
    margin: { top: 34, bottom: 20, left: margin, right: margin },
    head: [["N°", "Fait", "Tâche", "Notes / suivi"]],
    body: tasks.length
      ? tasks.map((task, i) => [String(i + 1), "", task.notes + (pending.has(task.id) ? "\nEn attente d’envoi" : ""), ""])
      : Array.from({ length: 12 }, (_, i) => [String(i + 1), "", "", ""]),
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 2.5, minCellHeight: 12, textColor: 25, lineColor: 165, lineWidth: 0.15, valign: "middle", overflow: "linebreak" },
    headStyles: { fillColor: [238, 238, 238], textColor: 25, fontStyle: "bold", minCellHeight: 8 },
    columnStyles: { 0: { cellWidth: 11, halign: "center" }, 1: { cellWidth: 15, halign: "center" }, 2: { cellWidth: 110 }, 3: { cellWidth: 46 } },
    rowPageBreak: "avoid",
    willDrawPage: ({ pageNumber }) => { if (pageNumber > 1) continuation(); },
    didDrawCell: cell => {
      if (cell.section !== "body" || cell.column.index !== 1) return;
      const size = 4;
      const x = cell.cell.x + (cell.cell.width - size) / 2;
      const y = cell.cell.y + (cell.cell.height - size) / 2;
      doc.setDrawColor(45); doc.setLineWidth(0.3); doc.rect(x, y, size, size);
      // Split rows keep their original raw data even when autoTable resets the row index.
      const taskIndex = Number((cell.row.raw as string[])[0]) - 1;
      if (tasks[taskIndex]?.done) {
        doc.setLineWidth(0.45);
        doc.line(x + 0.7, y + 0.7, x + size - 0.7, y + size - 0.7);
        doc.line(x + 0.7, y + size - 0.7, x + size - 0.7, y + 0.7);
      }
    },
  });

  // Keep the heading and all three handwriting lines together, clear of the footer.
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  if (y + 27 > 276) { doc.addPage(); continuation(); y = 39; }
  text("Notes et suivi", margin, y, 11, true);
  doc.setDrawColor(170); doc.setLineWidth(0.2);
  for (let line = 1; line <= 3; line++) doc.line(margin, y + line * 8, margin + width, y + line * 8);

  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page);
    doc.setDrawColor(170); doc.setLineWidth(0.2); doc.line(margin, 284, margin + width, 284);
    text(options.mode === "blank" ? "Fiche de suivi quotidien" : "État des tâches au moment de l'export", margin, 290, 8);
    doc.text(`Page ${page} / ${count}`, margin + width, 290, { align: "right" });
  }
  return doc;
}

export function downloadDailyTasksPdf(options: Options) {
  const doc = buildDailyTasksPdf(options);
  return doc.save(options.mode === "blank" ? "taches-du-jour-vierge.pdf" : `taches-du-jour-${options.date}.pdf`, { returnPromise: true });
}
