# Hôtel Contrôle

## Responsável pela anomalia

Ao sinalizar uma anomalia, preencha apenas **Signalé par**: essa pessoa passa a
ser automaticamente a responsável. O campo separado **Responsable de
l’intervention** foi retirado. Nas anomalias criadas pelo controle de quartos,
o responsável é o inspetor que registrou o controle.

Ao acrescentar um acompanhamento, **Intervention saisie par** identifica quem
registrou aquela intervenção. Esse nome fica no histórico, sem substituir o
autor da sinalização como responsável pela anomalia. Registros antigos mantêm
seu histórico; quando não há nome de quem sinalizou, o responsável anteriormente
gravado continua sendo usado como referência.

Esta alteração não exige migração nem atualização adicional do Google Apps Script.

## Utilização mais simples no celular

- A checkbox **Occupée** tem o mesmo significado em **Occupation des chambres**
  e **Contrôle des chambres**: marcada = ocupado; desmarcada = livre. O estado
  desconhecido continua separado e permite usar **Marquer libre** diretamente.
- Os totais de ocupação também são botões de filtro. Eles consideram a busca e
  o andar selecionado. Azul identifica ocupado, verde identifica livre e cinza
  identifica não informado, sempre com o estado escrito no cartão.
- Os atalhos de anomalias preservam busca, datas, categoria e ordenação.
  Cada contador corresponde ao resultado do respectivo atalho; somente
  **Réinitialiser les filtres** limpa o conjunto dos filtros.
- Depois de uma tentativa de salvar o controle, os avisos de validação acompanham
  as correções dos campos sem exigir outro clique em salvar.
- Uma faixa reúne o estado dos envios, a conexão e as ações de atualização.
  **Enregistrements à jour** significa que não há envio pendente neste aparelho;
  os estados sem conexão, envio recusado e dados desatualizados aparecem
  explicitamente. **Réessayer l’envoi** retoma a fila existente.

Esta atualização não exige migração nem nova alteração no Google Apps Script.

## Ocupação rápida dos quartos

**Occupation des chambres** (`/occupation`) mostra os 85 quartos por andar,
com busca, filtros e totais de ocupados, livres e ainda não informados. Marcar
**Occupée** registra o quarto como ocupado; desmarcar registra como livre.
Uma caixa com traço indica estado desconhecido, com a ação **Marquer libre**
para informar diretamente que o quarto está livre. As alterações são salvas
automaticamente e usam o mesmo acompanhamento de disponibilidade do checklist.

A fila mantém as alterações feitas sem conexão. A tela indica os envios
pendentes e exclui controles bloqueados ou com data futura da situação atual.
A atualização de ocupação não cria um controle nem uma anomalia. Não exige
coluna nova, migração de dados ou alteração adicional no Apps Script.

O controle de temperatura foi retirado. A API conserva apenas a compatibilidade
com o campo legado de eventuais envios da prévia, para preservar seus hashes e
recibos em reenvios. Não há coleta nem exibição de temperatura na interface.

## Anomalias do controle e prioridade dos quartos em mau estado

O **Contrôle des chambres** cria uma anomalia automática somente quando se marca
**Problème** em **Robinets fonctionnels**, **Interrupteurs fonctionnels**,
**Aucune fuite d’eau**, **Éclairage fonctionnel**, **Détecteur de fumée fonctionnel**,
**Rien de cassé** ou **Fenêtre fonctionnelle**, ou **Détectés** em cafards/nuisibles.
**Absent** não dispara uma anomalia automática. Lit, matelas, minibar, ferme-porte,
poignée de porte, estado geral, ménage, moquette, limpeza dos equipamentos,
observações e fotos ficam no controle; isoladamente não geram anomalias.
As observações e fotos podem complementar um dos problemas elegíveis.

Um quarto cujo último controle indique **Mauvais état** tem prioridade na tournée,
mesmo antes do intervalo habitual. A ordem seguinte continua sendo quartos nunca
controlados e depois controles completos mais antigos. Um controle posterior em
**Bon** ou **À revoir** retira a prioridade por mau estado. Controles incompletos
podem indicar mau estado, mas não contam como concluídos. A meta diária, os quartos
já concluídos hoje, os adiamentos e a exclusão de envios bloqueados são respeitados.
O indicador de cobertura continua medindo controles completos dentro do intervalo.

**Implantação com Google Sheets:** além de publicar o aplicativo, copie o arquivo
completo `google-apps-script/Code.gs` no projeto existente e publique uma nova
versão da implantação. O matcher foi atualizado para preservar anomalias antigas
nos reenvios e não transformar uma gravação interrompida de um item agora excluído
em outro problema. Não há migração dos dados nem alteração dos hashes da fila.
As anomalias que já existem mantêm seu histórico e seu acompanhamento.

## Todas as fotos nos relatórios de anomalias

Em **Rapports & bilan mensuel**, os PDFs diário e mensal incluem todas as fotos
anexadas a cada anomalia do relatório, com legendas numeradas e proporções
preservadas. Textos e galerias continuam em novas páginas quando necessário.
Uma foto indisponível é identificada no documento, sem impedir a exibição das
demais. A exportação usa as APIs atuais e não exige atualização do Apps Script.

## Tarefas do dia para impressão

Em **Tâches du jour**, **Imprimer les tâches (PDF)** baixa as tarefas da data
selecionada, com seu estado atual. Um dia sem tarefas gera linhas em branco para
preencher à mão. Abra o arquivo baixado e imprima em A4, em escala de 100 %.
O PDF identifica os envios pendentes aceitos na lista e a cópia em cache quando
utilizada. Esta função não altera as tarefas nem exige atualização do Apps Script.

## Checklist dos quartos para impressão

Em **Contrôle des chambres**, **Imprimer le checklist (PDF)** permite baixar uma
ficha em branco reutilizável ou os últimos controles dos quartos exibidos pelos
filtros atuais, incluindo os quartos ainda sem controle. O PDF usa A4 em retrato,
uma ficha por quarto; observações longas podem continuar em outra página.
Abra o arquivo baixado e imprima em escala de 100 %. A ficha em branco funciona
mesmo sem quartos livres ou sem resultados nos filtros. Esta função não exige
atualização do Apps Script e preserva a exportação existente de quartos livres.

## Anomalias: consulta e acompanhamento mais rápidos

- Filtros por estado e prioridade em um toque, atalhos para pendências críticas
  e sem responsável, busca sem acentos que também encontra notas das intervenções.
  Números de quarto são pesquisados por inteiro: `204` não encontra `1204`.
- Anomalias ordenadas por padrão da data do constat mais recente à mais antiga;
  no mesmo dia, o registro criado por último aparece primeiro. O filtro de período
  fica sempre visível e inclui as datas de início e fim, ambas opcionais.
  Categoria e responsável não atribuído continuam nos filtros avançados; também
  é possível escolher a ordenação por antiguidade, prioridade ou última atualização.
- Cartões compactos com local, idade do signalement, responsável e último acompanhamento.
  Fotos são carregadas ao abrir a galeria; a lista mostra 24 registros por vez.
- Ao abrir um acompanhamento como Direction, estado, autor da intervenção e nota ficam
  primeiro. A ficha, fotos e histórico podem ser expandidos. Estados e prioridades
  usam botões; o formulário avisa antes de descartar alterações não salvas.
  O perfil Employé continua podendo consultar e criar anomalias; só Direction
  pode modificar o acompanhamento. As permissões da API continuam valendo.
- No controle de quarto, **J’ai vérifié : les équipements restants sont OK**
  agora inclui o **ferme-porte** ainda sem resposta. Respostas já escolhidas e
  equipamentos com anomalia aberta são preservados; o detector exige resposta individual.

Esta atualização utiliza os mesmos dados e endpoints. Basta publicar a nova versão
do aplicativo; não exige outra alteração no Apps Script além das versões anteriores.

## Disponibilidade, comentários e tarefas do dia

- **Ocupação dos quartos:** cada cartão em **Contrôle des chambres** tem a checkbox
  **Occupée**. Marcar informa ocupado; desmarcar informa livre. O traço
  indica disponibilidade ainda desconhecida. Não exige nem registra inspeção.
  Até a primeira alteração manual, usa a ocupação do último controle como
  referência; depois, a checkbox controla a disponibilidade atual independentemente
  dos controles históricos. Filtro e PDF usam esse estado, inclusive para quartos
  nunca inspecionados. O PDF distingue disponibilidade atual e dados do último controle.
- **Absences et départs:** **Ajouter un commentaire** acrescenta uma nota com data
  e autor ao mesmo evento. **Modifier le commentaire** permite corrigir texto e
  data, preservando o original e todas as versões no histórico de modificações.
  Os comentários existentes aparecem automaticamente, sem migração destrutiva.
- **Tâches du jour:** substitui a ronda cotidiana no menu e na página inicial.
  Adicione texto livre, marque como concluído, edite texto/data ou exclua a tarefa.
  A data permite consultar dias anteriores ou preparar dias futuros; tarefas não
  são apagadas à meia-noite. `/rondes` redireciona para `/quotidien`. Dados antigos
  de rondas continuam armazenados e disponíveis nos relatórios históricos.
- **Salvamento:** disponibilidade, comentários e tarefas usam a fila persistente
  do aparelho e sincronizam com o servidor. Alterações sucessivas são enviadas
  na ordem correta. Conflitos entre aparelhos são recusados com mensagem e o texto
  pendente preservado: atualize, cancele a alteração conflitante e refaça sobre os
  dados atuais. Falhas de rede e respostas perdidas podem ser reenviadas sem duplicar.

### Publicação desta versão

**Em Google Sheets, atualize primeiro o Apps Script:** copie o arquivo completo
`google-apps-script/Code.gs`, execute `setup()` e publique uma nova versão da
implantação Web App existente. A nova aba **Suivi quotidien** guarda o histórico
compartilhado de disponibilidade, comentários e tarefas. As demais abas, o token
privado e a pasta de fotos são preservados. Depois publique o app e use **Actualiser**.
O GitHub não publica o Apps Script automaticamente.

O script antigo rejeita `commitWorkEvent` antes de gravar; os envios permanecem
na fila. Após atualizar o script, use **Réessayer l’envoi**. No modo local, a nova coleção
`workEvents` é criada no primeiro salvamento, sem migração manual.

`lib/work.ts` contém as regras compartilhadas de revisão e projeção. Rode
`npm run build:apps-script` ao alterá-las e `npm run check:apps-script` para
validar o código pronto para implantação.

Validação desta atualização: testes de persistência, concorrência, comentários,
ordenação da fila, PDF e Apps Script simulado; TypeScript, lint e build de produção.
Os cenários Playwright estão em `tests/e2e/daily-work.spec.ts`. A execução no
navegador não pôde ser validada neste ambiente porque o Chromium não está instalado
e o download disponível falhou. A integração com o Google real depende da implantação.

## Contrôle rapide et rotation des chambres (version 4)

- **Inspeção por toque:** três etapas (équipements, état/ménage, résumé), botões
  grandes OK / Problème / Absent, sem dropdowns. O atalho de validação só marca
  equipamentos ainda sem resposta, incluindo o ferme-porte; detector e itens já sinalizados
  exigem resposta individual. Nenhuma resposta é preenchida ao abrir o quarto.
- **Ferme-porte:** verificar presença e fechamento automático. Defeito ou ausência
  ficam registrados no controle, sem gerar anomalia automática. Quartos antigos mostram
  este campo como não informado; rascunhos antigos o recebem como não verificado.
- **Rotação contínua:** meta inicial de 15 quartos/dia, intervalo alvo de 7 dias,
  ambos ajustáveis em **Régler**. Mau estado tem prioridade, mesmo em controle recente;
  depois vêm os nunca inspecionados e os controles completos mais antigos, com empate
  por número do quarto para reduzir deslocamentos.
  Quartos com anomalias continuam na rotação. Controles completos aguardando envio
  contam provisoriamente; envios bloqueados e datas futuras não entram na rotação.
  Controles parciais não contam como concluídos, mas podem indicar mau estado.
  A meta diária conta quartos únicos. **Reporter à demain** mantém o rascunho sem
  registrar uma inspeção. Preferências e reports pertencem ao navegador/aparelho.
- **Histórico:** consulta individual ou global, busca por quarto/inspector/texto,
  período, filtros, resumo dos constats, diferenças entre equipamentos, fotos sob
  demanda e estado real de sincronização. Horário da visita é preservado na fila.
- **Anomalias sem duplicação:** no salvamento, compara o quarto exato e cada
  constat com anomalias abertas/em andamento, inclusive as criadas pelo menu
  Anomalies. Novos registros usam chaves de equipamento; registros manuais antigos
  usam termos reconhecidos em francês. Textos ambíguos podem ser associados
  explicitamente no resumo. **Signaler un problème distinct** permite distinguir
  outro defeito no mesmo equipamento. Só constats elegíveis novos criam uma anomalia; vínculos,
  observações e fotos ficam no histórico. Um controle OK não encerra uma anomalia.
  Uma falha que reaparece depois da resolução pode gerar um novo signalement.
- **Compatibilidade:** controles imutáveis e filas anteriores (v1/v2/v3) mantêm
  seus IDs e hashes de reenvio. Novos controles são v4. Nenhuma inspeção antiga é
  reescrita ou convertida retroativamente em anomalia.

### Implantação desta atualização

**Se usa Google Sheets, atualize o Apps Script antes de publicar o aplicativo.**
Copie o arquivo completo `google-apps-script/Code.gs` no projeto existente, execute
`setup()` e publique uma nova versão da implantação existente. Preserve token,
planilha e pasta de fotos. A nova coluna Ferme-porte é adicionada ao final, sem
mover ou apagar colunas/dados antigos.

O GitHub não publica o Apps Script automaticamente. O aplicativo usa a ação
`commitRoomInspection`, que o script antigo rejeita antes de gravar: nesse caso
os controles permanecem na fila do aparelho, com instrução de atualização.
Depois de atualizar a implantação, use **Réessayer**. Não limpe os dados do
navegador enquanto houver registros pendentes. No modo `local`, não há esta etapa.

O matcher é compartilhado: `lib/roomIssueMatching.ts` é a fonte e
`npm run build:apps-script` atualiza o bloco gerado no Code.gs. Depois de modificá-lo,
rode `npm run check:apps-script` para confirmar que o arquivo implantável está em dia.
A comparação no Sheets acontece dentro do mesmo lock da gravação, sem baixar o
hotel inteiro no servidor. O plano de associação é preservado para repetir envios
ou reparar uma gravação interrompida sem duplicar ou reabrir anomalias resolvidas.


## Atualização: quartos livres, PDF e anomalias

No checklist, **Chambre occupée → Non** abre o campo obrigatório de ménage
(feito/não feito). Micro-ondas e frigobar presentes têm campos próprios de
limpeza. **Absent** em **Minibar fonctionnel** informa que não há frigobar.

Em `/checklist`, use **Exporter en PDF → Chambres libres**. O relatório inclui
o último controle de cada quarto livre, sua data, estado geral, ménage,
presença e limpeza dos equipamentos e problemas. Controles antigos sem esses
dados aparecem como não informados; registros aguardando envio são identificados.

Somente os problemas elegíveis listados no início deste documento geram uma
anomalia após a sincronização, com as observações e as mesmas fotos do controle.
Os demais constats continuam no histórico. Reenvios não duplicam a anomalia e
preservam seu andamento/resolução. Registros históricos já salvos não são
convertidos retroativamente.

**Para o modo Google Sheets, atualize e reimplante `google-apps-script/Code.gs`
antes de publicar esta versão do aplicativo.** A integração grava a anomalia
na aba **Anomalies** e reutiliza os arquivos de fotos. A atualização dos
arquivos locais não modifica a implantação online.

## Atualização: quartos, famílias e conexão lenta

A interface continua em francês. As rotas disponíveis são:

- `/checklist`: **Checklist des chambres**, com os 85 quartos cadastrados,
  agrupados por andar. Há pesquisa, filtros e histórico individual.
- `/familles`: **Absences et départs**, com quarto, família, ausência temporária
  ou saída definitiva, data, retorno previsto opcional, responsável e observações.
- `/quotidien`: as tarefas diárias que antes estavam em `/checklist`.
- Anomalias e relatórios existentes continuam disponíveis; dados das rondas antigas são preservados.

Cada controle de quarto registra estado geral, limpeza feita/não feita,
funcionamento de torneiras, interruptores, iluminação, detector de fumaça,
janela e frigobar; ausência de vazamentos e de objetos quebrados; cama, colchão,
moquete e presença de micro-ondas. Moquete manchada/suja exige descrição.
Problemas e estado geral ruim/a rever exigem observações. Os equipamentos
começam como **Non vérifié**, e controles com itens não verificados são indicados
como parciais. Cada controle pode ter até três fotos, pela câmera ou galeria.
Os registros novos são históricos imutáveis: uma nova inspeção acrescenta um
registro, sem substituir o controle anterior.

### Implantar na planilha

O arquivo pronto para copiar é **`google-apps-script/Code.gs`**. Ele já aponta
para a planilha `1mF0nUV0FihRnNJD0V6KnK7iJAjUleksrW-sPZvSd61I`.
As abas remotas só serão criadas quando o script atualizado for executado;
a alteração dos arquivos locais não publica o app nem altera a planilha online.

1. Na planilha, abra **Extensões → Apps Script** e substitua o conteúdo do
   arquivo de código pelo conteúdo completo de `google-apps-script/Code.gs`.
   Substitua o código antigo; não deixe duas cópias com as mesmas funções.
2. Execute **`setup()`** e autorize o acesso solicitado pelo Google.
   Ela preserva as abas **Anomalies** e **Rondes**, o `API_TOKEN` e a pasta de
   fotos existentes. Cria **Chambres**, **Absences et départs** e
   **Contrôles chambres**. Pode ser executada novamente sem duplicar quartos.
3. Publique uma nova versão da implantação Web App, executando como o
   proprietário e acessível ao servidor do aplicativo. A API continua exigindo
   o token privado em todas as leituras e gravações de dados.
4. Na configuração do servidor/app, confirme:

   ```dotenv
   STORAGE_DRIVER=sheets
   GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/ID_DA_IMPLANTACAO/exec
   GOOGLE_API_TOKEN=TOKEN_DAS_PROPRIEDADES_DO_SCRIPT
   ```

   Atualizar a implantação existente mantém sua URL. Criar outra implantação
   exige atualizar `GOOGLE_SCRIPT_URL`. Não coloque o token em variáveis
   `NEXT_PUBLIC_*`. O `.env` local encontrado nesta atualização usa
   `STORAGE_DRIVER=local`; altere para `sheets` após preparar a implantação.
5. Publique/reinicie o aplicativo com esta versão e use **Actualiser**.
   Se algum envio aguardou a atualização do script, use **Réessayer** na faixa
   de sincronização. Os novos registros não funcionam com o Apps Script antigo.

Os dados de `data/hotel.json` pertencem ao modo local. Mudar para Sheets não
os importa automaticamente. Preserve esse arquivo caso haja registros locais
que precisem de migração. Nas abas geridas pelo script, os campos visíveis
servem para consulta; o aplicativo lê os registros serializados nas colunas
ocultas. Edite/registe pelo aplicativo, sem renomear cabeçalhos ou apagar essas
colunas. A aba **Chambres** é uma referência dos quartos fixos do aplicativo.

### Uso com internet ruim

- Os rascunhos das duas telas novas, incluindo fotos, são gravados em IndexedDB
  durante o preenchimento. Cada quarto tem seu próprio rascunho.
- **Enregistrer** primeiro grava uma fila persistente no aparelho. O histórico
  distingue **En attente d’envoi** de **Enregistré sur le serveur**. Apenas a
  confirmação explícita do servidor remove um registro da fila.
- O envio é sequencial. Há nova tentativa quando a conexão retorna, ao reabrir
  uma sessão autenticada, a cada minuto com o app aberto e pelo botão
  **Réessayer**. Erros de validação/permissão ficam visíveis e exigem tentativa
  manual após sua correção. Repetir o mesmo envio não duplica linhas ou fotos.
- Cada novo envio faz uma chamada ao Google, sem baixar toda a base antes/depois.
  As fotos dos controles são reduzidas para até 1280 px e no máximo 500 mil
  caracteres de JPEG/base64 por foto (aproximadamente 375 KB de imagem).
  Fotos do histórico só são baixadas ao tocar em **Afficher les photos**.
- Após validar a sessão, o app pode restaurar a última cópia dos dados enquanto
  atualiza. Uma faixa informa quando a cópia exibida pode estar desatualizada.
- É preciso conexão para abrir/autenticar o app inicialmente e carregar páginas
  ainda não abertas. Esta versão não instala um service worker e não promete
  abertura completa offline. Com a tela carregada, os formulários novos podem
  ser preenchidos e colocados na fila sem rede. Fechar o navegador pausa o envio;
  reabrir o app autenticado retoma a fila. Não há envio em segundo plano fechado.
- Os rascunhos e a fila ficam neste navegador/aparelho. Não limpe os dados do
  navegador nem use modo privado para registros ainda não enviados. Falhas de
  armazenamento são mostradas; elas não são tratadas como envio bem-sucedido.
- O modo offline com fila se aplica aos novos controles e eventos de famílias;
  as rondas e anomalias antigas mantêm seu fluxo de gravação existente.

### Verificação

```sh
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
npm run test:e2e
```

Os testes unitários incluem os intervalos de quartos, validações, fotos privadas,
persistência, repetição de envio, conflito de conteúdo e o Apps Script com
simulação de Sheets/Drive, incluindo preservação das abas antigas. Os testes de
navegador incluem celular, rascunho recuperado, fila offline e resposta perdida.
Nesta execução, o ambiente bloqueou a abertura da porta 3127 (`listen EPERM`),
portanto os testes de navegador não puderam executar. A conexão direta ao Google
também não pôde ser validada neste ambiente por bloqueio de rede/DNS.

## Getting Started

The login screen offers two profiles: **Direction** and **Employé**. Configure
`APP_DIRECTION_PASSWORD` and `APP_EMPLOYEE_PASSWORD` in `.env.local` (or in the
hosting environment), then restart the server. The former `APP_PASSWORD` remains
a fallback for Direction only. Existing sessions must log in again.

Both profiles can consult anomalies, report new ones, inspect rooms, update availability, add family comments, and manage daily tasks.
Only Direction can edit an existing anomaly, record an intervention, or change
its status. These permissions are enforced by the API as well as the interface.

New anomalies accept up to **3 photos total**, taken consecutively with the
camera or selected together. Photos can be removed before saving. Existing
single-photo records remain readable without a migration.

When using Google Sheets, update `google-apps-script/Code.gs` in the bound Apps
Script project and deploy a new version of the existing web app before using
multiple photos. Keep the existing spreadsheet, API token, and photo folder.
The photo column will contain the links to all attached photos.

Google reads now share concurrent requests and cache the hotel data for 15 seconds
and photo bytes for 15 minutes (up to 32 MiB per server process). The **Actualiser**
button bypasses the data cache; saves invalidate it. Read requests retry once on
transient network errors or temporary Google failures. Legacy anomaly and round writes are never retried
automatically. New room inspections and family events use the durable, idempotent
queue described below. Photos remain authenticated, and failed images offer a retry button.
These application changes work with the existing three-photo Apps Script deployment;
publish a new application build to make them available on phones using the hosted site.
Process caches reset when a server restarts and are not shared between hosting instances.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
