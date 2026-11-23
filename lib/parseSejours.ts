import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import type { OccupancyImportRow } from "./occupancyImport";
import { rooms } from "./rooms";

type StayRow = Omit<OccupancyImportRow, "expectedPreviousEventId">;
export type SejoursReport = { date: string; rows: StayRow[]; ignoredRooms: string[] };
type Address = { col: number; row: number };
type Span = { first: Address; last: Address };

const dayMs = 86400000;
const invalid = () => new Error("Fiche Séjours illisible ou incomplète. Vérifiez le calendrier et les couleurs du fichier Excel.");

function elements(node: Document | Element, tag: string) {
  return Array.from(node.getElementsByTagNameNS("*", tag));
}

function address(ref: string | null): Address {
  const match = /^([A-Z]{1,3})([1-9]\d{0,5})$/.exec(ref || "");
  if (!match) throw invalid();
  let col = 0;
  for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64;
  return { col, row: Number(match[2]) };
}

function filenameDate(digits: string) {
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw Error("Le nom de la fiche Séjours contient une date invalide.");
  }
  return iso;
}

function reportDate(name: string) {
  const match = /^Sejours_(\d{8})_(\d{8})(?:\s*\(\d+\))?\.xlsx$/i.exec(name);
  if (!match) throw Error("Sélectionnez une fiche nommée Sejours_AAAAMMJJ_AAAAMMJJ.xlsx.");
  const start = filenameDate(match[1]);
  const end = filenameDate(match[2]);
  if (end < start) throw Error("La date de fin de la fiche Séjours précède la date de début.");
  return start;
}

function headerDate(label: string, day: string) {
  const m = /^(?:[^\d/]+\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(label.trim());
  if (!m) throw invalid();
  const year = +day.slice(0,4);
  const candidates = (m[3] ? [+m[3]] : [year-1,year,year+1]).map(y => new Date(Date.UTC(y,+m[2]-1,+m[1])))
    .filter(d => d.getUTCMonth() === +m[2]-1 && d.getUTCDate() === +m[1]);
  if (!candidates.length) throw invalid();
  const target = Date.parse(day);
  return candidates.sort((a,b) => Math.abs(+a-target) - Math.abs(+b-target))[0].toISOString().slice(0,10);
}

function readStyles(styles: Document) {
  const fills = elements(styles, "fill"), palette = elements(styles, "indexedColors")[0];
  const indexed = palette ? elements(palette,"rgbColor").map(c => c.getAttribute("rgb")) : [];
  const xfs = elements(styles, "cellXfs")[0];
  if (!xfs) throw invalid();
  return elements(xfs,"xf").map(xf => {
    const fill = fills[Number(xf.getAttribute("fillId") || 0)];
    if (!fill) throw invalid();
    const pattern = elements(fill, "patternFill")[0];
    if (!pattern || pattern.getAttribute("patternType") === "none") return false;
    return [...elements(pattern,"fgColor"), ...elements(pattern,"bgColor")].some(color => {
      const index = color.getAttribute("indexed");
      const rgb = color.getAttribute("rgb") || (index === null ? "" : indexed[+index] || ([2,10].includes(+index) ? "FF0000" : ""));
      return rgb?.slice(-6).toUpperCase() === "FF0000";
    });
  });
}

// Le libellé du planning peut se terminer par les numéros des chambres de la famille.
function guestLabel(label: string) {
  const name = label.replace(/(?:[\s/-]+\d{3})+[\s/-]*$/, suffix => {
    const numbers = suffix.match(/\d{3}/g) || [];
    return numbers.every(n => rooms.includes(n)) ? "" : suffix;
  }).trim();
  if (!name || name.length > 200) throw Error("Vérifiez le nom du résident indiqué sur le planning.");
  return name;
}

function readCalendar(sheet: Document, strings: string[], red: boolean[], day: string): SejoursReport | undefined {
  const byRow = new Map<number, Map<number, Element>>();
  for (const cell of elements(sheet, "c")) {
    const {row,col} = address(cell.getAttribute("r"));
    const cells = byRow.get(row) || new Map<number, Element>();
    if (cells.has(col)) throw invalid();
    cells.set(col,cell);
    byRow.set(row,cells);
  }
  function value(cell?: Element) {
    if (!cell) return "";
    const v = elements(cell,"v")[0]?.textContent || "";
    if (cell.getAttribute("t") === "s") {
      if (!/^\d+$/.test(v) || strings[+v] === undefined) throw invalid();
      return strings[+v].trim();
    }
    return (cell.getAttribute("t") === "inlineStr" ? elements(cell,"t").map(t => t.textContent).join("") : v).trim();
  }
  const header = byRow.get(1);
  if (!header || !value(header.get(2)).includes("/")) return;
  const days = new Map<number,string>();
  let selected = 0;
  for (const [col,cell] of [...header].sort(([a],[b]) => a-b)) {
    if (col === 1 || !value(cell)) continue;
    const iso = headerDate(value(cell),day);
    if (col > 2 && Date.parse(iso) - Date.parse(days.get(col-1) || "") !== dayMs) throw invalid();
    days.set(col,iso);
    if (iso === day) selected = col;
  }
  if (!selected) return;
  const spans: Span[] = elements(sheet,"mergeCell").map(m => {
    const [start,end] = (m.getAttribute("ref") || "").split(":");
    const first = address(start), last = address(end || start);
    if (first.row > last.row || first.col > last.col) throw invalid();
    return { first, last };
  });
  const rows: StayRow[] = [], ignoredRooms: string[] = [], seen = new Set<string>();
  for (const [row,cells] of byRow) {
    const label = value(cells.get(1));
    if (!label || row === 1) continue;
    const room = /^(\d{3})(?=\s|-|$)/.exec(label)?.[1];
    if (!room) throw invalid();
    if (seen.has(room)) throw Error(`La chambre ${room} apparaît deux fois sur le planning.`);
    seen.add(room);
    if (!rooms.includes(room)) { ignoredRooms.push(room); continue; }
    const block = spans.find(s => s.first.row === row && s.first.col === 1);
    const bottom = block?.last.row ?? row;
    if (bottom - row > 20) throw invalid();
    const stays = new Map<string, string>();
    let works = false;
    for (let r = row; r <= bottom; r++) {
      const span = spans.find(s => s.first.row <= r && r <= s.last.row && s.first.col <= selected && selected <= s.last.col);
      const master = span?.first || {row:r, col:selected};
      if (master.col === 1 || master.row < row || (span && span.last.row > bottom)) throw invalid();
      const anchor = byRow.get(master.row)?.get(master.col);
      const current = byRow.get(r)?.get(selected);
      let redBlock = false;
      for (const cell of [current,anchor]) {
        if (!cell) continue;
        const style = Number(cell.getAttribute("s") || 0);
        if (red[style] === undefined) throw invalid();
        if (red[style]) redBlock = true;
      }
      if (redBlock) {
        works = true;
        continue;
      }
      const guest = value(anchor);
      if (guest) {
        const until = days.get(span?.last.col ?? selected);
        if (!until) throw invalid();
        stays.set(guest,until);
      }
    }
    if (stays.size > 1 || (stays.size && works)) throw Error(`Chambre ${room} : plusieurs états se chevauchent à cette date.`);
    const stay = stays.entries().next().value;
    if (stay) rows.push({room, status:"occupied", guestName:guestLabel(stay[0]), stayUntil:stay[1]});
    else rows.push({room, status:works ? "works" : "available"});
  }
  if (!rows.length) throw invalid();
  return { date:day, rows, ignoredRooms };
}

export async function parseSejours(file: File): Promise<SejoursReport> {
  const day = reportDate(file.name);
  if (!file.size || file.size > 5 * 1024 * 1024) throw Error("Le fichier Excel doit peser moins de 5 Mo.");
  let budget = 12 * 1024 * 1024;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(bytes, {filter: entry => {
    if (!/^xl\/(?:styles\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(entry.name)) return false;
    budget -= entry.originalSize;
    if (budget < 0) throw invalid();
    return true;
  }});
  const parser = new DOMParser({onError: () => { throw invalid(); }});
  function read(path: string) {
    if (!files[path]) throw invalid();
    const xml = strFromU8(files[path]);
    if (/<!DOCTYPE/i.test(xml)) throw invalid();
    return parser.parseFromString(xml,"application/xml");
  }
  const shared = files["xl/sharedStrings.xml"] ? elements(read("xl/sharedStrings.xml"),"si")
    .map(s => elements(s,"t").map(t => t.textContent).join("")) : [];
  const red = readStyles(read("xl/styles.xml"));
  const reports = Object.keys(files).filter(path => path.startsWith("xl/worksheets/"))
    .map(path => readCalendar(read(path),shared,red,day)).filter((r): r is SejoursReport => r !== undefined);
  if (reports.length !== 1) throw Error("Aucun planning unique ne correspond à la date de cette fiche.");
  return reports[0];
}
