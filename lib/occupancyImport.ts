import { z } from "zod";
import { rooms, roomSchema } from "./rooms";

const rowSchema = z.object({
  room: roomSchema, status: z.enum(["occupied", "available", "works"]),
  guestName: z.string().trim().min(1).max(200).optional(), stayUntil: z.iso.date().optional(),
  expectedPreviousEventId: z.string().uuid().nullable(),
});

export const occupancyImportSchema = z.object({
  id: z.string().uuid(), date: z.iso.date(), actor: z.string().trim().min(1).max(200),
  rows: z.array(rowSchema).min(1).max(rooms.length),
}).superRefine(({ rows, date }, ctx) => {
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    let message: string | undefined;
    if (seen.has(row.room)) message = "La chambre apparaît plusieurs fois dans la fiche.";
    else if (row.status === "occupied" && (!row.guestName || !row.stayUntil || row.stayUntil < date))
      message = "Vérifiez le nom et la fin de séjour de la chambre occupée.";
    else if (row.status !== "occupied" && (row.guestName || row.stayUntil))
      message = "Une chambre libre ou en travaux ne peut pas contenir de séjour.";
    if (message) ctx.addIssue({ code: "custom", path: ["rows", i], message: `Chambre ${row.room} · ${message}` });
    seen.add(row.room);
  }
});

export type OccupancyImport = z.infer<typeof occupancyImportSchema>;
export type OccupancyImportRow = OccupancyImport["rows"][number];
