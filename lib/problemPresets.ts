import type { RoomCheckKey } from "./rooms";

// Ordered from the recurring problems in the hotel's records. Counts are not
// stored here: older reports can describe several faults in the same entry.
type Preset = {
  id: string;
  label: string;
  category: "Plomberie" | "Sécurité incendie" | "Électricité" | "Équipements" | "Bâtiment" | "Autre";
  checkKeys: readonly RoomCheckKey[];
};

export const problemPresets = [
  { id: "electrical_socket", label: "Prise électrique cassée ou mal fixée", category: "Électricité", checkKeys: ["damage"] },
  { id: "heater_fault", label: "Chauffage / radiateur en panne", category: "Équipements", checkKeys: ["damage"] },
  { id: "water_leak", label: "Fuite d’eau", category: "Plomberie", checkKeys: ["leaks"] },
  { id: "toilet_seat", label: "Abattant WC cassé ou mal fixé", category: "Plomberie", checkKeys: ["damage"] },
  { id: "toilet_flush", label: "Chasse d’eau / bouton défectueux", category: "Plomberie", checkKeys: ["damage"] },
  { id: "electrical_switch", label: "Interrupteur défectueux", category: "Électricité", checkKeys: ["switches"] },
  { id: "tap_fault", label: "Robinet / mitigeur défectueux", category: "Plomberie", checkKeys: ["taps"] },
  { id: "window_fault", label: "Fenêtre qui ferme mal ou défectueuse", category: "Bâtiment", checkKeys: ["window"] },
  { id: "lighting_fault", label: "Éclairage / ampoule défectueux", category: "Électricité", checkKeys: ["lights"] },
  { id: "heater_loose", label: "Radiateur détaché ou mal fixé", category: "Équipements", checkKeys: ["damage"] },
  { id: "radiator_obstructed", label: "Radiateur caché ou encombré", category: "Équipements", checkKeys: ["radiator_clear"] },
  { id: "room_cluttered", label: "Chambre encombrée d’affaires", category: "Autre", checkKeys: ["room_clutter"] },
  { id: "drain_blocked", label: "Douche / évacuation bouchée", category: "Plomberie", checkKeys: ["damage", "taps"] },
  { id: "door_damage", label: "Porte endommagée", category: "Bâtiment", checkKeys: ["damage"] },
  { id: "smoke_detector", label: "Détecteur de fumée défectueux", category: "Sécurité incendie", checkKeys: ["smoke"] },
  // A minibar answer remains in the inspection; it never creates an automatic issue.
  { id: "fridge_fault", label: "Réfrigérateur en panne", category: "Équipements", checkKeys: [] },
  { id: "other", label: "Autre problème", category: "Autre", checkKeys: ["taps", "switches", "leaks", "lights", "smoke", "damage", "window", "radiator_clear", "room_clutter"] },
] as const satisfies readonly Preset[];

export type ProblemType = typeof problemPresets[number]["id"];
export type ProblemPreset = typeof problemPresets[number];

export function getProblemPreset(id?: string): ProblemPreset | undefined {
  return problemPresets.find(preset => preset.id === id);
}

export function problemPresetsForCheck(key: string): ProblemPreset[] {
  return problemPresets.filter(preset => (preset.checkKeys as readonly string[]).includes(key));
}
