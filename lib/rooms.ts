import { z } from "zod";

export const roomGroups = [
  { label: "1er étage · 112–126", start: 112, end: 126 },
  { label: "1er étage · 101–111", start: 101, end: 111 },
  { label: "2e étage · 217–232", start: 217, end: 232 },
  { label: "2e étage · 201–216", start: 201, end: 216 },
  { label: "3e étage · 316–332", start: 316, end: 332 },
  { label: "3e étage · 302–315", start: 302, end: 315 },
] as const;
export const rooms = roomGroups.flatMap(({ start, end }) =>
  Array.from({ length: end - start + 1 }, (_, i) => String(start + i)));
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
export const roomEntrySchema = z.object({
  type: z.literal("createRoomInspection"), ...base,
  condition: z.enum(["bon", "a_revoir", "mauvais"]),
  cleaning: z.enum(["faite", "non_faite"]),
  checks: z.array(z.object({ key: z.enum(roomChecks.map(c => c.key)), result: z.enum(["non_verifie", "ok", "probleme", "absent"]) })).length(roomChecks.length),
  carpet: z.enum(["ok", "tachee", "sale"]),
  carpetNotes: note,
  microwave: z.enum(["oui", "non", "non_verifie"]),
  photosData: z.array(z.string().max(500_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)).max(3),
}).superRefine((v, ctx) => {
  if (new Set(v.checks.map(c => c.key)).size !== roomChecks.length) ctx.addIssue({ code: "custom", path: ["checks"], message: "Vérifiez chaque point une seule fois." });
  if (v.carpet !== "ok" && !v.carpetNotes) ctx.addIssue({ code: "custom", path: ["carpetNotes"], message: "Précisez les taches ou salissures de la moquette." });
  if ((v.checks.some(c => c.result === "probleme") || v.condition !== "bon") && !v.notes) ctx.addIssue({ code: "custom", path: ["notes"], message: "Décrivez les problèmes constatés." });
});
export const entrySchema = z.discriminatedUnion("type", [familyEntrySchema, roomEntrySchema]);
export type FamilyEntry = z.infer<typeof familyEntrySchema>;
export type RoomEntry = z.infer<typeof roomEntrySchema>;
export type Entry = z.infer<typeof entrySchema>;
type Saved = { version: number; updatedAt: string; submissionHash: string };
export type FamilyEvent = FamilyEntry & Saved;
export type RoomInspection = Omit<RoomEntry, "photosData"> & Saved & { photoIds: string[]; photoId: string | null };
export type EntryChange = { collection: "familyEvents"; record: FamilyEvent } | { collection: "roomInspections"; record: RoomInspection };
