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

/**
 * Retorna as anomalias que devem aparecer
 * no relatório diário.
 */
export function dailyIssues(
  state: State,
  date: string
): Issue[] {
  const linked = new Set(
    state.inspections
      .filter((inspection) => inspection.date === date)
      .flatMap((inspection) =>
        inspection.checks.map((check) => check.issueId)
      )
  );

  return state.issues.filter(
    (issue) =>
      issue.date <= date &&
      (
        issue.date === date ||
        (eventAt(issue, date)?.status ?? "ouvert") !== "resolu" ||
        linked.has(issue.id) ||
        issue.history.some(
          (event) =>
            today(new Date(event.at)) === date
        )
      )
  );
}

/**
 * Opções do relatório.
 */
type ReportOptions = {
  kind: "daily" | "monthly";
  period: string;
  hotelName: string;
  state: State;
};

/**
 * Tipo da função responsável por carregar
 * uma foto de uma anomalia.
 *
 * Mantemos separado para facilitar testes.
 */
type PhotoLoader = (
  issue: Issue
) => Promise<string>;

/**
 * Constrói o relatório.
 *
 * O PDF possui sempre uma única página.
 *
 * A largura permanece equivalente ao A4:
 * 210 mm.
 *
 * A altura aumenta automaticamente
 * quando o conteúdo ultrapassa 297 mm.
 */
export async function buildReport(
  {
    kind,
    period,
    hotelName,
    state,
  }: ReportOptions,
  photoLoader: PhotoLoader = loadPhoto
): Promise<jsPDF> {
  // =====================================================
  // CONFIGURAÇÃO
  // =====================================================

  const PAGE_WIDTH = 210;

  const A4_HEIGHT = 297;

  /**
   * Página temporária usada apenas para
   * descobrir a altura necessária.
   *
   * jsPDF possui um limite próximo de 5080 mm
   * por dimensão.
   */
  const MEASURE_HEIGHT = 5000;

  const LEFT = 14;

  const RIGHT = 14;

  const CONTENT_WIDTH =
    PAGE_WIDTH - LEFT - RIGHT;

  // =====================================================
  // DADOS DO RELATÓRIO
  // =====================================================

  const monthly =
    kind === "monthly"
      ? monthlySummary(state, period)
      : null;

  const end =
    monthly?.end || period;

  const issues =
    monthly?.issues ||
    dailyIssues(state, period);

  const rounds =
    monthly?.inspections ||
    state.inspections.filter(
      (inspection) =>
        inspection.date === period
    );

  /**
   * Guardamos a data da geração.
   *
   * Como o relatório é renderizado duas vezes,
   * isso impede diferença de segundos entre
   * a medição e o PDF final.
   */
  const generatedAt =
    new Date().toLocaleString(
      "fr-FR",
      {
        timeZone: "Europe/Paris",
      }
    );

  // =====================================================
  // CACHE DAS FOTOS
  // =====================================================

  /**
   * O relatório é renderizado duas vezes:
   *
   * 1. para descobrir sua altura;
   * 2. para gerar o documento definitivo.
   *
   * Sem cache, cada foto seria buscada duas vezes.
   */
  const photoCache =
    new Map<string, string>();

  async function getPhoto(
    issue: Issue
  ): Promise<string> {
    const cached =
      photoCache.get(issue.id);

    if (cached) {
      return cached;
    }

    const data =
      await photoLoader(issue);

    photoCache.set(
      issue.id,
      data
    );

    return data;
  }

  // =====================================================
  // NORMALIZAÇÃO DE TEXTO
  // =====================================================

  function normalizeText(
    value: string
  ): string {
    return String(value ?? "")
      .replace(
        /[\u2018\u2019]/g,
        "'"
      )
      .replace(
        /[\u2013\u2014]/g,
        "-"
      );
  }

  // =====================================================
  // RENDERIZAÇÃO
  // =====================================================

  /**
   * Toda a lógica visual está nesta função.
   *
   * Ela NÃO cria novas páginas.
   *
   * Retorna o Y final utilizado.
   */
  async function render(
    doc: jsPDF
  ): Promise<number> {
    let y = 0;

    // ===================================================
    // HEADER
    // ===================================================

    function header() {
      doc.setFillColor(
        23,
        62,
        54
      );

      doc.rect(
        0,
        0,
        PAGE_WIDTH,
        27,
        "F"
      );

      doc.setTextColor(
        255,
        255,
        255
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(16);

      doc.text(
        "Hôtel Contrôle",
        LEFT,
        12
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(10);

      const subtitle =
        kind === "daily"
          ? `Rapport quotidien · ${displayDate(
              period
            )}`
          : `Bilan mensuel · ${period
              .split("-")
              .reverse()
              .join("/")}`;

      doc.text(
        normalizeText(subtitle),
        LEFT,
        20
      );

      doc.setTextColor(
        35,
        50,
        45
      );

      y = 37;
    }

    // ===================================================
    // TEXTO
    // ===================================================

    function write(
      value: string,
      size = 10,
      bold = false
    ) {
      doc.setFont(
        "helvetica",
        bold
          ? "bold"
          : "normal"
      );

      doc.setFontSize(size);

      doc.setTextColor(
        35,
        50,
        45
      );

      const lines =
        doc.splitTextToSize(
          normalizeText(value),
          CONTENT_WIDTH
        ) as string[];

      for (
        const line of lines
      ) {
        doc.setFont(
          "helvetica",
          bold
            ? "bold"
            : "normal"
        );

        doc.setFontSize(size);

        doc.text(
          line,
          LEFT,
          y
        );

        /**
         * Conversão aproximada do tamanho
         * da fonte em pt para mm.
         */
        y += size * 0.46;
      }

      y += 3;
    }

    // ===================================================
    // TABELAS
    // ===================================================

    function table(
      head: string[],
      body: string[][]
    ) {
      if (!body.length) {
        return;
      }

      autoTable(doc, {
        startY: y,

        head: [
          head.map(
            normalizeText
          ),
        ],

        body: body.map(
          (row) =>
            row.map(
              (value) =>
                normalizeText(
                  value ?? ""
                )
            )
        ),

        margin: {
          left: LEFT,
          right: RIGHT,
          top: 0,
          bottom: 0,
        },

        styles: {
          font: "helvetica",

          fontSize: 8,

          cellPadding: 2.2,

          overflow:
            "linebreak",

          valign: "top",

          textColor: [
            35,
            50,
            45,
          ],
        },

        headStyles: {
          fillColor: [
            36,
            91,
            79,
          ],

          textColor: [
            255,
            255,
            255,
          ],

          fontStyle:
            "bold",
        },

        alternateRowStyles: {
          fillColor: [
            245,
            247,
            242,
          ],
        },

        rowPageBreak:
          "avoid",

        pageBreak:
          "auto",

        showHead:
          "firstPage",
      });

      const result = (
        doc as jsPDF & {
          lastAutoTable?: {
            finalY: number;
          };
        }
      ).lastAutoTable;

      if (result) {
        y =
          result.finalY + 7;
      }
    }

    // ===================================================
    // CABEÇALHO
    // ===================================================

    header();

    // ===================================================
    // HOTEL
    // ===================================================

    write(
      hotelName,
      18,
      true
    );

    write(
      `Édité le ${generatedAt} · Heure de Paris`,
      9
    );

    if (
      end >= today()
    ) {
      write(
        "Période en cours : situation à l'heure de génération du rapport.",
        9
      );
    }

    // ===================================================
    // RONDAS
    // ===================================================

    const completedRounds =
      rounds.filter(
        (round) =>
          round.completed
      ).length;

    const unfinished =
      rounds.filter(
        (round) =>
          !round.completed
      ).length;

    write(
      `${completedRounds} ronde(s) terminée(s) · ${unfinished} brouillon(s)`,
      11,
      true
    );

    if (unfinished) {
      write(
        "Les rondes en brouillon ne constituent pas des vérifications terminées.",
        9
      );
    }

    // ===================================================
    // RESUMO MENSAL
    // ===================================================

    if (monthly) {
      table(
        [
          "Indicateur",
          "Total",
        ],
        [
          [
            "Anomalies reportées du mois précédent",
            String(
              monthly
                .pendingStart
                .length
            ),
          ],

          [
            "Nouvelles anomalies",
            String(
              monthly
                .newIssues
                .length
            ),
          ],

          [
            "Anomalies ayant été résolues dans le mois",
            String(
              monthly
                .resolvedCount
            ),
          ],

          [
            "Interventions / modifications consignées",
            String(
              monthly
                .interventions
                .length
            ),
          ],

          [
            "Anomalies restant ouvertes en fin de période",
            String(
              monthly
                .pendingEnd
                .length
            ),
          ],
        ]
      );

      write(
        "Une anomalie résolue puis rouverte reste dans les anomalies ouvertes. Les résolutions incluent les problèmes signalés les mois précédents.",
        9
      );
    }

    // ===================================================
    // RESUMO DIÁRIO
    // ===================================================

    else {
      const newIssues =
        state.issues.filter(
          (issue) =>
            issue.date ===
            period
        ).length;

      const unresolved =
        issues.filter(
          (issue) =>
            (
              eventAt(
                issue,
                end
              )?.status ??
              "ouvert"
            ) !==
            "resolu"
        ).length;

      write(
        `${newIssues} nouvelle(s) anomalie(s) · ${unresolved} non résolue(s) à cette date`
      );

      write(
        "Ce rapport inclut les problèmes du jour, les anomalies associées aux rondes, les interventions du jour et les anciennes anomalies encore ouvertes.",
        9
      );
    }

    // ===================================================
    // LISTA DAS RONDAS
    // ===================================================

    write(
      "Rondes de la période",
      13,
      true
    );

    if (!rounds.length) {
      write(
        "Aucune ronde enregistrée pour cette période."
      );
    } else {
      table(
        [
          "Date",
          "Zone",
          "Inspecteur",
          "État",
        ],

        rounds.map(
          (round) => [
            displayDate(
              round.date
            ),

            round.area,

            round.inspector,

            round.completed
              ? "Terminée"
              : "Brouillon",
          ]
        )
      );
    }

    // ===================================================
    // CHECKLIST DIÁRIO
    // ===================================================

    if (
      kind === "daily"
    ) {
      for (
        const round of rounds
      ) {
        /**
         * IMPORTANTE:
         *
         * Não existe mais:
         *
         * page();
         *
         * Tudo continua na mesma página.
         */

        write(
          `Checklist · ${round.area}`,
          15,
          true
        );

        write(
          `${round.inspector} · ${
            round.completed
              ? "Terminée"
              : "BROUILLON"
          }`
        );

        table(
          [
            "Point contrôlé",
            "Constat",
            "Observation / anomalie",
          ],

          round.checks.map(
            (check) => {
              const item =
                checklist.find(
                  (task) =>
                    task.id ===
                    check.key
                );

              const linkedIssue =
                check.issueId
                  ? state.issues.find(
                      (issue) =>
                        issue.id ===
                        check.issueId
                    )
                  : undefined;

              return [
                item?.label ||
                  check.key,

                checkLabels[
                  check.result
                ],

                [
                  check.note,

                  linkedIssue?.title ||
                    (
                      check.issueId
                        ? check.issueId
                        : ""
                    ),
                ]
                  .filter(
                    Boolean
                  )
                  .join(
                    " · "
                  ),
              ];
            }
          )
        );

        if (
          round.notes
        ) {
          write(
            `Notes : ${round.notes}`
          );
        }
      }
    }

    // ===================================================
    // INTERVENÇÕES MENSAIS
    // ===================================================

    if (monthly) {
      write(
        "Travaux et interventions du mois",
        15,
        true
      );

      if (
        !monthly
          .interventions
          .length
      ) {
        write(
          "Aucune intervention consignée pour ce mois."
        );
      } else {
        table(
          [
            "Date / auteur",
            "Anomalie / lieu",
            "Travail effectué",
            "État après intervention",
          ],

          monthly
            .interventions
            .map(
              ({
                issue,
                event,
              }) => [
                `${displayDate(
                  today(
                    new Date(
                      event.at
                    )
                  )
                )}\n${
                  event.actor
                }`,

                `${issue.title}\n${issue.location}`,

                event.note,

                statuses[
                  event.status
                ],
              ]
            )
        );
      }
    }

    // ===================================================
    // SEM ANOMALIAS
    // ===================================================

    if (!issues.length) {
      write(
        "Aucune anomalie à présenter pour cette période."
      );
    }

    // ===================================================
    // ANOMALIAS
    // ===================================================

    for (
      const [
        index,
        issue,
      ] of
      issues.entries()
    ) {
      const stateAtDate =
        eventAt(
          issue,
          end
        );

      write(
        `Anomalie ${
          index + 1
        } / ${
          issues.length
        }`,
        10
      );

      write(
        issue.title,
        16,
        true
      );

      write(
        `${issue.location} · ${issue.category}`
      );

      /**
       * Prioridade inicial de fallback.
       */
      const initialPriority =
        issue.history[0]
          ?.priority;

      const priority =
        stateAtDate?.priority ??
        initialPriority;

      const status =
        stateAtDate?.status ??
        "ouvert";

      write(
        `Priorité : ${
          priority
            ? priorities[
                priority
              ]
            : "-"
        } · État à la fin de période : ${
          statuses[
            status
          ]
        }`,
        10,
        true
      );

      write(
        `Constat : ${displayDate(
          issue.date
        )} · Signalé par : ${
          issue.reportedBy
        }`
      );

      write(
        `Responsable : ${
          stateAtDate
            ?.assignee ||
          "Non attribué"
        }`
      );

      // =================================================
      // FOTO
      // =================================================

      if (
        issue.photoId
      ) {
        const data =
          await getPhoto(
            issue
          );

        const props =
          doc.getImageProperties(
            data
          );

        /**
         * Limites da foto.
         *
         * Isso reduz bastante a altura
         * final do relatório.
         */
        const maxWidth =
          150;

        const maxHeight =
          75;

        let width =
          maxWidth;

        let height =
          (
            width *
            props.height
          ) /
          props.width;

        /**
         * Se a foto for muito vertical,
         * limitamos a altura.
         */
        if (
          height >
          maxHeight
        ) {
          height =
            maxHeight;

          width =
            (
              height *
              props.width
            ) /
            props.height;
        }

        /**
         * Centraliza horizontalmente
         * quando a foto fica menor.
         */
        const imageX =
          LEFT +
          (
            CONTENT_WIDTH -
            width
          ) /
            2;

        /**
         * jsPDF consegue identificar
         * o formato usando o DataURL.
         *
         * AUTO evita assumir que
         * toda imagem é JPEG.
         */
       doc.addImage(
  data,
  imageX,
  y,
  width,
  height
);

        y +=
          height + 6;
      } else {
        write(
          "Aucune photo jointe.",
          9
        );
      }

      // =================================================
      // DESCRIÇÃO
      // =================================================

      write(
        "Description du problème",
        11,
        true
      );

      write(
        issue.description
      );

      // =================================================
      // HISTÓRICO
      // =================================================

      const history =
        issue.history.filter(
          (event) =>
            today(
              new Date(
                event.at
              )
            ) <= end
        );

      if (
        history.length
      ) {
        write(
          "Historique jusqu'à la fin de période",
          11,
          true
        );

        table(
          [
            "Date / auteur",
            "Intervention",
            "État",
          ],

          history.map(
            (event) => [
              `${displayDate(
                today(
                  new Date(
                    event.at
                  )
                )
              )}\n${
                event.actor
              }`,

              event.note,

              statuses[
                event.status
              ],
            ]
          )
        );
      }

      // =================================================
      // REFERÊNCIA
      // =================================================

      write(
        `Référence : ${issue.id}`,
        8
      );

      // =================================================
      // SEPARADOR
      // =================================================

      if (
        index <
        issues.length - 1
      ) {
        doc.setDrawColor(
          220,
          225,
          222
        );

        doc.line(
          LEFT,
          y,
          PAGE_WIDTH -
            RIGHT,
          y
        );

        y += 7;
      }
    }

    return y;
  }

  // =====================================================
  // PRIMEIRA PASSAGEM
  // =====================================================

  /**
   * Criamos primeiro um documento muito alto.
   *
   * O objetivo não é exportá-lo.
   *
   * Ele serve apenas para medir quanto
   * espaço o conteúdo realmente ocupa.
   */
  const measureDoc =
    new jsPDF({
      unit: "mm",

      format: [
        PAGE_WIDTH,
        MEASURE_HEIGHT,
      ],

      orientation:
        "portrait",

      compress: true,
    });

  const measuredY =
    await render(
      measureDoc
    );

  /**
   * Se até a página de 5000 mm
   * foi insuficiente, o relatório
   * é grande demais para este método.
   */
  if (
    measureDoc.getNumberOfPages() >
    1
  ) {
    throw new Error(
      "Le rapport est trop volumineux pour être généré sur une seule page."
    );
  }

  // =====================================================
  // ALTURA FINAL
  // =====================================================

  /**
   * Espaço adicional para:
   *
   * - margem;
   * - footer.
   */
  const requiredHeight =
    Math.ceil(
      measuredY + 14
    );

  /**
   * Nunca fazemos uma página menor
   * que uma folha A4.
   *
   * Se o conteúdo passar de 297 mm,
   * aumentamos apenas a altura.
   */
  const finalHeight =
    Math.max(
      A4_HEIGHT,
      requiredHeight
    );

  if (
    finalHeight >
    MEASURE_HEIGHT
  ) {
    throw new Error(
      "Le rapport dépasse la taille maximale autorisée pour une page PDF unique."
    );
  }

  // =====================================================
  // PDF DEFINITIVO
  // =====================================================

  const doc =
    new jsPDF({
      unit: "mm",

      format: [
        PAGE_WIDTH,
        finalHeight,
      ],

      orientation:
        "portrait",

      compress: true,
    });

  await render(doc);

  // =====================================================
  // VERIFICAÇÃO
  // =====================================================

  if (
    doc.getNumberOfPages() !==
    1
  ) {
    throw new Error(
      "Impossible de conserver le rapport sur une seule page."
    );
  }

  // =====================================================
  // FOOTER
  // =====================================================

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(8);

  doc.setTextColor(
    115,
    115,
    115
  );

  doc.text(
    "Hôtel Contrôle · Document interne",
    LEFT,
    finalHeight - 6
  );

  doc.text(
    "1 / 1",
    PAGE_WIDTH -
      RIGHT,
    finalHeight - 6,
    {
      align: "right",
    }
  );

  return doc;
}

/**
 * Carrega a foto da API e converte
 * o Blob para Data URL.
 *
 * Essa era a função que estava faltando
 * e provocava:
 *
 * Cannot find name 'loadPhoto'
 */
async function loadPhoto(
  issue: Issue
): Promise<string> {
  const response =
    await fetch(
      `/api/photos/${issue.id}`,
      {
        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Photo inaccessible pour « ${issue.title} ». Actualisez et réessayez.`
    );
  }

  const blob =
    await response.blob();

  return new Promise<string>(
    (
      resolve,
      reject
    ) => {
      const reader =
        new FileReader();

      reader.onload =
        () => {
          resolve(
            String(
              reader.result
            )
          );
        };

      reader.onerror =
        () => {
          reject(
            new Error(
              "Lecture de la photo impossible."
            )
          );
        };

      reader.readAsDataURL(
        blob
      );
    }
  );
}

/**
 * Gera e baixa o relatório.
 */
export async function downloadReport(
  options: ReportOptions
) {
  const doc =
    await buildReport(
      options
    );

  const prefix =
    options.kind ===
    "daily"
      ? "rapport-quotidien"
      : "bilan-mensuel";

  doc.save(
    `${prefix}-${options.period}.pdf`
  );
}