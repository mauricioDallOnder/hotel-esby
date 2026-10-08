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
      .filter((inspection) => inspection.date === date)
      .flatMap((inspection) => inspection.checks.map((check) => check.issueId))
  );

  return state.issues.filter(
    (issue) =>
      issue.date <= date &&
      (issue.date === date ||
        (eventAt(issue, date)?.status ?? "ouvert") !== "resolu" ||
        linked.has(issue.id) ||
        issue.history.some((event) => today(new Date(event.at)) === date))
  );
}

type ReportOptions = {
  kind: "daily" | "monthly";
  period: string;
  hotelName: string;
  state: State;
};

type PhotoLoader = (issue: Issue) => Promise<string>;

export async function buildReport(
  { kind, period, hotelName, state }: ReportOptions,
  photoLoader: PhotoLoader = loadPhoto
): Promise<jsPDF> {
  // =====================================================
  // CONFIGURAÇÃO A4 (PAGINAÇÃO AUTOMÁTICA)
  // =====================================================
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
    compress: true,
  });

  const PAGE_WIDTH = 210;
  const PAGE_HEIGHT = 297;
  const LEFT = 14;
  const RIGHT = 14;
  const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
  const BOTTOM_MARGIN = 20;
  
  let y = 0;

  // Função auxiliar que salta para a próxima página se não houver espaço
  function checkPage(neededSpace: number) {
    if (y + neededSpace > PAGE_HEIGHT - BOTTOM_MARGIN) {
      doc.addPage();
      y = 20; // Margem superior nas novas páginas
    }
  }

  const monthly = kind === "monthly" ? monthlySummary(state, period) : null;
  const end = monthly?.end || period;
  const issues = monthly?.issues || dailyIssues(state, period);
  const rounds = monthly?.inspections || state.inspections.filter((inspection) => inspection.date === period);
  const generatedAt = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

  const photoCache = new Map<string, string>();

  async function getPhoto(issue: Issue): Promise<string> {
    const cached = photoCache.get(issue.id);
    if (cached) return cached;
    const data = await photoLoader(issue);
    photoCache.set(issue.id, data);
    return data;
  }

  function normalizeText(value: string): string {
    return String(value ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, "-");
  }

  // =====================================================
  // RENDERIZAÇÃO
  // =====================================================

  function header() {
    doc.setFillColor(23, 62, 54);
    doc.rect(0, 0, PAGE_WIDTH, 27, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Hôtel Contrôle", LEFT, 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const subtitle =
      kind === "daily"
        ? `Rapport quotidien · ${displayDate(period)}`
        : `Bilan mensuel · ${period.split("-").reverse().join("/")}`;

    doc.text(normalizeText(subtitle), LEFT, 20);
    doc.setTextColor(35, 50, 45);
    y = 37;
  }

  function write(value: string, size = 10, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(35, 50, 45);

    const lines = doc.splitTextToSize(normalizeText(value), CONTENT_WIDTH) as string[];

    for (const line of lines) {
      checkPage(size * 0.46);
      doc.text(line, LEFT, y);
      y += size * 0.46;
    }
    y += 3;
  }

  function table(head: string[], body: string[][]) {
    if (!body.length) return;

    // autoTable lida com paginação sozinho!
    autoTable(doc, {
      startY: y,
      head: [head.map(normalizeText)],
      body: body.map((row) => row.map((value) => normalizeText(value ?? ""))),
      margin: { left: LEFT, right: RIGHT, top: 20, bottom: BOTTOM_MARGIN },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2.2,
        overflow: "linebreak",
        valign: "top",
        textColor: [35, 50, 45],
      },
      headStyles: { fillColor: [36, 91, 79], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 242] },
    });

    const result = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
    if (result) y = result.finalY + 7;
  }

  // =====================================================
  // INÍCIO DA CONSTRUÇÃO
  // =====================================================

  header();

  write(hotelName, 18, true);
  write(`Édité le ${generatedAt} · Heure de Paris`, 9);

  if (end >= today()) {
    write("Période en cours : situation à l'heure de génération du rapport.", 9);
  }

  const completedRounds = rounds.filter((round) => round.completed).length;
  const unfinished = rounds.filter((round) => !round.completed).length;

  write(`${completedRounds} ronde(s) terminée(s) · ${unfinished} brouillon(s)`, 11, true);

  if (unfinished) {
    write("Les rondes en brouillon ne constituent pas des vérifications terminées.", 9);
  }

  if (monthly) {
    table(
      ["Indicateur", "Total"],
      [
        ["Anomalies reportées du mois précédent", String(monthly.pendingStart.length)],
        ["Nouvelles anomalies", String(monthly.newIssues.length)],
        ["Anomalies ayant été résolues dans le mois", String(monthly.resolvedCount)],
        ["Interventions / modifications consignées", String(monthly.interventions.length)],
        ["Anomalies restant ouvertes en fin de période", String(monthly.pendingEnd.length)],
      ]
    );
    write("Une anomalie résolue puis rouverte reste dans les anomalies ouvertes. Les résolutions incluent les problèmes signalés les mois précédents.", 9);
  } else {
    const newIssues = state.issues.filter((issue) => issue.date === period).length;
    const unresolved = issues.filter((issue) => (eventAt(issue, end)?.status ?? "ouvert") !== "resolu").length;
    write(`${newIssues} nouvelle(s) anomalie(s) · ${unresolved} non résolue(s) à cette date`);
    write("Ce rapport inclut les problèmes du jour, les anomalies associées aux rondes, les interventions du jour et les anciennes anomalies encore ouvertes.", 9);
  }

  write("Rondes de la période", 13, true);

  if (!rounds.length) {
    write("Aucune ronde enregistrée pour cette période.");
  } else {
    table(
      ["Date", "Zone", "Inspecteur", "État"],
      rounds.map((round) => [
        displayDate(round.date),
        round.area,
        round.inspector,
        round.completed ? "Terminée" : "Brouillon",
      ])
    );
  }

  if (kind === "daily") {
    for (const round of rounds) {
      write(`Checklist · ${round.area}`, 15, true);
      write(`${round.inspector} · ${round.completed ? "Terminée" : "BROUILLON"}`);

      table(
        ["Point contrôlé", "Constat", "Observation / anomalie"],
        round.checks.map((check) => {
          const item = checklist.find((task) => task.id === check.key);
          const linkedIssue = check.issueId ? state.issues.find((issue) => issue.id === check.issueId) : undefined;
          return [
            item?.label || check.key,
            checkLabels[check.result],
            [check.note, linkedIssue?.title || (check.issueId ? check.issueId : "")].filter(Boolean).join(" · "),
          ];
        })
      );

      if (round.notes) write(`Notes : ${round.notes}`);
    }
  }

  if (monthly) {
    checkPage(20);
    write("Travaux et interventions du mois", 15, true);

    if (!monthly.interventions.length) {
      write("Aucune intervention consignée pour ce mois.");
    } else {
      table(
        ["Date / auteur", "Anomalie / lieu", "Travail effectué", "État après intervention"],
        monthly.interventions.map(({ issue, event }) => [
          `${displayDate(today(new Date(event.at)))}\n${event.actor}`,
          `${issue.title}\n${issue.location}`,
          event.note,
          statuses[event.status],
        ])
      );
    }
  }

  // ===================================================
  // ANOMALIAS (APENAS NÃO RESOLVIDAS)
  // ===================================================

  const unresolvedIssues = issues.filter((issue) => {
    const stateAtDate = eventAt(issue, end);
    const status = stateAtDate?.status ?? "ouvert";
    return status !== "resolu";
  });

  checkPage(20);
  if (!unresolvedIssues.length) {
    write("Aucune anomalie en attente à présenter pour cette période.");
  }

  for (const [index, issue] of unresolvedIssues.entries()) {
    const stateAtDate = eventAt(issue, end);

    checkPage(40); // Espaço mínimo para começar uma anomalia (títulos + informações básicas)
    
    write(`Anomalie ${index + 1} / ${unresolvedIssues.length}`, 10);
    write(issue.title, 16, true);
    write(`${issue.location} · ${issue.category}`);

    const priority = stateAtDate?.priority ?? issue.history[0]?.priority;
    const status = stateAtDate?.status ?? "ouvert";

    write(`Priorité : ${priority ? priorities[priority] : "-"} · État à la fin de période : ${statuses[status]}`, 10, true);
    write(`Constat : ${displayDate(issue.date)} · Signalé par : ${issue.reportedBy}`);
    write(`Responsable : ${stateAtDate?.assignee || "Non attribué"}`);

    if (issue.photoId) {
      const data = await getPhoto(issue);
      const props = doc.getImageProperties(data);
      
      const maxWidth = 150;
      const maxHeight = 75;
      let width = maxWidth;
      let height = (width * props.height) / props.width;

      if (height > maxHeight) {
        height = maxHeight;
        width = (height * props.width) / props.height;
      }

      checkPage(height + 6); // Verifica se a imagem cabe nesta página
      const imageX = LEFT + (CONTENT_WIDTH - width) / 2;
      doc.addImage(data, imageX, y, width, height);
      y += height + 6;
    } else {
      write("Aucune photo jointe.", 9);
    }

    write("Description du problème", 11, true);
    write(issue.description);

    const history = issue.history.filter((event) => today(new Date(event.at)) <= end);

    if (history.length) {
      write("Historique jusqu'à la fin de période", 11, true);
      table(
        ["Date / auteur", "Intervention", "État"],
        history.map((event) => [
          `${displayDate(today(new Date(event.at)))}\n${event.actor}`,
          event.note,
          statuses[event.status],
        ])
      );
    }

    write(`Référence : ${issue.id}`, 8);

    if (index < unresolvedIssues.length - 1) {
      checkPage(15);
      doc.setDrawColor(220, 225, 222);
      doc.line(LEFT, y, PAGE_WIDTH - RIGHT, y);
      y += 7;
    }
  }

  // =====================================================
  // RODAPÉ EM TODAS AS PÁGINAS
  // =====================================================
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text("Hôtel Contrôle · Document interne", LEFT, PAGE_HEIGHT - 8);
    doc.text(`Page ${i} / ${pageCount}`, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 8, { align: "right" });
  }

  return doc;
}

async function loadPhoto(issue: Issue): Promise<string> {
  const response = await fetch(`/api/photos/${issue.id}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Photo inaccessible pour « ${issue.title} ». Actualisez et réessayez.`);
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
    reader.readAsDataURL(blob);
  });
}

export async function downloadReport(options: ReportOptions) {
  const doc = await buildReport(options);
  const prefix = options.kind === "daily" ? "rapport-quotidien" : "bilan-mensuel";
  doc.save(`${prefix}-${options.period}.pdf`);
}