import { z } from "zod";
import type { Issue } from "./domain";

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
  bugs: z.enum(["non", "oui", "non_verifie"]).optional(),
});

function validateNotes(v: z.infer<typeof roomFields>, ctx: z.RefinementCtx) {
  if (v.carpet !== "ok" && !v.carpetNotes) ctx.addIssue({ code: "custom", path: ["carpetNotes"], message: "Précisez les taches ou salissures de la moquette." });
  if ((v.checks.some(c => c.result === "probleme") || v.condition !== "bon" || v.bugs === "oui") && !v.notes) ctx.addIssue({ code: "custom", path: ["notes"], message: "Décrivez les problèmes constatés." });
}

const roomEntryV2Schema = roomFields.extend({
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

export const applianceCleaningLabels = { propre: "Propre", sale: "Sale", non_verifie: "Non vérifié" } as const;
const applianceCleaning = z.enum(["propre", "sale", "non_verifie"]).nullable();

export const roomEntrySchema = roomFields.extend({
  occupied: z.boolean(), schemaVersion: z.literal(3).default(3),
  microwaveCleaning: applianceCleaning,
  fridgeCleaning: applianceCleaning,
}).superRefine((v, ctx) => {
  validateNotes(v, ctx);
  if (v.checks.length !== roomChecks.length || new Set(v.checks.map(c => c.key)).size !== roomChecks.length)
    ctx.addIssue({ code: "custom", path: ["checks"], message: "Vérifiez chaque point une seule fois." });
  roomChecks.forEach(check => {
    if (!v.checks.some(c => c.key === check.key && c.result !== "non_verifie"))
      ctx.addIssue({ code: "custom", path: ["checks", check.key], message: "Ce point est obligatoire." });
  });
  if (v.microwave === "non_verifie") ctx.addIssue({ code: "custom", path: ["microwave"], message: "Vérifiez la présence du micro-ondes." });
  if (!v.occupied && !v.cleaning) ctx.addIssue({ code: "custom", path: ["cleaning"], message: "Renseignez le ménage de la chambre libre." });
  if (!v.bugs || v.bugs === "non_verifie") ctx.addIssue({ code: "custom", path: ["bugs"], message: "Indiquez si des cafards ont été détectés." });
  for (const [present, field] of [[v.microwave === "oui", "microwaveCleaning"], [v.checks.some(c => c.key === "fridge" && c.result !== "absent"), "fridgeCleaning"]] as const) {
    if (present && (!v[field] || v[field] === "non_verifie")) ctx.addIssue({ code: "custom", path: [field], message: "Vérifiez la propreté de cet équipement." });
  }
}).transform(v => ({ ...v, cleaning: v.occupied ? null : v.cleaning,
  microwaveCleaning: v.microwave === "oui" ? v.microwaveCleaning : null,
  fridgeCleaning: v.checks.some(c => c.key === "fridge" && c.result === "absent") ? null : v.fridgeCleaning,
}));

export const entrySchema = z.union([familyEntrySchema, roomEntrySchema]);
export type FamilyEntry = z.infer<typeof familyEntrySchema>;
export type RoomEntry = z.infer<typeof roomFields> & { occupied?: boolean | null; schemaVersion?: 2 | 3; microwaveCleaning?: z.infer<typeof applianceCleaning>; fridgeCleaning?: z.infer<typeof applianceCleaning>; bugs?: "non" | "oui" | "non_verifie" };
export type Entry = FamilyEntry | RoomEntry;

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
  if (input && typeof input === "object" && "schemaVersion" in input && input.schemaVersion === 2) return roomEntryV2Schema.parse(input);
  if (!legacy) return entrySchema.parse(input);
  if (input && typeof input === "object" && ("schemaVersion" in input || "occupied" in input)) return entrySchema.parse(input);
  return z.discriminatedUnion("type", [legacyFamilySchema, legacyRoomSchema]).parse(input);
}

export function normalizeRoomDraft<T extends { occupied?: boolean | null; checks: RoomEntry["checks"]; schemaVersion?: 2 | 3; bugs?: "non" | "oui" | "non_verifie" }>(draft: T): T {
  return { microwaveCleaning: "non_verifie", fridgeCleaning: "non_verifie", bugs: "non_verifie", ...draft, schemaVersion: 3, occupied: draft.occupied ?? null, checks: [...draft.checks,
    ...roomChecks.filter(check => !draft.checks.some(c => c.key === check.key)).map(check => ({ key: check.key, result: "non_verifie" as const }))] };
}

export function countRoomsOnDate(history: { room: string; date: string }[], date: string) {
  return new Set(history.filter(r => r.date === date && rooms.includes(r.room)).map(r => r.room)).size;
}

export function cleaningText(record: Pick<RoomEntry, "occupied" | "cleaning">) {
  return record.occupied === true ? "Non applicable" : record.cleaning ? cleaningLabels[record.cleaning] : "Non renseigné";
}

export function roomProblems(record: RoomEntry | RoomInspection): string[] {
  return [
    ...(record.condition !== "bon" ? [conditionLabels[record.condition]] : []),
    ...(record.bugs === "oui" ? ["Cafards / nuisibles détectés"] : []),
    ...record.checks.filter(c => c.result === "probleme" || (c.key === "smoke" && c.result === "absent")).map(c => `${roomChecks.find(check => check.key === c.key)?.label} : ${resultLabels[c.result]}`),
    ...(record.carpet !== "ok" ? [`Moquette ${carpetLabels[record.carpet].toLowerCase()} : ${record.carpetNotes}`] : []),
    ...(record.microwave === "oui" && record.microwaveCleaning === "sale" ? ["Micro-ondes sale"] : []),
    ...(record.checks.some(c => c.key === "fridge" && c.result !== "absent") && record.fridgeCleaning === "sale" ? ["Minibar sale"] : []),
  ];
}

export function roomIssue(record: RoomInspection, hasPhotos = false): Issue | undefined {
  const problems = roomProblems(record);
  if (!problems.length && !record.notes.trim() && !record.photoIds.length && !hasPhotos) return;
  return { id: record.id, version: 1, date: record.date, createdAt: record.updatedAt, updatedAt: record.updatedAt,
    title: `Chambre ${record.room} · Problème constaté`, location: `Chambre ${record.room}`, category: "Équipements", priority: "normale", status: "ouvert", assignee: "",
    description: [...problems, record.notes].filter(Boolean).join("\n") || "Problème photographié lors du contrôle de la chambre.", reportedBy: record.actor,
    photoIds: record.photoIds, photoId: record.photoId,
    history: [{ at: record.updatedAt, actor: record.actor, note: "Signalé depuis le checklist de la chambre.", status: "ouvert", priority: "normale", assignee: "" }],
  };
}

export function latestRoomRecords(history: (RoomEntry | RoomInspection)[]) {
  const latest = new Map<string, RoomEntry | RoomInspection>();
  [...history].sort((a, b) => b.date.localeCompare(a.date) || ("updatedAt" in b ? b.updatedAt : "z").localeCompare("updatedAt" in a ? a.updatedAt : "z")).forEach(record => {
    if (rooms.includes(record.room) && !latest.has(record.room)) latest.set(record.room, record);
  });
  return latest;
}

export const absenceDeleteSchema = z.object({ collection: z.literal("familyEvents"), id: z.string().uuid() }).strict();
type Saved = { version: number; updatedAt: string; submissionHash: string };
export type FamilyEvent = FamilyEntry & Saved;
export type RoomInspection = Omit<RoomEntry, "photosData"> & Saved & { photoIds: string[]; photoId: string | null };
export type EntryChange = { collection: "familyEvents"; record: FamilyEvent } | { collection: "roomInspections"; record: RoomInspection; issue?: Issue };