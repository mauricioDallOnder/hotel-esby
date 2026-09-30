import { z } from "zod";

export const roomGroups = [
  { label: "1er étage", rooms: ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "114", "115", "116", "117", "118", "119", "120", "121", "122", "123", "124", "125", "126"] },
  { label: "2e étage", rooms: ["201", "202", "203", "204", "205", "206", "207", "208", "209", "210", "211", "212", "214", "215", "216", "217", "218", "219", "220", "221", "222", "223", "224", "225", "226", "227", "228", "229", "230", "231", "232", "233"] },
  { label: "3e étage", rooms: ["302", "303", "304", "305", "306", "307", "308", "309", "310", "311", "312", "314", "315", "316", "317", "318", "319", "320", "321", "322", "323", "324", "325", "326", "327", "328", "329", "330", "331", "332"] },
] as const;
export const rooms: string[] = roomGroups.flatMap(group => [...group.rooms]);
export const roomSchema = z.string().refine(value => rooms.includes(value), "Chambre inconnue.");
export const roomChecks = [
  { key: "taps", label: "Robinets fonctionnels" },
  { key: "switches", label: "Interrupteurs fonctionnels" },
  { key: "leaks", label: "Aucune fuite d’eau" },
  { key: "lights", label: "Éclairage fonctionnel" },
  { key: "smoke", label: "Détecteur de fumée fonctionnel" },
  { key: "damage", label: "Rien de cassé" },
  { key: "window", label: "Fenêtre fonctionnelle" },
  { key: "bed", label: "Lit en bon état" },
  { key: "mattress", label: "Matelas en bon état" },
  { key: "fridge", label: "Minibar fonctionnel" },
  { key: "door_handle_clear", label: "Poignée de porte dégagée (aucun vêtement ne cache la poignée)" },
] as const;
export type RoomCheckKey = typeof roomChecks[number]["key"];
export const conditionLabels = { bon: "Bon état", a_revoir: "À revoir", mauvais: "Mauvais état" } as const;
export const cleaningLabels = { faite: "Faite", non_faite: "Non faite" } as const;
export const resultLabels = { non_verifie: "Non vérifié", ok: "Oui / OK", probleme: "Problème", absent: "Absent" } as const;
export const carpetLabels = { ok: "OK", tachee: "Tachée", sale: "Sale" } as const;
const note = z.string().trim().max(4000);
const required = z.string().trim().min(1, "Ce champ est obligatoire.").max(200);
const base = { id: z.string().uuid(), room: roomSchema, date: z.iso.date(), actor: required, notes: note };
export const familyEntrySchema = z.object({
  type: z.literal("createFamilyEvent"), ...base,
  family: required,
  kind: z.enum(["absence", "depart"]),
  returnDate: z.union([z.iso.date(), z.literal("")]),
}).superRefine((v, ctx) => {
  if (v.kind === "depart" && v.returnDate) ctx.addIssue({ code: "custom", path: ["returnDate"], message: "Un départ définitif n’a pas de date de retour." });
  if (v.returnDate && v.returnDate < v.date) ctx.addIssue({ code: "custom", path: ["returnDate"], message: "Le retour doit suivre le début de l’absence." });
});
const roomFields = z.object({
  type: z.literal("createRoomInspection"), ...base,
  condition: z.enum(["bon", "a_revoir", "mauvais"]),
  cleaning: z.enum(["faite", "non_faite"]).nullish(),
  checks: z.array(z.object({ key: z.enum(roomChecks.map(c => c.key)), result: z.enum(["non_verifie", "ok", "probleme", "absent"]) })),
  carpet: z.enum(["ok", "tachee", "sale"]),
  carpetNotes: note,
  microwave: z.enum(["oui", "non", "non_verifie"]),
  photosData: z.array(z.string().max(500_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)).max(3),
});
function validateNotes(v: z.infer<typeof roomFields>, ctx: z.RefinementCtx) {
  if (v.carpet !== "ok" && !v.carpetNotes) ctx.addIssue({ code: "custom", path: ["carpetNotes"], message: "Précisez les taches ou salissures de la moquette." });
  if ((v.checks.some(c => c.result === "probleme") || v.condition !== "bon") && !v.notes) ctx.addIssue({ code: "custom", path: ["notes"], message: "Décrivez les problèmes constatés." });
}
export const roomEntrySchema = roomFields.extend({
  occupied: z.boolean(), schemaVersion: z.literal(2).default(2),
}).superRefine((v, ctx) => {
  validateNotes(v, ctx);
  if (v.checks.length !== roomChecks.length || new Set(v.checks.map(c => c.key)).size !== roomChecks.length)
    ctx.addIssue({ code: "custom", path: ["checks"], message: "Vérifiez chaque point une seule fois." });
  roomChecks.forEach(check => {
    if (!v.checks.some(c => c.key === check.key && c.result !== "non_verifie"))
      ctx.addIssue({ code: "custom", path: ["checks", check.key], message: "Ce point est obligatoire." });
  });
  if (v.microwave === "non_verifie") ctx.addIssue({ code: "custom", path: ["microwave"], message: "Vérifiez la présence du micro-ondes." });
}).transform(v => v.occupied ? v : { ...v, cleaning: null });
export const entrySchema = z.union([familyEntrySchema, roomEntrySchema]);
export type FamilyEntry = z.infer<typeof familyEntrySchema>;
export type RoomEntry = z.infer<typeof roomFields> & { occupied?: boolean | null; schemaVersion?: 2 };
export type Entry = FamilyEntry | RoomEntry;

// Only transport of a previously queued v1 entry uses this schema. Preserve
// original field order and omit new fields to keep its submissionHash identical.
const legacyRoom = z.string().refine(v => (rooms.includes(v) && v !== "233") || ["111", "112", "113", "213", "313"].includes(v));
const legacyKeys = roomChecks.filter(c => c.key !== "door_handle_clear").map(c => c.key);
const legacyRoomSchema = roomFields.extend({
  room: legacyRoom,
  cleaning: z.enum(["faite", "non_faite"]),
  checks: z.array(z.object({ key: z.enum(legacyKeys), result: z.enum(["non_verifie", "ok", "probleme", "absent"]) })).length(legacyKeys.length),
}).superRefine((v, ctx) => {
  validateNotes(v, ctx);
  if (new Set(v.checks.map(c => c.key)).size !== legacyKeys.length) ctx.addIssue({ code: "custom", path: ["checks"], message: "Points dupliqués." });
});
const legacyFamilySchema = familyEntrySchema.safeExtend({ room: legacyRoom });
export function parseEntry(input: unknown, legacy = false): Entry {
  if (!legacy) return entrySchema.parse(input);
  // Never downgrade a v2 payload or silently discard its new answers.
  if (input && typeof input === "object" && ("schemaVersion" in input || "occupied" in input)) return entrySchema.parse(input);
  return z.discriminatedUnion("type", [legacyFamilySchema, legacyRoomSchema]).parse(input);
}

export function normalizeRoomDraft<T extends { occupied?: boolean | null; checks: RoomEntry["checks"] }>(draft: T): T {
  return { ...draft, occupied: draft.occupied ?? null, checks: [...draft.checks,
    ...roomChecks.filter(check => !draft.checks.some(c => c.key === check.key)).map(check => ({ key: check.key, result: "non_verifie" as const }))] };
}
export function countRoomsOnDate(history: { room: string; date: string }[], date: string) {
  return new Set(history.filter(r => r.date === date && rooms.includes(r.room)).map(r => r.room)).size;
}
export function cleaningText(record: Pick<RoomEntry, "occupied" | "cleaning">) {
  return record.occupied === false ? "Non applicable" : record.cleaning ? cleaningLabels[record.cleaning] : "Non renseigné";
}
export const absenceDeleteSchema = z.object({ collection: z.literal("familyEvents"), id: z.string().uuid() }).strict();
type Saved = { version: number; updatedAt: string; submissionHash: string };
export type FamilyEvent = FamilyEntry & Saved;
export type RoomInspection = Omit<RoomEntry, "photosData"> & Saved & { photoIds: string[]; photoId: string | null };
export type EntryChange = { collection: "familyEvents"; record: FamilyEvent } | { collection: "roomInspections"; record: RoomInspection };
