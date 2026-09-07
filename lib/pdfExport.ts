import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  checklist,
  checkLabels,
  displayDate,
  eventAt,
  monthlySummary,
  priorities,
  statuses,
  today,
  type Issue,
  type State,
} from "./domain";

export function dailyIssues(state: State, date: string): Issue[] {
  const linked = new Set(
    state.inspections
      .filter((i) => i.date === date)
      .flatMap((i) => i.checks.map((c) => c.issueId))
  );
  return state.issues.filter(
    (i) =>
      i.date <= date &&
      (i.date === date ||
        (eventAt(i, date)?.status ?? "ouvert") !== "resolu" ||
        linked.has(i.id) ||
        i.history.some((e) => today(new Date(e.at)) === date))
  );
}
type ReportOptions = {
  kind: "daily" | "monthly";
  period: string;
  hotelName: string;
  state: State;
};
// Exported separately from download to allow automated validation of PDFs.
export async function buildReport(
  { kind, period, hotelName, state }: ReportOptions,
  photoLoader = loadPhoto
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const monthly = kind === "monthly" ? monthlySummary(state, period) : null;
  const end = monthly?.end || period;
  const issues = monthly?.issues || dailyIssues(state, period);
  const rounds =
    monthly?.inspections || state.inspections.filter((i) => i.date === period);
  let y = 0;
  function header() {
    doc.setFillColor(23, 62, 54);
    doc.rect(0, 0, 210, 27, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Hôtel Contrôle", 14, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      kind === "daily"
        ? `Rapport quotidien · ${displayDate(period)}`
        : `Bilan mensuel · ${period.split("-").reverse().join("/")}`,
      14,
      20
    );
    doc.setTextColor(35, 50, 45);
    y = 37;
  }
  function page() {
    doc.addPage();
    header();
  }
  function write(value: string, size = 10, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    // Helvetica covers French/Portuguese accents; normalize punctuation unsupported by WinAnsi.
    const lines: string[] = doc.splitTextToSize(
      value.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-"),
      182
    );
    for (const line of lines) {
      if (y > 274) page();
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.text(line, 14, y);
      y += size * 0.46;
    }
    y += 3;
  }
  function table(head: string[], body: string[][]) {
    if (y > 250) page();
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: 14, right: 14, top: 36, bottom: 18 },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2.5,
        overflow: "linebreak",
      },
      headStyles: { fillColor: [36, 91, 79] },
      alternateRowStyles: { fillColor: [245, 247, 242] },
      didDrawPage: () => {
        doc.setFillColor(23, 62, 54);
        doc.rect(0, 0, 210, 27, "F");
        doc.setFontSize(12);
        doc.setTextColor(255);
        doc.text(
          "Hôtel Contrôle · " +
            (kind === "daily" ? displayDate(period) : period),
          14,
          16
        );
        doc.setTextColor(35, 50, 45);
      },
    });
    y =
      (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 9;
  }
  header();
  write(hotelName, 18, true);
  write(
    `Édité le ${new Date().toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
    })} · Heure de Paris`,
    9
  );
  if (end >= today())
    write(
      "Période en cours : situation à l'heure de génération du rapport.",
      9
    );
  const unfinished = rounds.filter((r) => !r.completed).length;
  write(
    `${
      rounds.filter((r) => r.completed).length
    } ronde(s) terminée(s) · ${unfinished} brouillon(s)`,
    11,
    true
  );
  if (unfinished)
    write(
      "Les rondes en brouillon ne constituent pas des vérifications terminées."
    );
  if (monthly) {
    table(
      ["Indicateur", "Total"],
      [
        [
          "Anomalies reportées du mois précédent",
          String(monthly.pendingStart.length),
        ],
        ["Nouvelles anomalies", String(monthly.newIssues.length)],
        [
          "Anomalies ayant été résolues dans le mois",
          String(monthly.resolvedCount),
        ],
        [
          "Interventions / modifications consignées",
          String(monthly.interventions.length),
        ],
        [
          "Anomalies restant ouvertes en fin de période",
          String(monthly.pendingEnd.length),
        ],
      ]
    );
    write(
      "Une anomalie résolue puis rouverte reste dans les anomalies ouvertes. Les résolutions incluent les problèmes signalés les mois précédents.",
      9
    );
  } else {
    write(
      `${
        state.issues.filter((i) => i.date === period).length
      } nouvelle(s) anomalie(s) · ${
        issues.filter((i) => (eventAt(i, end)?.status ?? "ouvert") !== "resolu")
          .length
      } non résolue(s) à cette date`
    );
    write(
      "Ce rapport inclut les problèmes du jour, les anomalies associées aux rondes, les interventions du jour et les anciennes anomalies encore ouvertes.",
      9
    );
  }
  write("Rondes de la période", 13, true);
  if (!rounds.length) write("Aucune ronde enregistrée pour cette période.");
  else
    table(
      ["Date", "Zone", "Inspecteur", "État"],
      rounds.map((r) => [
        displayDate(r.date),
        r.area,
        r.inspector,
        r.completed ? "Terminée" : "Brouillon",
      ])
    );
  if (kind === "daily")
    for (const round of rounds) {
      page();
      write(`Checklist · ${round.area}`, 15, true);
      write(
        `${round.inspector} · ${round.completed ? "Terminée" : "BROUILLON"}`
      );
      table(
        ["Point contrôlé", "Constat", "Observation / anomalie"],
        round.checks.map((c) => [
          checklist.find((t) => t.id === c.key)?.label || c.key,
          checkLabels[c.result],
          [
            c.note,
            c.issueId
              ? state.issues.find((i) => i.id === c.issueId)?.title || c.issueId
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ])
      );
      if (round.notes) write(`Notes : ${round.notes}`);
    }
  if (monthly) {
    page();
    write("Travaux et interventions du mois", 15, true);
    if (!monthly.interventions.length)
      write("Aucune intervention consignée pour ce mois.");
    else
      table(
        [
          "Date / auteur",
          "Anomalie / lieu",
          "Travail effectué",
          "État après intervention",
        ],
        monthly.interventions.map(({ issue, event }) => [
          `${displayDate(today(new Date(event.at)))}\n${event.actor}`,
          `${issue.title}\n${issue.location}`,
          event.note,
          statuses[event.status],
        ])
      );
  }
  if (!issues.length) write("Aucune anomalie à présenter pour cette période.");
  for (const [index, issue] of issues.entries()) {
    page();
    const stateAtDate = eventAt(issue, end);
    write(`Anomalie ${index + 1} / ${issues.length}`, 10);
    write(issue.title, 16, true);
    write(`${issue.location} · ${issue.category}`);
    write(
      `Priorité : ${
        priorities[stateAtDate?.priority ?? issue.history[0].priority]
      } · État à la fin de période : ${
        statuses[stateAtDate?.status ?? "ouvert"]
      }`,
      10,
      true
    );
    write(
      `Constat : ${displayDate(issue.date)} · Signalé par : ${issue.reportedBy}`
    );
    write(`Responsable : ${stateAtDate?.assignee || "Non attribué"}`);
    if (issue.photoId) {
      const data = await photoLoader(issue);
      const props = doc.getImageProperties(data);
      const width = Math.min(170, (85 * props.width) / props.height);
      const height = (width * props.height) / props.width;
      if (y + height > 272) page();
      doc.addImage(data, "JPEG", 14, y, width, height);
      y += height + 7;
    } else write("Aucune photo jointe.", 9);
    write("Description du problème", 11, true);
    write(issue.description);
    const history = issue.history.filter((e) => today(new Date(e.at)) <= end);
    if (history.length) {
      write("Historique jusqu’à la fin de période", 11, true);
      table(
        ["Date / auteur", "Intervention", "État"],
        history.map((e) => [
          `${displayDate(today(new Date(e.at)))}\n${e.actor}`,
          e.note,
          statuses[e.status],
        ])
      );
    }
    write(`Référence : ${issue.id}`, 8);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115);
    doc.text("Hôtel Contrôle · Document interne", 14, 289);
    doc.text(`${i} / ${pages}`, 196, 289, { align: "right" });
  }
  return doc;
}
async function loadPhoto(issue: Issue): Promise<string> {
  const response = await fetch(`/api/photos/${issue.id}`, {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `Photo inaccessible pour « ${issue.title} ». Actualisez et réessayez.`
    );
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
    reader.readAsDataURL(blob);
  });
}
export async function downloadReport(options: ReportOptions) {
  const doc = await buildReport(options);
  doc.save(
    `${options.kind === "daily" ? "rapport-quotidien" : "bilan-mensuel"}-${
      options.period
    }.pdf`
  );
}
