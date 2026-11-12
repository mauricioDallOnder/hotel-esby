import { z } from "zod";
import type { Issue } from "./domain";
import { getLaundryMachine } from "./work";
import { getProblemPreset } from "./problemPresets";

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
  { key: "door_closer", label: "Ferme-porte (fermeture automatique)" },
  { key: "door_handle_clear", label: "Poignée de porte dégagée (aucun vêtement ne cache la poignée)" },
  { key: "radiator_clear", label: "Chauffage / radiateur" },
] as const;
export type RoomCheckKey = typeof roomChecks[number]["key"];
// Other answers remain in the inspection history without creating an automatic anomaly.
const roomAnomalyCheckKeys: readonly RoomCheckKey[] = ["taps", "switches", "leaks", "lights", "smoke", "damage", "window", "radiator_clear"];
export const conditionLabels = { bon: "Bon état", a_revoir: "À revoir", mauvais: "Mauvais état" } as const;
export const cleaningLabels = { faite: "Faite", non_faite: "Non faite" } as const;
export const resultLabels = { non_verifie: "Non vérifié", ok: "Oui / OK", probleme: "Problème", absent: "Absent" } as const;
export function roomCheckResultLabel(key: RoomCheckKey, result: keyof typeof resultLabels): string {
  if (key === "radiator_clear" && result === "ok") return "Libre";
  if (key === "radiator_clear" && result === "probleme") return "Caché";
  return resultLabels[result];
}
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

// Preserve the check sets of queued controls: adding a new required check must
// never alter the payload or hash of an earlier schema on retry.
const roomChecksV4 = roomChecks.filter(c => c.key !== "radiator_clear");
const previousRoomChecks = roomChecksV4.filter(c => c.key !== "door_closer");

const roomEntryV2Schema = roomFields.extend({
  occupied: z.boolean(), schemaVersion: z.literal(2).default(2),
}).superRefine((v, ctx) => {
  validateNotes(v, ctx);
  if (v.checks.length !== previousRoomChecks.length || new Set(v.checks.map(c => c.key)).size !== previousRoomChecks.length)
    ctx.addIssue({ code: "custom", path: ["checks"], message: "Vérifiez chaque point une seule fois." });
  previousRoomChecks.forEach(check => {
    if (!v.checks.some(c => c.key === check.key && c.result !== "non_verifie"))
      ctx.addIssue({ code: "custom", path: ["checks", check.key], message: "Ce point est obligatoire." });
  });
  if (v.microwave === "non_verifie") ctx.addIssue({ code: "custom", path: ["microwave"], message: "Vérifiez la présence du micro-ondes." });
}).transform(v => v.occupied ? v : { ...v, cleaning: null });

export const applianceCleaningLabels = { propre: "Propre", sale: "Sale", non_verifie: "Non vérifié" } as const;
const applianceCleaning = z.enum(["propre", "sale", "non_verifie"]).nullable();

const roomEntryV3Schema = roomFields.extend({
  occupied: z.boolean(), schemaVersion: z.literal(3).default(3),
  microwaveCleaning: applianceCleaning,
  fridgeCleaning: applianceCleaning,
}).superRefine((v, ctx) => {
  validateNotes(v, ctx);
  if (v.checks.length !== previousRoomChecks.length || new Set(v.checks.map(c => c.key)).size !== previousRoomChecks.length)
    ctx.addIssue({ code: "custom", path: ["checks"], message: "Vérifiez chaque point une seule fois." });
  previousRoomChecks.forEach(check => {
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

// Keep field order stable because the parsed payload is the offline receipt hash.
function quickChoiceRoomSchema<V extends 4 | 5>(version: V, requiredChecks: readonly { key: RoomCheckKey }[]) {
  return roomFields.extend({
  occupied: z.boolean(), schemaVersion: z.literal(version).default(version),
  microwaveCleaning: applianceCleaning, fridgeCleaning: applianceCleaning,
  inspectedAt: z.iso.datetime().optional(),
  distinctProblemKeys: z.array(z.string().min(1).max(80)).max(30).optional(),
  issueLinks: z.array(z.object({ key: z.string().min(1).max(80), issueId: z.string().uuid() })).max(30).optional(),
  // Legacy preview payloads must keep their original hash when an offline save is retried.
  temperatureC: z.number().finite().min(-20).max(60).optional(),
  problemDetails: z.array(z.object({
    key: z.enum(roomChecks.map(c => c.key)),
    problemType: z.string().refine(value => !!getProblemPreset(value), "Choisissez un type de problème connu."),
    description: z.string().trim().max(1000).optional(),
  })).max(roomAnomalyCheckKeys.length).optional(),
}).superRefine((v, ctx) => {
  if (v.checks.length !== requiredChecks.length || new Set(v.checks.map(c => c.key)).size !== requiredChecks.length)
    ctx.addIssue({ code: "custom", path: ["checks"], message: "Vérifiez chaque point une seule fois." });
  requiredChecks.forEach(check => {
    if (!v.checks.some(c => c.key === check.key && c.result !== "non_verifie"))
      ctx.addIssue({ code: "custom", path: ["checks", check.key], message: "Ce point reste à vérifier." });
  });
  if (version === 5 && v.checks.some(c => c.key === "radiator_clear" && c.result === "absent"))
    ctx.addIssue({ code: "custom", path: ["checks", "radiator_clear"], message: "Indiquez si le chauffage / radiateur est libre ou caché." });
  if (v.microwave === "non_verifie") ctx.addIssue({ code: "custom", path: ["microwave"], message: "Vérifiez la présence du micro-ondes." });
  if (!v.occupied && !v.cleaning) ctx.addIssue({ code: "custom", path: ["cleaning"], message: "Renseignez le ménage." });
  if (!v.bugs || v.bugs === "non_verifie") ctx.addIssue({ code: "custom", path: ["bugs"], message: "Vérifiez les nuisibles." });
  for (const [present, field] of [[v.microwave === "oui", "microwaveCleaning"], [v.checks.some(c => c.key === "fridge" && c.result !== "absent"), "fridgeCleaning"]] as const) {
    if (present && (!v[field] || v[field] === "non_verifie")) ctx.addIssue({ code: "custom", path: [field], message: "Vérifiez la propreté." });
  }
  const detailKeys = new Set<string>();
  for (const [index, detail] of (v.problemDetails || []).entries()) {
    const preset = getProblemPreset(detail.problemType);
    if (detailKeys.has(detail.key)) ctx.addIssue({ code: "custom", path: ["problemDetails", index, "key"], message: "Décrivez chaque équipement une seule fois." });
    detailKeys.add(detail.key);
    if (!v.checks.some(check => check.key === detail.key && check.result === "probleme") ||
      !preset || !(preset.checkKeys as readonly string[]).includes(detail.key))
      ctx.addIssue({ code: "custom", path: ["problemDetails", index, "problemType"], message: "Ce type de problème ne correspond pas à cet équipement signalé." });
    if (detail.problemType === "other" && !detail.description?.trim())
      ctx.addIssue({ code: "custom", path: ["problemDetails", index, "description"], message: "Décrivez cet autre problème." });
  }
  if (new Set((v.issueLinks || []).map(link => link.key)).size !== (v.issueLinks || []).length)
    ctx.addIssue({ code: "custom", path: ["issueLinks"], message: "Choisissez un seul problème existant par équipement." });
  // The new selector supplies the technical description. Legacy queued forms
  // retain their original validation and payload, including empty notes.
  if (v.problemDetails !== undefined && v.checks.some(check => check.key === "damage" && check.result === "probleme") &&
    !detailKeys.has("damage") && !v.issueLinks?.some(link => link.key === "damage") && !v.notes.trim())
    ctx.addIssue({ code: "custom", path: ["problemDetails"], message: "Choisissez ou décrivez ce qui est cassé, ou associez le problème déjà ouvert." });
}).transform(v => ({ ...v, cleaning: v.occupied ? null : v.cleaning,
  microwaveCleaning: v.microwave === "oui" ? v.microwaveCleaning : null,
  fridgeCleaning: v.checks.some(c => c.key === "fridge" && c.result === "absent") ? null : v.fridgeCleaning,
}));
}
const roomEntryV4Schema = quickChoiceRoomSchema(4, roomChecksV4);
export const roomEntrySchema = quickChoiceRoomSchema(5, roomChecks);

export const workEntrySchema = z.object({
  type: z.literal("createWorkEvent"), id: z.string().uuid(),
  kind: z.enum(["roomAvailability", "familyComment", "dailyTask", "cafardFollowup", "collectedItem", "laundryCycle"]),
  targetId: z.string().min(1).max(80), expectedRevision: z.number().int().min(0),
  room: z.union([roomSchema, z.literal("")]), date: z.iso.date(), actor: required,
  notes: note, occurredAt: z.iso.datetime(),
  free: z.boolean().optional(), done: z.boolean().optional(), deleted: z.boolean().optional(),
  familyEventId: z.string().uuid().optional(),
  cafardStatus: z.enum(["a_verifier", "signale", "traite", "resolu"]).optional(),
  detectedOn: z.iso.date().nullable().optional(), treatedOn: z.iso.date().nullable().optional(),
  resolvedOn: z.iso.date().nullable().optional(), product: z.string().trim().max(200).optional(),
  itemName: required.optional(), collectedOn: z.iso.date().optional(), collectedBy: required.optional(),
  returnedOn: z.iso.date().nullable().optional(), returnedBy: z.string().trim().max(200).optional(),
  roomUnidentified: z.literal(true).optional(),
  laundryCycleId: z.string().uuid().optional(),
  laundryStatus: z.enum(["en_cours", "recupere", "annule"]).optional(),
  laundryStartedAt: z.iso.datetime().optional(),
  laundryCollectedAt: z.iso.datetime().nullable().optional(),
  laundryCollectedBy: z.string().trim().max(200).optional(),
  laundryOwner: z.string().trim().max(200).optional(),
  laundryEndsAt: z.iso.datetime().optional(),
  laundryAddedMinutes: z.number().int().min(1).max(120).optional(),
  cafardObservationId: z.string().uuid().nullable().optional(),
  // Optional only for previously queued payloads: adding a default would change
  // their receipt hash. New edits capture the exact event they were based on.
  expectedPreviousEventId: z.string().uuid().nullable().optional(),
}).superRefine((v, ctx) => {
  const invalid = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  if (v.expectedPreviousEventId !== undefined &&
    (v.expectedRevision === 0 ? v.expectedPreviousEventId !== null : !v.expectedPreviousEventId || v.expectedPreviousEventId === v.id))
    invalid("expectedPreviousEventId", "Vérifiez la version du suivi avant de préparer cette modification.");
  if (v.kind === "roomAvailability") {
    if (!v.room || v.targetId !== v.room || typeof v.free !== "boolean") invalid("free", "Choisissez la disponibilité d’une chambre connue.");
  } else if (v.kind === "cafardFollowup") {
    if (!v.room || v.targetId !== v.room) invalid("room", "Choisissez la chambre concernée par ce suivi.");
    if (!v.cafardStatus) invalid("cafardStatus", "Choisissez l’état du suivi des cafards.");
    for (const field of ["detectedOn", "treatedOn", "resolvedOn"] as const) {
      if (v[field] === undefined) invalid(field, "Indiquez une date ou laissez-la explicitement inconnue.");
      if (v[field] && v[field] > v.date) invalid(field, "Cette date ne peut pas suivre la date de mise à jour.");
    }
    if (v.detectedOn && v.treatedOn && v.treatedOn < v.detectedOn) invalid("treatedOn", "L’application du produit ne peut pas précéder la détection.");
    if (v.resolvedOn && ((v.detectedOn && v.resolvedOn < v.detectedOn) || (v.treatedOn && v.resolvedOn < v.treatedOn)))
      invalid("resolvedOn", "La résolution doit suivre la détection et l’application du produit.");
    if (v.cafardStatus === "traite" && !v.treatedOn) invalid("treatedOn", "Renseignez la date d’application du produit.");
    if (v.cafardStatus === "resolu" && !v.resolvedOn) invalid("resolvedOn", "Renseignez la date de résolution.");
    if (v.cafardStatus !== "resolu" && v.resolvedOn) invalid("resolvedOn", "Un suivi en cours ne peut pas avoir de date de résolution.");
  } else if (v.kind === "collectedItem") {
    if (!z.string().uuid().safeParse(v.targetId).success) invalid("targetId", "Identifiant de l’objet invalide.");
    if (!v.room && v.roomUnidentified !== true) invalid("room", "Choisissez la chambre ou indiquez « Chambre non identifiée ».");
    if (v.room && v.roomUnidentified === true) invalid("roomUnidentified", "Une chambre connue ne peut pas être non identifiée.");
    if (!v.itemName) invalid("itemName", "Indiquez l’objet récupéré.");
    if (!v.collectedOn) invalid("collectedOn", "Indiquez la date de récupération.");
    if (!v.collectedBy) invalid("collectedBy", "Indiquez qui a récupéré l’objet.");
    if (v.collectedOn && v.collectedOn > v.date) invalid("collectedOn", "La récupération ne peut pas suivre la date de mise à jour.");
    if (v.returnedOn === undefined) invalid("returnedOn", "Indiquez une date de restitution ou laissez l’objet en armoire.");
    if (v.returnedOn && v.collectedOn && v.returnedOn < v.collectedOn) invalid("returnedOn", "La restitution ne peut pas précéder la récupération.");
    if (v.returnedOn && v.returnedOn > v.date) invalid("returnedOn", "La restitution ne peut pas suivre la date de mise à jour.");
    if (v.returnedOn && !v.returnedBy) invalid("returnedBy", "Indiquez qui a restitué l’objet.");
    if (!v.returnedOn && v.returnedBy) invalid("returnedBy", "Un objet en armoire ne peut pas avoir de responsable de restitution.");
    if (v.returnedBy === undefined) invalid("returnedBy", "Renseignez la restitution ou laissez ce champ vide.");
  } else if (v.kind === "laundryCycle") {
    const machine = getLaundryMachine(v.targetId);
    if (!machine) invalid("targetId", "Choisissez une machine de la lingerie.");
    if (!v.room) invalid("room", "Indiquez la chambre à laquelle appartient le linge.");
    if (!v.laundryCycleId) invalid("laundryCycleId", "Identifiant du cycle requis.");
    if (!v.laundryStatus) invalid("laundryStatus", "Choisissez l’état du cycle.");
    if (!v.laundryStartedAt) invalid("laundryStartedAt", "Date et heure de démarrage requises.");
    if (v.laundryStartedAt && Date.parse(v.occurredAt) < Date.parse(v.laundryStartedAt))
      invalid("occurredAt", "Cette action ne peut pas précéder le démarrage du cycle.");
    if (v.laundryEndsAt && v.laundryStartedAt && Date.parse(v.laundryEndsAt) <= Date.parse(v.laundryStartedAt))
      invalid("laundryEndsAt", "L’heure de fin prévue doit suivre le démarrage.");
    if (v.laundryAddedMinutes !== undefined) {
      if (v.laundryStatus !== "en_cours") invalid("laundryAddedMinutes", "Seul un cycle en cours peut être prolongé.");
      if (!v.laundryEndsAt || Date.parse(v.laundryEndsAt) <= Date.parse(v.occurredAt))
        invalid("laundryEndsAt", "Indiquez la nouvelle heure de fin après cette prolongation.");
    } else if (v.laundryStatus === "en_cours") {
      if (v.laundryStartedAt !== v.occurredAt)
        invalid("laundryStartedAt", "Le démarrage doit correspondre à l’heure de cette action.");
      if (v.laundryEndsAt && v.laundryStartedAt && machine && Date.parse(v.laundryEndsAt) !== Date.parse(v.laundryStartedAt) + machine.durationMinutes * 60_000)
        invalid("laundryEndsAt", "Le nouveau cycle doit utiliser la durée prévue pour cette machine.");
    }
    if (v.laundryCollectedAt === undefined) invalid("laundryCollectedAt", "Indiquez la récupération ou laissez la date explicitement inconnue.");
    if (v.laundryCollectedBy === undefined) invalid("laundryCollectedBy", "Renseignez la récupération ou laissez ce champ vide.");
    if (v.laundryStatus === "recupere") {
      if (!v.laundryCollectedAt || v.laundryCollectedAt !== v.occurredAt)
        invalid("laundryCollectedAt", "La date et l’heure de récupération doivent correspondre à cette action.");
      if (!v.laundryCollectedBy || v.laundryCollectedBy !== v.actor)
        invalid("laundryCollectedBy", "Indiquez la personne qui confirme la récupération.");
    } else if (v.laundryCollectedAt !== null || v.laundryCollectedBy !== "") {
      invalid("laundryCollectedAt", "Le linge non récupéré ne peut pas avoir de récupération enregistrée.");
    }
  } else {
    if (!z.string().uuid().safeParse(v.targetId).success) invalid("targetId", "Identifiant invalide.");
    if (!v.notes.trim()) invalid("notes", "Saisissez un texte.");
  }
  if (v.kind === "familyComment" && (!v.familyEventId || !v.room)) invalid("familyEventId", "Événement familial requis.");
  if (v.kind === "dailyTask" && (typeof v.done !== "boolean" || typeof v.deleted !== "boolean" || v.notes.length > 500)) invalid("notes", "Tâche invalide (500 caractères maximum).");
  if (v.kind !== "dailyTask" && (v.done !== undefined || v.deleted !== undefined)) invalid("kind", "État de tâche inattendu.");
  if (v.kind !== "familyComment" && v.familyEventId !== undefined) invalid("familyEventId", "Lien familial inattendu.");
  if (v.kind !== "roomAvailability" && v.free !== undefined) invalid("free", "Disponibilité inattendue.");
  if (v.kind !== "cafardFollowup" && [v.cafardStatus, v.detectedOn, v.treatedOn, v.resolvedOn, v.product, v.cafardObservationId].some(value => value !== undefined))
    invalid("kind", "Données de suivi des cafards inattendues.");
  if (v.kind !== "collectedItem" && [v.itemName, v.collectedOn, v.collectedBy, v.returnedOn, v.returnedBy, v.roomUnidentified].some(value => value !== undefined))
    invalid("kind", "Données d’objet récupéré inattendues.");
  if (v.kind !== "laundryCycle" && [v.laundryCycleId, v.laundryStatus, v.laundryStartedAt, v.laundryCollectedAt, v.laundryCollectedBy, v.laundryOwner, v.laundryEndsAt, v.laundryAddedMinutes].some(value => value !== undefined))
    invalid("kind", "Données de lingerie inattendues.");
  if (v.kind === "dailyTask" && v.room) invalid("room", "Une tâche n’est pas un contrôle de chambre.");
});
export type WorkEntry = z.infer<typeof workEntrySchema>;
export type WorkEvent = WorkEntry & { version: number; updatedAt: string; submissionHash: string };

export const entrySchema = z.union([familyEntrySchema, roomEntrySchema, workEntrySchema]);
export type FamilyEntry = z.infer<typeof familyEntrySchema>;
export type RoomEntry = z.infer<typeof roomFields> & { occupied?: boolean | null; schemaVersion?: 2 | 3 | 4 | 5; inspectedAt?: string; issueLinks?: { key: string; issueId: string }[]; problemDetails?: { key: RoomCheckKey; problemType: string; description?: string }[]; distinctProblemKeys?: string[]; microwaveCleaning?: z.infer<typeof applianceCleaning>; fridgeCleaning?: z.infer<typeof applianceCleaning>; bugs?: "non" | "oui" | "non_verifie"; temperatureC?: number };
export type Entry = FamilyEntry | RoomEntry | WorkEntry;

const legacyRoom = z.string().refine(v => (rooms.includes(v) && v !== "233") || ["111", "112", "113", "213", "313"].includes(v));
const legacyKeys = previousRoomChecks.filter(c => c.key !== "door_handle_clear").map(c => c.key);
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
  if (input && typeof input === "object" && "type" in input && input.type === "createWorkEvent") return workEntrySchema.parse(input);
  if (input && typeof input === "object" && "schemaVersion" in input && input.schemaVersion === 2) return roomEntryV2Schema.parse(input);
  if (input && typeof input === "object" && "schemaVersion" in input && input.schemaVersion === 3) return roomEntryV3Schema.parse(input);
  if (input && typeof input === "object" && "schemaVersion" in input && input.schemaVersion === 4) return roomEntryV4Schema.parse(input);
  if (!legacy) return entrySchema.parse(input);
  if (input && typeof input === "object" && ("schemaVersion" in input || "occupied" in input)) return entrySchema.parse(input);
  return z.discriminatedUnion("type", [legacyFamilySchema, legacyRoomSchema]).parse(input);
}

export function normalizeRoomDraft<T extends { occupied?: boolean | null; checks: RoomEntry["checks"]; schemaVersion?: 2 | 3 | 4 | 5; inspectedAt?: string; issueLinks?: { key: string; issueId: string }[]; problemDetails?: RoomEntry["problemDetails"]; distinctProblemKeys?: string[]; bugs?: "non" | "oui" | "non_verifie" }>(draft: T): T {
  return { microwaveCleaning: "non_verifie", fridgeCleaning: "non_verifie", bugs: "non_verifie", ...draft, schemaVersion: 5, occupied: draft.occupied ?? null, checks: [...draft.checks,
    ...roomChecks.filter(check => !draft.checks.some(c => c.key === check.key)).map(check => ({ key: check.key, result: "non_verifie" as const }))] };
}

export function countRoomsOnDate(history: { room: string; date: string }[], date: string) {
  return new Set(history.filter(r => r.date === date && rooms.includes(r.room)).map(r => r.room)).size;
}

export function cleaningText(record: Pick<RoomEntry, "occupied" | "cleaning">) {
  return record.occupied === true ? "Non applicable" : record.cleaning ? cleaningLabels[record.cleaning] : "Non renseigné";
}

export function roomProblems(record: RoomEntry | RoomInspection): string[] {
  const technical = roomFindings(record);
  return [
    ...(record.condition !== "bon" ? [conditionLabels[record.condition]] : []),
    ...(record.bugs === "oui" ? ["Cafards / nuisibles détectés"] : []),
    ...(record.occupied === false && record.cleaning === "non_faite" ? ["Ménage non fait"] : []),
    ...record.checks.filter(c => c.result === "probleme" || (["smoke", "door_closer"].includes(c.key) && c.result === "absent")).map(c => technical.find(finding => finding.key === c.key)?.label || `${roomChecks.find(check => check.key === c.key)?.label} : ${roomCheckResultLabel(c.key, c.result)}`),
    ...(record.carpet !== "ok" ? [`Moquette ${carpetLabels[record.carpet].toLowerCase()} : ${record.carpetNotes}`] : []),
    ...(record.microwave === "oui" && record.microwaveCleaning === "sale" ? ["Micro-ondes sale"] : []),
    ...(record.checks.some(c => c.key === "fridge" && c.result !== "absent") && record.fridgeCleaning === "sale" ? ["Minibar sale"] : []),
  ];
}

export function roomIssue(record: RoomInspection): Issue | undefined {
  const findings = roomFindings(record);
  if (!findings.length) return;
  return { room: record.room, roomFindings: findings, id: record.id, version: 1, date: record.date, createdAt: record.updatedAt, updatedAt: record.updatedAt,
    title: `Chambre ${record.room} · Problème constaté`, location: `Chambre ${record.room}`, category: "Équipements", priority: "normale", status: "ouvert", assignee: record.actor,
    description: [...findings.map(finding => finding.label), record.notes].filter(Boolean).join("\n").slice(0, 4000), reportedBy: record.actor,
    photoIds: record.photoIds, photoId: record.photoId,
    history: [{ at: record.updatedAt, actor: record.actor, note: "Signalé depuis le checklist de la chambre.", status: "ouvert", priority: "normale", assignee: record.actor }],
  };
}

export function latestRoomRecords(history: (RoomEntry | RoomInspection)[]) {
  const latest = new Map<string, RoomEntry | RoomInspection>();
  [...history].sort((a, b) => b.date.localeCompare(a.date) || roomRecordTime(b).localeCompare(roomRecordTime(a))).forEach(record => {
    if (rooms.includes(record.room) && !latest.has(record.room)) latest.set(record.room, record);
  });
  return latest;
}

export const absenceDeleteSchema = z.object({ collection: z.literal("familyEvents"), id: z.string().uuid() }).strict();
type Saved = { version: number; updatedAt: string; submissionHash: string };
export type FamilyEvent = FamilyEntry & Saved;
export type RoomInspection = Omit<RoomEntry, "photosData"> & Saved & { photoIds: string[]; photoId: string | null; relatedIssueIds?: string[]; issueSyncVersion?: 2; createdIssue?: boolean; newIssueFindingKeys?: string[] };
export type EntryChange = { collection: "workEvents"; record: WorkEvent } | { collection: "familyEvents"; record: FamilyEvent } | { collection: "roomInspections"; record: RoomInspection; issue?: Issue };
export function roomRecordTime(record: RoomEntry | RoomInspection) {
  return record.inspectedAt || ("updatedAt" in record ? record.updatedAt : "z");
}

export function roomFindings(record: RoomEntry | RoomInspection): NonNullable<Issue["roomFindings"]> {
  const findings = record.checks.filter(c => roomAnomalyCheckKeys.includes(c.key) && c.result === "probleme")
    .map(c => {
      const detail = record.problemDetails?.find(item => item.key === c.key);
      const preset = getProblemPreset(detail?.problemType);
      if (detail && preset) return { key: c.key, problemType: detail.problemType,
        ...(detail.description ? { description: detail.description } : {}),
        label: [preset.label, detail.description].filter(Boolean).join(" : ") };
      return { key: c.key, label: `${roomChecks.find(check => check.key === c.key)?.label || c.key} : ${roomCheckResultLabel(c.key, c.result)}`,
        ...(c.key === "damage" && record.notes.trim() ? { description: record.notes } : {}) };
    });
  return findings;
}
