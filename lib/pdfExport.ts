import jsPDF from "jspdf";
import { displayDate, eventAt, monthlySummary, today, type Issue, type State } from "./domain";

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

type PhotoLoader = (issue: Issue) => Promise<string | null>;

export async function buildReport(
  { kind, period, state }: ReportOptions,
  photoLoader: PhotoLoader = loadPhoto
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  
  const PAGE_WIDTH = 210;
  const PAGE_HEIGHT = 297;
  const LEFT = 14;
  const RIGHT = 14;
  const BOTTOM_MARGIN = 15;
  
  let y = 0;

  function checkPage(neededSpace: number) {
    if (y + neededSpace > PAGE_HEIGHT - BOTTOM_MARGIN) {
      doc.addPage();
      y = 20; // Margem superior na nova página
    }
  }

  const monthly = kind === "monthly" ? monthlySummary(state, period) : null;
  const end = monthly?.end || period;
  const issues = monthly?.issues || dailyIssues(state, period);

  const photoCache = new Map<string, string>();

  async function getPhoto(issue: Issue): Promise<string | null> {
    const cached = photoCache.get(issue.id);
    if (cached) return cached;
    const data = await photoLoader(issue);
    if (data) photoCache.set(issue.id, data);
    return data;
  }

  function normalizeText(value: string): string {
    return String(value ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-");
  }

  // =====================================================
  // CABEÇALHO SIMPLES
  // =====================================================
  doc.setFillColor(23, 62, 54);
  doc.rect(0, 0, PAGE_WIDTH, 20, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Hôtel Contrôle", LEFT, 13);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const subtitle = kind === "daily" 
    ? `Rapport anomalies · ${displayDate(period)}` 
    : `Anomalies du mois · ${period.split("-").reverse().join("/")}`;
  doc.text(normalizeText(subtitle), PAGE_WIDTH - RIGHT, 13, { align: "right" });

  y = 32;
  doc.setTextColor(35, 50, 45);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Problèmes à traiter", LEFT, y);
  y += 12;

  // ===================================================
  // ANOMALIAS (APENAS NÃO RESOLVIDAS)
  // ===================================================
  const unresolvedIssues = issues.filter((issue) => {
    const stateAtDate = eventAt(issue, end);
    const status = stateAtDate?.status ?? "ouvert";
    return status !== "resolu";
  });

  if (!unresolvedIssues.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Aucun problème en attente.", LEFT, y);
    return doc;
  }

  // Configurações do Layout Lado a Lado
  const TEXT_WIDTH = 125; // Espaço para o texto na esquerda
  const IMAGE_X = 145;    // Posição X onde a imagem começa na direita
  const IMAGE_MAX_W = 50; // Largura máxima da imagem (5 cm)
  const IMAGE_MAX_H = 40; // Altura máxima da imagem (4 cm)

  for (const issue of unresolvedIssues) {
    // 1. Preparar a Imagem e calcular o seu tamanho
    let photoData = null;
    let imgW = 0, imgH = 0;

    if (issue.photoId) {
      photoData = await getPhoto(issue);
      if (photoData) {
        const props = doc.getImageProperties(photoData);
        imgW = IMAGE_MAX_W;
        imgH = (imgW * props.height) / props.width;
        
        // Se a foto for muito alta, limita a altura e ajusta a largura
        if (imgH > IMAGE_MAX_H) {
          imgH = IMAGE_MAX_H;
          imgW = (imgH * props.width) / props.height;
        }
      }
    }

    // 2. Preparar os Textos
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const titleLines = doc.splitTextToSize(normalizeText(issue.title), TEXT_WIDTH);
    
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    const metaText = normalizeText(`${issue.location} · Constat du ${displayDate(issue.date)}`);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const descLines = doc.splitTextToSize(normalizeText(issue.description), TEXT_WIDTH);

    // 3. Calcular a altura total deste "bloco" para saber se cabe na página
    // ~5.5mm por linha de título + 5mm espaço + ~4.5mm por linha de descrição
    const textHeight = (titleLines.length * 5.5) + 5 + (descLines.length * 4.5);
    const blockHeight = Math.max(textHeight, imgH) + 12; // Usa a maior altura (texto ou imagem) + 12mm de margem inferior

    checkPage(blockHeight);

    // 4. Desenhar o Texto (Esquerda)
    let currentY = y;
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(35, 50, 45);
    doc.text(titleLines, LEFT, currentY);
    currentY += titleLines.length * 5.5;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(metaText, LEFT, currentY);
    currentY += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    doc.text(descLines, LEFT, currentY);

    // 5. Desenhar a Imagem (Direita)
    if (photoData) {
      doc.addImage(photoData, IMAGE_X, y - 4, imgW, imgH);
    } else if (issue.photoId) {
      // Caso a foto falhe os retries
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text("Photo indisponible", IMAGE_X, y);
    }

    y += blockHeight - 6;

    // 6. Linha separadora entre problemas
    doc.setDrawColor(230, 230, 230);
    doc.line(LEFT, y, PAGE_WIDTH - RIGHT, y);
    y += 6;
  }

  return doc;
}

// Mantido o Retry Anti-Crash
async function loadPhoto(issue: Issue): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`/api/photos/${issue.id}`, { cache: "no-store" });
      if (response.ok) {
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
          reader.readAsDataURL(blob);
        });
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } catch (e) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

export async function downloadReport(options: ReportOptions) {
  const doc = await buildReport(options);
  const prefix = options.kind === "daily" ? "rapport-quotidien" : "bilan-mensuel";
  doc.save(`${prefix}-${options.period}.pdf`);
}