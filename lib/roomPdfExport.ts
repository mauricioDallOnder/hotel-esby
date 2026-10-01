import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { displayDate, today } from "./domain";
import { applianceCleaningLabels, cleaningText, conditionLabels, latestRoomRecords, roomProblems, type RoomEntry, type RoomInspection } from "./rooms";

type Options = { hotelName: string; history: (RoomEntry | RoomInspection)[] };

export function freeRoomRows(history: Options["history"]) {
  return [...latestRoomRecords(history).values()]
    .filter(record => record.occupied === false)
    .sort((a, b) => a.room.localeCompare(b.room, "fr", { numeric: true }))
    .map(record => {
      const fridge = record.checks.find(check => check.key === "fridge")?.result;
      const cleanliness = (value: RoomEntry["microwaveCleaning"]) => value ? applianceCleaningLabels[value] : "Non renseignée";
      return [record.room,
        `${displayDate(record.date)}\n${record.actor}${"updatedAt" in record ? "" : "\nEn attente d’envoi"}`,
        conditionLabels[record.condition], cleaningText(record),
        record.microwave === "oui" ? `Présent\n${cleanliness(record.microwaveCleaning)}` : record.microwave === "non" ? "Absent" : "Non vérifié",
        fridge === "absent" ? "Absent" : fridge === "ok" || fridge === "probleme" ? `Présent${fridge === "probleme" ? " · Problème" : ""}\n${cleanliness(record.fridgeCleaning)}` : "Non vérifié",
        [...roomProblems(record), record.notes].filter(Boolean).join("\n") || "Aucun problème signalé",
      ];
    });
}

export function buildFreeRoomsReport({ hotelName, history }: Options) {
  const rows = freeRoomRows(history);
  const doc = new jsPDF({ orientation: "landscape", compress: true });
  doc.setFontSize(18);
  doc.text("Chambres libres · État actuel", 14, 18);
  doc.setFontSize(10);
  doc.text(`${hotelName} · Export du ${displayDate(today())} · ${rows.length} chambre(s) libre(s)`, 14, 26);
  doc.setFontSize(9);
  doc.text("Selon le dernier checklist de chaque chambre. Consultez la date du contrôle avant attribution.", 14, 33);
  autoTable(doc, {
    startY: 39,
    head: [["Chambre", "Dernier contrôle", "État général", "Ménage", "Micro-ondes", "Minibar / frigobar", "Problèmes et observations"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [21, 63, 55] },
    columnStyles: { 0: { cellWidth: 19 }, 1: { cellWidth: 36 }, 2: { cellWidth: 25 }, 3: { cellWidth: 24 }, 4: { cellWidth: 32 }, 5: { cellWidth: 34 } },
    margin: { top: 14, right: 14, bottom: 18, left: 14 },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8);
    doc.text(`Hôtel Contrôle · Document interne · ${page} / ${pages}`, 14, doc.internal.pageSize.getHeight() - 8);
  }
  return doc;
}

export function downloadFreeRoomsReport(options: Options) {
  buildFreeRoomsReport(options).save(`chambres-libres-${today()}.pdf`);
}
