import { strToU8, zipSync } from "fflate";

// Synthetic room labels and a miniature Séjours calendar. Data cells within a
// merged stay are empty in the export except for the name on its first day.
export function makeSejoursFixture(headers = ["jeu 19/11", "ven 20/11", "sam 21/11", "dim 22/11"]) {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const inline = (ref: string, s: string) => `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`;
  const room = (n: number, id: string, cells: string) => `<row r="${n}">${inline("A"+n,id+" --- Double")}${cells}</row>`;
  const rows = [
    `<row r="1">${headers.map((h,i) => inline(String.fromCharCode(66+i)+"1",h)).join("")}</row>`,
    room(2, "101", '<c r="B2" t="s"><v>0</v></c>'),
    room(4, "102", inline("D4", "Séjour futur")),
    room(6, "103", '<c r="C6" s="1" t="inlineStr"><is><t>Peinture</t></is></c>'),
    room(8, "104", '<c r="C8" s="2"/>'),
  ];
  const merges = ["A2:A3","B2:D3","A4:A5","A6:A7","A8:A9","C8:C9"];
  const sheet = `<worksheet xmlns="${ns}"><sheetData>${rows.join("")}</sheetData><mergeCells>${merges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells></worksheet>`;
  const fills = ['<patternFill patternType="none"/>', '<patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill>',
    '<patternFill patternType="darkGrid"><fgColor rgb="FFFF0000"/></patternFill>'];
  return zipSync({
    "xl/worksheets/sheet1.xml":strToU8(sheet),
    "xl/sharedStrings.xml":strToU8(`<sst xmlns="${ns}"><si><r><t>Famille </t></r><r><t>Exemple -101</t></r></si></sst>`),
    "xl/styles.xml":strToU8(`<styleSheet xmlns="${ns}"><fills>${fills.map(f => "<fill>"+f+"</fill>").join("")}</fills><cellXfs>${fills.map((_,i) => `<xf fillId="${i}"/>`).join("")}</cellXfs></styleSheet>`),
  });
}
