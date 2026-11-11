import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { displayDate, issuePhotoIds, today } from "./domain";
import { applianceCleaningLabels, cleaningText, conditionLabels, latestRoomRecords, rooms, roomProblems, type WorkEntry, type RoomEntry, type RoomInspection } from "./rooms";
import { loadPhotoData, photoSource } from "./photos";

import { roomAvailability } from "./work";

type Options = { hotelName: string; history: (RoomEntry | RoomInspection)[]; workEvents?: WorkEntry[] };

export function freeRoomRecords(history: Options["history"], workEvents: WorkEntry[] = []) {
  return [...latestRoomRecords(history).values()]
    .filter(record => roomAvailability(record.room, workEvents, record).free === true)
    .sort((a, b) => a.room.localeCompare(b.room, "fr", { numeric: true }));
}

export function freeRoomRows(history: Options["history"], workEvents: WorkEntry[] = []) {
  const latest = latestRoomRecords(history);
  return rooms.filter(room => roomAvailability(room, workEvents, latest.get(room)).free === true).map(room => {
      const record = latest.get(room);
      const source = roomAvailability(room, workEvents, record).source;
      const availabilityNote = source ? `Disponibilité indiquée le ${displayDate(source.date)} · ${source.actor}${"updatedAt" in source ? "" : " · En attente d’envoi"}` : "";
      if (!record) return [room, "Aucun contrôle", "Non renseigné", "Non renseigné", "Non vérifié", "Non vérifié", availabilityNote, ""];

      const fridge = record.checks.find(check => check.key === "fridge")?.result;
      const cleanliness = (value: RoomEntry["microwaveCleaning"]) => value ? applianceCleaningLabels[value] : "Non renseignée";
      
      return [
        record.room,
        `${displayDate(record.date)}\n${record.actor}${"updatedAt" in record ? "" : "\nEn attente d’envoi"}`,
        conditionLabels[record.condition],
        cleaningText(record),
        record.microwave === "oui" ? `Présent\n${cleanliness(record.microwaveCleaning)}` : record.microwave === "non" ? "Absent" : "Non vérifié",
        fridge === "absent" ? "Absent" : fridge === "ok" || fridge === "probleme" ? `Présent${fridge === "probleme" ? " · Problème" : ""}\n${cleanliness(record.fridgeCleaning)}` : "Non vérifié",
        [...roomProblems(record), record.notes, availabilityNote].filter(Boolean).join("\n") || "Aucun problème signalé",
        "" // Colonne vide réservée pour dessiner l'image
      ];
  });
}

async function loadFirstPhoto(record: RoomEntry | RoomInspection): Promise<string | null> {
  if ("photosData" in record && record.photosData && record.photosData.length > 0) {
     return record.photosData[0];
  }
  if ("photoIds" in record && issuePhotoIds(record).length)
    return loadPhotoData(photoSource(record.id, 0, "roomInspections"));
  return null;
}

export async function buildFreeRoomsReport({ hotelName, history, workEvents = [] }: Options) {
  const records = freeRoomRecords(history, workEvents);
  const rows = freeRoomRows(history, workEvents);
  const photoMap = new Map<string, string>();
  const missingPhotos = new Set<string>();

  const withPhotos = records.filter(record => "photosData" in record ? record.photosData.length > 0 : issuePhotoIds(record).length > 0);
  // Match the API's bounded photo concurrency, instead of waiting room by room.
  for (let start = 0; start < withPhotos.length; start += 3) {
    await Promise.all(withPhotos.slice(start, start + 3).map(async record => {
      const photo = await loadFirstPhoto(record);
      if (photo) photoMap.set(record.room, photo);
      else missingPhotos.add(record.room);
    }));
  }

  const doc = new jsPDF({ orientation: "landscape", compress: true });
  doc.setFontSize(18);
  doc.text("Chambres libres · État actuel", 14, 18);
  doc.setFontSize(10);
  doc.text(`${hotelName} · Export du ${displayDate(today())} · ${rows.length} chambre(s) libre(s)`, 14, 26);
  doc.setFontSize(9);
  doc.text("Disponibilité actuelle ; état et équipements selon le dernier contrôle. Vérifiez les dates avant attribution.", 14, 33);
  
  autoTable(doc, {
    startY: 39,
    head: [["Chambre", "Dernier contrôle", "État général", "Ménage", "Micro-ondes", "Minibar", "Problèmes et observations", "Photo"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [21, 63, 55] },
    columnStyles: { 
        0: { cellWidth: 16 }, 
        1: { cellWidth: 28 }, 
        2: { cellWidth: 22 }, 
        3: { cellWidth: 20 }, 
        4: { cellWidth: 26 }, 
        5: { cellWidth: 26 },
        6: { cellWidth: 90 },
        7: { cellWidth: 41 } // Colonne pour la photo
    },
    margin: { top: 14, right: 14, bottom: 18, left: 14 },
    
    didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 7) {
            const roomNumber = (data.row.raw as string[])[0];
            if (photoMap.has(roomNumber) || missingPhotos.has(roomNumber)) {
                data.cell.styles.minCellHeight = 30; // Espace de 3 cm de hauteur pour la photo
            }
        }
    },
    
    didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 7) {
            const roomNumber = (data.row.raw as string[])[0];
            const photoData = photoMap.get(roomNumber);
            if (photoData) {
              try {
                const props = doc.getImageProperties(photoData);
                if (!Number.isFinite(props.width) || !Number.isFinite(props.height) || props.width <= 0 || props.height <= 0) throw new Error("Photo invalide.");
                const padding = 2;
                const cellW = data.cell.width - (padding * 2);
                const cellH = data.cell.height - (padding * 2);
                
                let imgW = cellW;
                let imgH = (imgW * props.height) / props.width;
                
                if (imgH > cellH) {
                    imgH = cellH;
                    imgW = (imgH * props.width) / props.height;
                }
                
                const x = data.cell.x + padding + (cellW - imgW) / 2;
                const y = data.cell.y + padding + (cellH - imgH) / 2;
                
                doc.addImage(photoData, x, y, imgW, imgH);
              } catch { missingPhotos.add(roomNumber); }
            }
            if (missingPhotos.has(roomNumber)) {
              doc.setFont("helvetica", "italic");
              doc.setFontSize(8);
              doc.setTextColor(100);
              doc.text("Photo indisponible", data.cell.x + 2, data.cell.y + 6);
            }
        }
    }
  });
  
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8);
    doc.text(`Hôtel Contrôle · Document interne · ${page} / ${pages}`, 14, doc.internal.pageSize.getHeight() - 8);
  }
  return doc;
}

export async function downloadFreeRoomsReport(options: Options) {
  const doc = await buildFreeRoomsReport(options);
  doc.save(`chambres-libres-${today()}.pdf`);
}
