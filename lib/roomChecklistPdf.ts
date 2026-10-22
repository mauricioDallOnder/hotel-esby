import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { displayDate, today } from "./domain";
import {
  applianceCleaningLabels, carpetLabels, cleaningText, conditionLabels,
  latestRoomRecords, resultLabels, roomChecks, rooms,
  type RoomEntry, type RoomInspection,
} from "./rooms";

type Record = RoomEntry | RoomInspection;
type Options = { hotelName: string; date?: string } & (
  | { mode: "blank" }
  | { mode: "latest"; selectedRooms: string[]; history: Record[]; blockedIds?: string[] }
);

const margin = 14;
const width = 182;
const conditionChoices = [
  ["Occupation au contrôle", ["Libre", "Occupée"]],
  ["État général", ["Bon état", "À revoir", "Mauvais état"]],
  ["Ménage (si chambre libre)", ["Fait", "Non fait", "Non applicable"]],
  ["Cafards / nuisibles", ["Aucun", "Détectés"]],
  ["Moquette", ["OK", "Tachée", "Sale"]],
  ["Micro-ondes", ["Présent", "Absent"]],
  ["Propreté du micro-ondes", ["Propre", "Sale", "Non applicable"]],
  ["Propreté du minibar", ["Propre", "Sale", "Non applicable"]],
] as const;

function conditionAnswers(record: Record) {
  const fridge = record.checks.find(check => check.key === "fridge")?.result;
  const clean = (value: Record["microwaveCleaning"]) => value ? applianceCleaningLabels[value] : "Non renseignée";
  return [
    record.occupied === false ? "Libre" : record.occupied === true ? "Occupée" : "Non renseignée",
    conditionLabels[record.condition] || "Non renseigné",
    cleaningText(record),
    record.bugs === "oui" ? "Détectés" : record.bugs === "non" ? "Aucun" : "Non vérifié",
    carpetLabels[record.carpet] || "Non renseignée",
    record.microwave === "oui" ? "Présent" : record.microwave === "non" ? "Absent" : "Non vérifié",
    record.microwave === "non" ? "Non applicable - absent" : record.microwave === "oui" ? clean(record.microwaveCleaning) : "Non vérifié",
    fridge === "absent" ? "Non applicable - absent" : fridge === "ok" || fridge === "probleme" ? clean(record.fridgeCleaning) : "Non vérifié",
  ];
}

/** A printable form or the latest available inspection for each selected room. */
export function buildRoomChecklist(options: Options) {
  const date = options.date || today();
  const selected = options.mode === "blank" ? [""] : rooms.filter(room => options.selectedRooms.includes(room));
  if (!selected.length) throw new Error("Aucune chambre sélectionnée. Modifiez les filtres ou choisissez une fiche vierge.");
  const latest = latestRoomRecords(options.mode === "latest" ? options.history.filter(record => record.date <= date) : []);
  const blocked = new Set(options.mode === "latest" ? options.blockedIds : []);
  const doc = new jsPDF({ orientation: "portrait", format: "a4", compress: true });
  doc.setProperties({ title: "Checklist de chambre", subject: "Contrôle des chambres", author: options.hotelName });
  const pageRooms = new Map<number, string>();

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
    return y + lines.length * size * 0.405;
  }
  function continuation(room: string) {
    pageRooms.set(doc.getNumberOfPages(), room);
    text(`Checklist de chambre${room ? ` - Chambre ${room}` : ""} (suite)`, margin, 19, 13, true);
    text(`Édition du ${displayDate(date)}`, margin, 26, 9);
  }
  function ensureHeader(room: string) {
    if (!pageRooms.has(doc.getNumberOfPages())) continuation(room);
  }
  function section(title: string, y: number, room: string) {
    if (y > 258) { doc.addPage(); continuation(room); y = 37; }
    text(title, margin, y, 11, true);
    return y + 4;
  }
  function checkbox(x: number, y: number) {
    doc.setDrawColor(70); doc.setLineWidth(0.25); doc.rect(x, y, 3.3, 3.3);
  }

  selected.forEach((room, index) => {
    if (index) doc.addPage();
    pageRooms.set(doc.getNumberOfPages(), room);
    const record = latest.get(room);
    let y = paragraph(options.hotelName || "Hôtel", 15, 10);
    text("Checklist de chambre", margin, y + 6, 18, true);
    y += 13;
    text(record ? "Résultats du dernier contrôle disponible" : "Fiche vierge - À remplir lors du contrôle", margin, y, 9);
    doc.setDrawColor(150); doc.setLineWidth(0.25); doc.line(margin, y + 4, margin + width, y + 4);
    y += 12;
    text(`Chambre : ${room || "________________"}`, margin, y, 12, true);
    text(`Date du contrôle : ${record ? displayDate(record.date) : "____ / ____ / ________"}`, 108, y, 10);
    y = paragraph(`Inspecteur : ${record?.actor || "____________________________________________________________"}`, y + 7, 10) + 1;
    if (record) {
      const status = "updatedAt" in record ? "Enregistré sur le serveur" : blocked.has(record.id)
        ? "Envoi bloqué - contrôle conservé sur cet appareil" : "En attente d'envoi - contrôle conservé sur cet appareil";
      y = paragraph(status, y, 9, true) + 2;
    } else if (room) {
      y = paragraph("Aucun contrôle disponible pour cette chambre. Fiche à compléter.", y, 9, true) + 2;
    }
    y = paragraph(record ? "Les réponses décrivent la visite indiquée ci-dessus." : "Cocher une réponse par ligne. Laisser vide si le point n'a pas été vérifié.", y, 9) + 4;
    y = section("1. Équipements et sécurité", y, room);
    autoTable(doc, {
      startY: y, theme: "grid", tableWidth: width,
      margin: { top: 34, bottom: 18, left: margin, right: margin },
      head: [record ? ["Point de contrôle", "Résultat"] : ["Point de contrôle", "OK", "Problème", "Absent"]],
      body: roomChecks.map(check => {
        const answer = record?.checks.find(item => item.key === check.key)?.result;
        return record ? [check.label, answer ? resultLabels[answer] : "Non renseigné"] : [check.label, "", "", ""];
      }),
      styles: { font: "helvetica", fontSize: 10, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, minCellHeight: 6.7, textColor: 25, lineColor: 170, lineWidth: 0.15, valign: "middle" },
      headStyles: { fillColor: [238, 238, 238], textColor: 25, fontStyle: "bold" },
      columnStyles: record ? { 0: { cellWidth: 120 }, 1: { cellWidth: 62 } } : { 0: { cellWidth: 110 }, 1: { cellWidth: 20, halign: "center" }, 2: { cellWidth: 28, halign: "center" }, 3: { cellWidth: 24, halign: "center" } },
      rowPageBreak: "avoid",
      willDrawPage: () => ensureHeader(room),
      didDrawCell: cell => {
        if (!record && cell.section === "body" && cell.column.index > 0) checkbox(cell.cell.x + (cell.cell.width - 3.3) / 2, cell.cell.y + (cell.cell.height - 3.3) / 2);
      },
    });
    // autoTable adds this property to jsPDF after each table.
    const endY = () => (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    y = section("2. État de la chambre et propreté", endY() + 7, room);
    const answers = record ? conditionAnswers(record) : [];
    autoTable(doc, {
      startY: y, theme: "grid", tableWidth: width,
      margin: { top: 34, bottom: 18, left: margin, right: margin },
      body: conditionChoices.map(([label], i) => [label, record ? answers[i] : ""]),
      styles: { font: "helvetica", fontSize: 10, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, minCellHeight: 7, textColor: 25, lineColor: 170, lineWidth: 0.15, valign: "middle" },
      columnStyles: { 0: { cellWidth: 65 }, 1: { cellWidth: 117 } },
      rowPageBreak: "avoid",
      willDrawPage: () => ensureHeader(room),
      didDrawCell: cell => {
        if (record || cell.section !== "body" || cell.column.index !== 1) return;
        let x = cell.cell.x + 2;
        const baseline = cell.cell.y + cell.cell.height / 2 + 1.2;
        for (const choice of conditionChoices[cell.row.index][1]) {
          checkbox(x, baseline - 3);
          text(choice, x + 4.7, baseline, 9.5);
          x += doc.getTextWidth(choice) + 9;
        }
      },
    });
    y = section("3. Observations et problèmes constatés", endY() + 7, room) + 2;
    if (record) {
      const notes = [record.carpetNotes.trim() ? `Moquette : ${record.carpetNotes.trim()}` : "", record.notes.trim()].filter(Boolean).join("\n\n") || "Aucune observation saisie.";
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      const lines = doc.splitTextToSize(notes, width) as string[];
      for (const line of lines) {
        if (y > 276) { doc.addPage(); continuation(room); y = 38; }
        text(line, margin, y, 10); y += 4.5;
      }
      const photoCount = "photoIds" in record ? record.photoIds.length || (record.photoId ? 1 : 0) : record.photosData.length;
      if (photoCount) {
        if (y > 271) { doc.addPage(); continuation(room); y = 38; }
        text(`${photoCount} photo(s) associée(s), consultable(s) dans l'application.`, margin, y + 3, 9);
      }
    } else {
      doc.setDrawColor(175); doc.setLineWidth(0.2);
      for (let line = 0; line < 3; line++) {
        if (y + 5 > 276) { doc.addPage(); continuation(room); y = 38; }
        doc.line(margin, y + 5, margin + width, y + 5); y += 8;
      }
    }
  });

  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page);
    doc.setDrawColor(170); doc.setLineWidth(0.2); doc.line(margin, 284, margin + width, 284);
    text(`${pageRooms.get(page) ? `Chambre ${pageRooms.get(page)} - ` : ""}Édition du ${displayDate(date)}`, margin, 290, 8);
    doc.setFontSize(8); doc.text(`Page ${page} / ${count}`, margin + width, 290, { align: "right" });
  }
  return doc;
}

export function downloadRoomChecklist(options: Options) {
  const doc = buildRoomChecklist(options);
  doc.save(options.mode === "blank" ? "checklist-vierge.pdf" : `checklist-chambres-${options.date || today()}.pdf`);
}
