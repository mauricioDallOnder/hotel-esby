import type { PendingEntry } from "./entryQueue";

type SyncState = {
  ready: boolean;
  online: boolean;
  working: boolean;
  pending: Pick<PendingEntry, "blocked" | "error">[];
  storageError: string;
  saving: boolean;
  saveError: string;
  stale: boolean;
  refreshing: boolean;
};

type SyncSummary = {
  label: string;
  color: "default" | "success" | "info" | "warning" | "error";
  detail: string;
};

// A browser reporting a network connection is not proof that a save was accepted.
// Only an empty, loaded queue can be presented as up to date.
export function syncSummary(state: SyncState): SyncSummary {
  const count = state.pending.length;
  const blocked = state.pending.filter(item => item.blocked).length;
  if (state.storageError) return {
    label: "Enregistrement sur l’appareil indisponible",
    color: "error",
    detail: "Vérifiez le message ci-dessous avant de poursuivre.",
  };
  if (!state.ready) return {
    label: "Vérification des enregistrements…",
    color: "default",
    detail: "Lecture des modifications conservées sur cet appareil.",
  };
  if (blocked) return {
    label: `${blocked} envoi${blocked > 1 ? "s" : ""} à vérifier`,
    color: "error",
    detail: `${!state.online ? "Hors connexion. " : ""}Certaines modifications n’ont pas été acceptées. Consultez les détails ci-dessous.`,
  };
  if (state.saveError) return {
    label: "Enregistrement non confirmé",
    color: "error",
    detail: `${!state.online ? "Hors connexion. " : ""}Vérifiez le message ci-dessous. Les autres données restent disponibles.`,
  };
  if (!state.online) return {
    label: `Hors connexion${count ? ` · ${count} en attente` : ""}`,
    color: "warning",
    detail: count
      ? "Les enregistrements déjà en attente restent conservés sur cet appareil. L’envoi reprendra au retour de la connexion."
      : "Aucun envoi en attente. La connexion est nécessaire pour actualiser les données et confirmer les enregistrements.",
  };
  if (state.saving) return {
    label: "Enregistrement…",
    color: "info",
    detail: "La modification est en cours. Attendez la confirmation avant de fermer le formulaire.",
  };
  if (count) return {
    label: state.working ? `Envoi en cours · ${count}` : `${count} en attente d’envoi`,
    color: state.pending.some(item => item.error) ? "warning" : "info",
    detail: "Modifications conservées sur cet appareil, en attente de confirmation. Ne supprimez pas les données du navigateur.",
  };
  if (state.refreshing) return {
    label: "Actualisation…",
    color: "info",
    detail: "Vérification des dernières données de l’hôtel.",
  };
  if (state.stale) return {
    label: "Données à actualiser",
    color: "warning",
    detail: "Aucun envoi en attente, mais les données affichées doivent être vérifiées.",
  };
  return {
    label: "Enregistrements à jour",
    color: "success",
    detail: "Aucun envoi en attente sur cet appareil.",
  };
}
