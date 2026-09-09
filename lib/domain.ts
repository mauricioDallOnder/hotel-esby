import { z } from "zod";
import type { Role } from "./roles";

export const MAX_ISSUE_PHOTOS = 3;

export const priorities = {
  critique: "Critique",
  haute: "Haute",
  normale: "Normale",
} as const;

export const statuses = {
  ouvert: "À traiter",
  en_cours: "En cours",
  resolu: "Résolu",
} as const;

export const categories = [
  "Plomberie",
  "Sécurité incendie",
  "Électricité",
  "Équipements",
  "Bâtiment",
  "Autre",
] as const;

export const checklist = [
  {
    id: "sorties",
    label: "Issues de secours dégagées et accessibles",
    critical: true,
  },
  {
    id: "signalisation",
    label: "Signalisation des sorties et éclairage de secours",
    critical: true,
  },
  {
    id: "incendie",
    label: "Extincteurs accessibles et portes coupe-feu dégagées",
    critical: true,
  },
  {
    id: "electricite",
    label: "Absence de câbles exposés ou de prises endommagées",
    critical: true,
  },
  {
    id: "fuites",
    label: "Absence de fuites d’eau et de sols glissants",
    critical: true,
  },
  {
    id: "sanitaires",
    label: "Lavabos, robinets et sanitaires en bon état",
    critical: false,
  },
  {
    id: "circulation",
    label: "Couloirs, escaliers et accès dégagés",
    critical: true,
  },
  {
    id: "equipements",
    label: "Éclairage et équipements des espaces communs",
    critical: false,
  },
] as const;

export const checkLabels = {
  non_verifie: "À vérifier",
  conforme: "Conforme",
  anomalie: "Anomalie",
  non_applicable: "Non applicable",
} as const;

const id = z.string().uuid();

export const dateSchema = z.iso.date();

const text = z
  .string()
  .trim()
  .min(1, "Ce champ est obligatoire.")
  .max(200);

const note = z.string().trim().max(4000);

export const photoSchema = z
  .string()
  .max(2_800_000)
  .regex(
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/,
    "Photo JPEG invalide."
  );

const priority = z.enum(["critique", "haute", "normale"]);

const status = z.enum(["ouvert", "en_cours", "resolu"]);

const fields = z.object({
  title: text,
  location: text,
  category: z.enum(categories),
  priority,
  description: note.min(1),
  assignee: z.string().trim().max(200),
});

export const checkSchema = z.object({
  key: z.enum(checklist.map((c) => c.id)),
  result: z.enum([
    "non_verifie",
    "conforme",
    "anomalie",
    "non_applicable",
  ]),
  issueId: id.nullable(),
  note: z.string().trim().max(1000),
});

export const inspectionInput = z.object({
  id,
  version: z.number().int().nonnegative(),
  date: dateSchema,
  inspector: text,
  area: text,
  notes: note,
  checks: z.array(checkSchema).length(checklist.length),
  completed: z.boolean(),
});

export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createIssue"),
    id,
    date: dateSchema,
    actor: text,
    fields,
    photoData: photoSchema.optional(),
    photosData: z.array(photoSchema).max(MAX_ISSUE_PHOTOS).optional(),
  }),

  z.object({
    type: z.literal("updateIssue"),
    id,
    version: z.number().int().positive(),
    actor: text,
    note: note.min(1, "Décrivez l’intervention ou la modification."),
    status,
    fields,
  }),

  z.object({
    type: z.literal("saveInspection"),
    inspection: inspectionInput,
  }),
]);

export type Priority = z.infer<typeof priority>;

export type Status = z.infer<typeof status>;

export type IssueFields = z.infer<typeof fields>;

export type Event = {
  at: string;
  actor: string;
  note: string;
  status: Status;
  priority: Priority;
  assignee: string;
};

export type Issue = IssueFields & {
  id: string;
  version: number;
  date: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  reportedBy: string;
  photoId: string | null;
  photoIds?: string[];
  history: Event[];
};

export type Inspection = z.infer<typeof inspectionInput> & {
  updatedAt: string;
  completedAt: string | null;
};

export type State = {
  issues: Issue[];
  inspections: Inspection[];
};

export type Command = z.infer<typeof commandSchema>;

export type Change =
  | {
      collection: "issues";
      record: Issue;
      expectedVersion: number;
      photoData?: string;
      photosData?: string[];
    }
  | {
      collection: "inspections";
      record: Inspection;
      expectedVersion: number;
    };

export class DomainError extends Error {
  code: number;

  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

/**
 * Gera um UUID v4 válido tanto no servidor quanto no navegador.
 *
 * Em contextos seguros (HTTPS ou localhost), usa crypto.randomUUID().
 *
 * Quando o aplicativo é acessado por um IP local via HTTP
 * (por exemplo http://10.x.x.x:3000), randomUUID() pode não estar
 * disponível no navegador. Nesse caso geramos manualmente um UUID v4.
 */
export function createId(): string {
  const cryptoApi =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  // Método nativo quando disponível.
  if (
    cryptoApi &&
    typeof cryptoApi.randomUUID === "function"
  ) {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);

  // getRandomValues normalmente continua disponível mesmo quando
  // randomUUID não está disponível.
  if (
    cryptoApi &&
    typeof cryptoApi.getRandomValues === "function"
  ) {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Último fallback para ambientes muito antigos.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 / UUID v4:
  // versão = 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;

  // variante = 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0")
  );

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function displayDate(date: string): string {
  return date
    ? date.slice(0, 10).split("-").reverse().join("/")
    : "—";
}

export function emptyInspection(
  date = today()
): Inspection {
  return {
    id: createId(),
    version: 0,
    date,
    inspector: "",
    area: "",
    notes: "",
    checks: checklist.map((c) => ({
      key: c.id,
      result: "non_verifie",
      issueId: null,
      note: "",
    })),
    completed: false,
    completedAt: null,
    updatedAt: "",
  };
}

export function applyCommand(
  state: State,
  input: Command,
  now = new Date().toISOString()
): Change {
  const command = commandSchema.parse(input);

  if (command.type === "createIssue") {
    const photosData = [...(command.photoData ? [command.photoData] : []), ...(command.photosData || [])];
    if (photosData.length > MAX_ISSUE_PHOTOS)
      throw new DomainError(`Ajoutez au maximum ${MAX_ISSUE_PHOTOS} photos.`);
    const existing = state.issues.find(
      (i) => i.id === command.id
    );

    if (existing) {
      throw new DomainError(
        "Cette anomalie existe déjà. Actualisez la liste.",
        409
      );
    }

    if (command.date > today(new Date(now))) {
      throw new DomainError(
        "La date ne peut pas être dans le futur."
      );
    }

    const record: Issue = {
      ...command.fields,
      id: command.id,
      date: command.date,
      reportedBy: command.actor,
      version: 1,
      createdAt: now,
      updatedAt: now,
      status: "ouvert",
      photoId: null,
      photoIds: [],
      history: [
        {
          at: now,
          actor: command.actor,
          note: "Anomalie signalée.",
          status: "ouvert",
          priority: command.fields.priority,
          assignee: command.fields.assignee,
        },
      ],
    };

    return {
      collection: "issues",
      record,
      expectedVersion: 0,
      photosData,
    };
  }

  if (command.type === "updateIssue") {
    const current = state.issues.find(
      (i) => i.id === command.id
    );

    if (!current) {
      throw new DomainError(
        "Anomalie introuvable.",
        404
      );
    }

    if (current.version !== command.version) {
      throw new DomainError(
        "Cette anomalie a été modifiée. Actualisez avant de réessayer.",
        409
      );
    }

    if (current.history.length >= 100) {
      throw new DomainError(
        "Limite de 100 interventions atteinte pour cette anomalie."
      );
    }

    return {
      collection: "issues",
      expectedVersion: command.version,
      record: {
        ...current,
        ...command.fields,
        status: command.status,
        version: current.version + 1,
        updatedAt: now,
        history: [
          ...current.history,
          {
            at: now,
            actor: command.actor,
            note: command.note,
            status: command.status,
            priority: command.fields.priority,
            assignee: command.fields.assignee,
          },
        ],
      },
    };
  }

  const inspection = command.inspection;

  const current = state.inspections.find(
    (i) => i.id === inspection.id
  );

  if (
    (current?.version ?? 0) !== inspection.version
  ) {
    throw new DomainError(
      "Cette ronde a été modifiée. Actualisez avant de réessayer.",
      409
    );
  }

  if (current?.completed) {
    throw new DomainError(
      "Une ronde terminée ne peut plus être modifiée."
    );
  }

  if (inspection.date > today(new Date(now))) {
    throw new DomainError(
      "La date ne peut pas être dans le futur."
    );
  }

  if (
    new Set(
      inspection.checks.map((c) => c.key)
    ).size !== checklist.length
  ) {
    throw new DomainError(
      "La checklist doit contenir chaque point une seule fois."
    );
  }

  for (const check of inspection.checks) {
    if (
      inspection.completed &&
      check.result === "non_verifie"
    ) {
      throw new DomainError(
        "Vérifiez tous les points avant de terminer la ronde."
      );
    }

    if (check.result === "anomalie") {
      const issue = state.issues.find(
        (i) => i.id === check.issueId
      );

      if (
        !issue ||
        issue.date > inspection.date
      ) {
        throw new DomainError(
          "Associez chaque anomalie à un signalement existant à la date de la ronde."
        );
      }
    } else if (check.issueId) {
      throw new DomainError(
        "Seul un point en anomalie peut être associé à un signalement."
      );
    }
  }

  return {
    collection: "inspections",
    expectedVersion: inspection.version,
    record: {
      ...inspection,
      version: inspection.version + 1,
      updatedAt: now,
      completedAt: inspection.completed
        ? now
        : null,
    },
  };
}

export function authorizeCommand(role: Role, command: Command) {
  if (role !== "direction" && command.type === "updateIssue") {
    throw new DomainError("Seule la direction peut modifier une anomalie ou son état.", 403);
  }
}

export function issuePhotoIds(issue: Pick<Issue, "photoId" | "photoIds">): string[] {
  return issue.photoIds?.length ? issue.photoIds : issue.photoId ? [issue.photoId] : [];
}

// Status at a calendar boundary is derived from history,
// never from today's status.
export function eventAt(
  issue: Issue,
  end: string
): Event | undefined {
  return issue.history
    .filter(
      (e) => today(new Date(e.at)) <= end
    )
    .at(-1);
}

export function monthlySummary(
  state: State,
  month: string
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new DomainError(
      "Mois invalide."
    );
  }

  const [year, m] = month
    .split("-")
    .map(Number);

  const start = month + "-01";

  const end =
    `${month}-${new Date(
      Date.UTC(year, m, 0)
    ).getUTCDate()}`;

  const previous = today(
    new Date(
      Date.UTC(year, m - 1, 0, 12)
    )
  );

  const newIssues = state.issues.filter(
    (i) =>
      i.date >= start &&
      i.date <= end
  );

  const pendingStart = state.issues.filter(
    (i) =>
      i.date < start &&
      (
        eventAt(i, previous)?.status ??
        "ouvert"
      ) !== "resolu"
  );

  const pendingEnd = state.issues.filter(
    (i) =>
      i.date <= end &&
      (
        eventAt(i, end)?.status ??
        "ouvert"
      ) !== "resolu"
  );

  const interventions = state.issues.flatMap(
    (issue) =>
      issue.history
        .slice(1)
        .filter((e) =>
          today(
            new Date(e.at)
          ).startsWith(month)
        )
        .map((event) => ({
          issue,
          event,
        }))
  );

  const resolvedIds = new Set(
    interventions
      .filter(
        (e) =>
          e.event.status === "resolu" &&
          e.issue.history[
            e.issue.history.indexOf(
              e.event
            ) - 1
          ]?.status !== "resolu"
      )
      .map((e) => e.issue.id)
  );

  const relevantIds = new Set(
    [
      ...newIssues,
      ...pendingStart,
      ...pendingEnd,
    ]
      .map((i) => i.id)
      .concat(
        interventions.map(
          (e) => e.issue.id
        )
      )
  );

  return {
    start,
    end,
    newIssues,
    pendingStart,
    pendingEnd,
    interventions,
    resolvedCount: resolvedIds.size,
    issues: state.issues.filter(
      (i) => relevantIds.has(i.id)
    ),
    inspections:
      state.inspections.filter((i) =>
        i.date.startsWith(month)
      ),
  };
}
