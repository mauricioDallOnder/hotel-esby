# Hôtel Contrôle

## Atualização: quartos livres, PDF e anomalias

No checklist, **Chambre occupée → Non** abre o campo obrigatório de ménage
(feito/não feito). Micro-ondas e frigobar presentes têm campos próprios de
limpeza. **Absent** em **Minibar fonctionnel** informa que não há frigobar.

Em `/checklist`, use **Exporter en PDF → Chambres libres**. O relatório inclui
o último controle de cada quarto livre, sua data, estado geral, ménage,
presença e limpeza dos equipamentos e problemas. Controles antigos sem esses
dados aparecem como não informados; registros aguardando envio são identificados.

Problemas, observações ou fotos do checklist geram uma anomalia após a
sincronização, com a descrição e as mesmas fotos. Reenvios não duplicam a
anomalia e preservam seu andamento/resolução. Registros históricos já salvos
não são convertidos retroativamente.

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
- Rondes, anomalies e relatórios existentes continuam disponíveis.

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

Both profiles can consult anomalies, report new ones, and carry out rounds.
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
