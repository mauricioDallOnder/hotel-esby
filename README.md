# Hôtel Contrôle

## Modo escuro, checklist e acompanhamentos consistentes

O botão de lua/sol no topo alterna **Mode sombre / Mode clair**, inclusive na
tela de login. A primeira abertura acompanha a preferência do aparelho; uma
escolha manual fica salva neste navegador e é aplicada antes da exibição da página.
Os PDFs continuam com fundo claro para impressão.

- **Equipamentos OK:** o atalho agora inclui **Détecteur de fumée fonctionnel**.
  Respostas já preenchidas são preservadas. Um equipamento com um problema
  aberto correspondente continua exigindo verificação individual.
- **Minibar:** em **État et ménage**, a pergunta **Minibar / réfrigérateur présent ?**
  permite indicar **Oui / Non**. A ausência fica registrada nos equipamentos e
  dispensa a limpeza do minibar. A presença sozinha não confirma o funcionamento.
- **Celular:** os quartos da tournée usam uma grade de cartões de tamanho uniforme,
  com número, tempo desde o controle e indicação de prioridade.
- **Cafards:** o controle mostra o acompanhamento existente, seu estado e a última
  aplicação. Novas detecções acrescentam observações ao mesmo histórico por quarto.
  Se outro controle ou colega atualizar o caso, um formulário antigo não pode
  sobrescrever as informações recentes. O rascunho permanece acessível, inclusive
  após atualizar o app; **Recharger le suivi en conservant mes observations**
  recupera o estado e as datas atuais mantendo as notas digitadas.
- **Problemas técnicos:** um mesmo problema ainda aberto no mesmo quarto não pode
  ser criado novamente, pelo checklist ou pelo formulário manual. A tela oferece
  acesso ao signalement existente e confirma antes de abandonar uma nova saisie.
  A regra é conferida novamente na gravação, sob lock no Sheets. Problemas diferentes
  continuam permitidos; uma falha pode ser sinalizada novamente após resolução.
  Duplicatas históricas não são apagadas: continuam disponíveis para acompanhamento
  e resolução.

As fotos são preparadas uma por vez, com progresso e redução gradual para cumprir
o limite de envio. As galerias carregam as imagens próximas da área visível, reservam
espaço durante o carregamento e oferecem nova tentativa quando há falha. O cache é
privado e revalida o acesso autenticado, inclusive em respostas HTTP 304. Os PDFs
reutilizam esse carregamento e identificam anexos indisponíveis sem abandonar as
demais fotos. Atualizações periódicas sem mudanças reaproveitam os dados em memória;
uma leitura ou recibo antigo não faz um problema resolvido reaparecer como aberto.

### Atualização do Google Apps Script

**Antes de publicar esta versão do app**, substitua `google-apps-script/Code.gs`
no projeto existente e publique uma nova versão da implantação. Preserve a URL,
o token, a planilha, as chaves e os gatilhos atuais. As ações protegidas
`commitIssueV2`, `commitRoomInspectionV2` e `commitCafardFollowupV2` exigem o código
atualizado. A implantação antiga recusa a gravação com uma instrução de atualização;
controles e acompanhamentos enviados pela fila permanecem no aparelho.

Não há nova aba nem migração ou exclusão de registros para estes ajustes. As
anomalias permanecem em **Anomalies**, os controles em **Contrôles chambres** e as
atualizações de cafards em **Suivi quotidien**. O GitHub/Vercel não publica o Apps
Script automaticamente. Recarregue o aplicativo depois da atualização.

### Roteiro de conferência

| Área | Resultado esperado |
| --- | --- |
| Login e navegação | Alternância claro/escuro persistente; textos e controles legíveis. |
| Checklist | Atalho inclui fumaça; minibar ausente não exige limpeza; quartos uniformes. |
| Ocupação e rotação | Quarto livre fica fora da tournée; histórico permanece disponível. |
| Cafards | Uma ficha por quarto; nova detecção preserva tratamentos; rascunho antigo pode ser recuperado. |
| Problemas técnicos | Mesmo problema aberto é bloqueado; outro defeito ou recorrência após resolução é permitido. |
| Fotos e PDFs | Até três fotos, progresso, tentativa de recuperação e indicação de foto indisponível. |
| Sincronização | Envio sem conexão e repetição não duplicam registros; atualização antiga não desfaz intervenção. |
| Lingerie, objetos e famílias | Validações, revisões concorrentes e históricos existentes preservados. |

## Lingerie: máquinas, roupas e avisos

O menu **Lingerie** (`/lingerie`) permite que Employé e Direction acompanhem as
seis máquinas, separadas em dois grupos. A numeração corresponde às etiquetas
físicas: **1, 2 e 3 para lavar; 1, 2 e 3 para secar**.

| Equipamento | Capacidade | Programa | Tempo previsto |
| --- | --- | --- | --- |
| Machine à laver 1 | 18 kg | Rapide 40 | 44 min |
| Machines à laver 2 e 3 | 8 kg cada | Rapide 30 | 38 min |
| Machines à sécher 1, 2 e 3 | — | Séchage | 1 h 20 |

Depois de iniciar o programa na máquina física, toque em **Démarrer** no cartão
correspondente. Escolha o quarto e informe **Votre nom**; o nome é lembrado no
aparelho para os próximos registros. **Nom ou repère du linge** e a nota são
facultativos e ajudam a distinguir as roupas de pessoas do mesmo quarto. O app
registra a data e a hora, calcula o fim previsto e mostra a contagem regressiva.
Sair da página ou recarregá-la não reinicia o tempo.

Quando o tempo termina, a máquina continua ocupada. Nas lavadoras, use
**Terminé · prêt à sécher** depois de verificar o término e retirar as roupas para
secar. Nas secadoras, use **Linge récupéré** depois de retirar todas as roupas.
A confirmação registra a data, a hora e quem fez a retirada, e libera a máquina. **Annuler le cycle**
exige confirmação de que a máquina está parada e vazia, deixa um registro de
cancelamento no histórico e não inventa uma retirada. O cronômetro acompanha
o programa previsto; o aplicativo não está conectado eletronicamente às máquinas.

### Ajustar o tempo quando o programa ainda não terminou

Os novos ciclos usam **44 minutos na lavadora de 18 kg** (acréscimo de 4 minutos)
e **38 minutos nas duas de 8 kg** (acréscimo de 8 minutos). Os nomes dos programas
continuam Rapide 40 e Rapide 30. O horário previsto fica salvo com o ciclo;
registros e envios anteriores mantêm sua duração original de 40/30 minutos.

**Ajouter du temps** está disponível nas lavadoras e nas secadoras enquanto o
ciclo não for encerrado. Escolha os minutos adicionais e confirme. Durante o
programa, o tempo é somado ao fim previsto; se o cronômetro já zerou, os minutos
passam a contar a partir da confirmação. A mesma ficha mantém quarto, identificação
das roupas, início original, acréscimos e responsáveis. Recarregar a página ou
reenviar uma confirmação pendente não soma o tempo novamente.

Os avisos acompanham o novo horário. Um novo aviso de dez minutos só é previsto
quando restarem pelo menos dez minutos após o acréscimo; um acréscimo de cinco
minutos depois do zero gera o novo aviso de término. O histórico conserva os
acréscimos e o horário final previsto.

**Atualização a partir da primeira versão de Lingerie:** substitua o conteúdo
de `google-apps-script/Code.gs` e publique uma nova versão da implantação existente.
Reutilize as chaves e o gatilho já configurados. A ação `commitLaundryCycleV2`
exige o script atualizado para salvar os horários e os acréscimos com as mesmas
regras do aplicativo; enquanto isso, os envios ficam preservados na fila. Reabra
ou recarregue o aplicativo nos aparelhos usados para receber avisos, para carregar
a atualização do serviço de notificações.

**Historique** mostra os ciclos mais recentes primeiro, com pesquisa por quarto,
nome, máquina ou nota e filtros por período e estado. O mesmo quarto pode usar
várias máquinas, mas cada máquina só admite um ciclo ativo. Revisões por máquina
recusam reservas concorrentes e protegem um ciclo já iniciado em outro aparelho.
Os cartões são atualizados periodicamente enquanto o app está visível e ao voltar
à janela. **Actualiser** também permite conferir o estado compartilhado.

Rascunhos e ações ficam na fila persistente do aparelho quando falta conexão.
O cartão identifica o envio pendente. Outros aparelhos e o serviço de avisos só
recebem o registro após a sincronização; conflitos ficam visíveis para conferência.
O histórico é salvo como eventos `laundryCycle` em **Suivi quotidien**, usando
os identificadores distintos `washer-1` a `washer-3` e `dryer-1` a `dryer-3`.

### Ativar os lembretes em cada aparelho

Em **Les rappels de la lingerie**, toque em **Activer sur cet appareil** e aceite
a autorização do navegador. **Envoyer un test** verifica a exibição local de uma
notificação. **Désactiver sur cet appareil** revoga a inscrição daquele navegador.
Os avisos indicam o quarto e a máquina; não incluem nomes de moradores.

Há um aviso a partir dos **10 minutos restantes** e outro quando o tempo previsto
termina. Com a configuração abaixo, Web Push permite recebê-los mesmo com a página
fechada. O agendador verifica os ciclos aproximadamente a cada minuto; a chegada
também depende da Internet e dos ajustes do aparelho. No iPhone/iPad (iOS 16.4+),
adicione o site à tela inicial pelo Safari e abra-o por esse ícone antes de ativar.

Sem o agendador configurado ou sem autorização, o app informa a situação e conserva
os avisos visuais enquanto aberto. O fallback do navegador exige a página aberta
e o aparelho acordado. Os avisos antigos expiram: o de dez minutos deixa de valer
no fim do ciclo, e o de término expira quinze minutos depois. O cartão **À récupérer**
continua visível até a retirada, mesmo após esse prazo.

Com o serviço automático ativo, o app aguarda até 90 segundos pelo push e então
usa o aviso local se não houver confirmação de exibição; um push válido recebido
depois atualiza silenciosamente a mesma notificação.

### Publicação da Lingerie com Google Sheets

1. Atualize **`google-apps-script/Code.gs` e `google-apps-script/appsscript.json`**
   no projeto existente. Para exibir o manifesto no editor do Google, habilite
   **Mostrar o arquivo de manifesto appsscript.json** nas configurações do projeto.
   Execute `setup()` e publique uma nova versão da implantação Web App existente,
   preservando a URL e o `API_TOKEN`. A ação protegida `commitLaundryCycleV2` exige
   esse código atualizado: a implantação antiga rejeita os novos ciclos antes de
   gravar, e eles permanecem na fila do aparelho para reenvio.
2. Gere uma única vez as chaves VAPID em um terminal com as dependências instaladas:

   ```sh
   npx web-push generate-vapid-keys
   ```

   Configure no ambiente do servidor/Vercel e publique o aplicativo:

   ```dotenv
   VAPID_PUBLIC_KEY=CHAVE_PUBLICA_GERADA
   VAPID_PRIVATE_KEY=CHAVE_PRIVADA_GERADA
   VAPID_SUBJECT=mailto:SEU_EMAIL_DE_CONTATO
   ```

   Mantenha `STORAGE_DRIVER=sheets`, `GOOGLE_SCRIPT_URL` e `GOOGLE_API_TOKEN`
   existentes. As chaves devem permanecer estáveis entre publicações; não as
   coloque no GitHub. A chave pública é entregue pela API autenticada, sem variável
   `NEXT_PUBLIC_*`. A privada fica exclusivamente no servidor.
3. Nas **Propriedades do script** do Apps Script, adicione `LAUNDRY_APP_URL` com
   a origem HTTPS de produção do app, sem caminho nem barra final, por exemplo
   `https://seu-app.vercel.app`. Execute **`setupLaundryNotifications()`** e aceite
   as autorizações do Google para chamadas externas e gerenciamento de gatilhos.
   A função instala um único gatilho de minuto, preservando os demais gatilhos.
   Ela não é executada automaticamente pelo `setup()` geral.
4. Espere o primeiro disparo bem-sucedido do gatilho e ative os avisos em cada
   computador/celular. O app confirma quando o serviço está respondendo; até lá,
   orienta manter a página aberta. Teste um ciclo real para conferir os dois avisos
   no aparelho e os ajustes do sistema operacional.

O gatilho chama `POST /api/laundry/notifications/dispatch` usando o `API_TOKEN`
existente como credencial de servidor. As inscrições e o controle de envios ficam
na aba técnica **Notifications lingerie**, criada ao configurar/usar os avisos,
e nunca aparecem na resposta pública de dados do hotel. Há limite de 50 aparelhos,
reservas temporárias de envio e deduplicação por ciclo, aviso e aparelho. Para
evitar alertas obsoletos, o agendador confere novamente o ciclo ativo antes de enviar.

O GitHub/Vercel não atualiza o Apps Script automaticamente. No modo local, os
registros usam `data/hotel.json` e as inscrições usam o arquivo privado separado
`data/laundry-notifications.json`; não há agendador automático nesse modo.

## Checklist conforme a ocupação dos quartos

Os quartos marcados como **Libre** em **Occupation des chambres** ficam fora
de **Contrôle des chambres**. A regra vale para a lista, a pesquisa, os filtros,
a tournée, os atalhos para continuar ou retomar um controle e o PDF dos quartos
exibidos. Mesmo um quarto em mau estado deixa a tournée enquanto estiver livre.

Ao marcar novamente **Occupée**, o quarto volta ao checklist e segue as regras
normais da rotação. Quartos com ocupação **Non renseignée** continuam visíveis,
pois ainda não foram confirmados como livres. O checklist oferece um atalho
para atualizar a ocupação; os filtros **Libres** e **Ménage à faire** saem dessa tela.

Os contadores e o cálculo da tournée usam somente os quartos incluídos. A meta
efetiva é limitada à quantidade deles, mantendo a preferência diária salva.
Quando todos estiverem livres, a página informa que não há quartos a controlar.
As alterações aceitas na fila sem conexão também atualizam a lista imediatamente.

O histórico, os rascunhos e o relatório específico **Chambres libres** continuam
disponíveis. Este ajuste reutiliza os dados de ocupação existentes e não exige
migração da planilha nem atualização do Apps Script.

## Chauffage / radiateur no controle dos quartos

Em **Contrôle des chambres → Équipements**, o item **Chauffage / radiateur**
tem duas respostas: **Libre** (nada cobre ou esconde o radiador) e **Caché**.
É preciso verificá-lo antes de concluir um novo controle. O atalho dos equipamentos
restantes marca o radiador como **Libre**, preservando uma resposta já escolhida;
um problema conhecido continua exigindo resposta individual.

- **Libre** fica registrado no controle, sem criar um problema técnico.
- **Caché** gera um signalement em **Problèmes techniques**, com o quarto e o
  responsável pelo controle. Se o mesmo problema já estiver aberto, o controle
  é vinculado a ele. Um controle posterior **Libre** não encerra o problema
  automaticamente; o acompanhamento continua na ficha do problema.
- O histórico e o checklist em PDF mostram **Libre / Caché**. Controles antigos
  mantêm esse ponto como não informado. Rascunhos antigos recebem o campo como
  não verificado, para que a equipe o preencha.

Novos controles usam o formato v5. Os formatos anteriores e seus hashes de reenvio
são preservados, inclusive os controles que aguardam sincronização no aparelho.
A rotação continua reconhecendo os controles completos antigos sem exigir uma
resposta que ainda não existia.

O Apps Script atualizado com `commitRoomInspectionV2` grava o novo campo no JSON
da aba **Contrôles chambres** e aceita o problema automático sem migração.
O arquivo `google-apps-script/Code.gs` também adiciona uma coluna visível ao final
e reconhece descrições manuais de radiador coberto para evitar duplicatas.
Para aplicar essas duas melhorias na planilha, copie esse arquivo completo no
projeto Apps Script existente, execute `setup()` e publique uma nova versão da
implantação existente. As colunas e os dados anteriores mantêm suas posições.

## Objetos recolhidos dos quartos

O menu **Objets récupérés** (`/objets-recuperes`) permite que os perfis Employé e
Direction registrem e consultem os objetos guardados no armário. Cada objeto tem
sua própria ficha, mesmo quando vários pertencem ao mesmo quarto.

- Informe **Chambre**, o objeto, a data de recolhimento e **Récupéré par**. O motivo
  é facultativo. Os atalhos **Plaque de cuisson**, **Multiprise** e
  **Appareil > 100 W** ajudam a preencher o objeto; a descrição pode ser ajustada.
- Para um objeto sem identificação, selecione **Chambre non identifiée**. Ele
  permanece disponível na busca, nos filtros e no histórico, e pode ser devolvido
  normalmente. Se descobrir o quarto depois, use **Corriger la fiche** para
  informar o número. A ficha e seu histórico continuam sendo os mesmos.
- A página abre em **En armoire**. A busca encontra quarto, objeto, nomes e motivo,
  sem diferenciar maiúsculas ou acentos. Os filtros **Restitués** e **Tous** permitem
  consultar também as devoluções. As fichas mais recentemente recolhidas vêm primeiro.
- Use **Restituer** depois de entregar o objeto, informando a data e o nome de quem
  devolveu. O nome de quem recolheu permanece na ficha.
- As correções e o cancelamento de uma devolução registrada por engano geram novas
  versões. O histórico preserva os dados anteriores; não há exclusão definitiva.

Os nomes de quem recolheu e devolveu são preenchidos pela equipe: os perfis
compartilhados Employé e Direction não identificam automaticamente a pessoa.
O registro pode ser consultado por quarto para conferir a etiqueta do objeto.

Os rascunhos e envios pendentes usam o armazenamento já existente no aparelho.
Depois de restabelecida a conexão, a fila sincroniza as alterações sem duplicar
as fichas. Revisões concorrentes são recusadas explicitamente, preservando o
registro confirmado e os detalhes do envio em conflito para conferência.

Os eventos `collectedItem` ficam em **Suivi quotidien**, com um identificador por
objeto e um identificador por atualização. O Apps Script atual já aceita esse
tipo pelo `commitWorkEvent`; não é necessária uma nova aba nem uma atualização
adicional do script. Nenhum registro de objeto real é incluído no código público.

O menu e o título **Anomalies & suivi** passam a se chamar **Problèmes techniques**.
O endereço `/anomalies` e os registros existentes são preservados.

## Suivi des cafards

O menu **Suivi des cafards** (`/cafards`) reúne uma ficha por quarto, com os estados
**À vérifier**, **Cafards présents**, **Produit appliqué** e **Résolu**. A ficha
permite registrar a data da detecção, a aplicação do produto, a data de cada
atualização e a resolução, além do produto e das observações. O histórico
preserva os acompanhamentos anteriores e as aplicações já registradas.

O filtro **État du suivi** permite consultar os acompanhamentos em curso, todos
os estados ou um estado específico. A opção **À vérifier après traitement**
mostra somente os quartos cuja verificação já está prevista para hoje ou atrasada.
A busca por número de quarto pode ser combinada com esse filtro.

Para fichas em **Produit appliqué**, ou em **À vérifier** com uma aplicação
registrada, o aplicativo calcula uma verificação **7 dias corridos após a
última aplicação**. Isso inclui aplicações conhecidas do histórico antigo.
No dia previsto e enquanto a verificação estiver pendente, aparece um aviso na
tela inicial e em **Suivi des cafards**, com acesso aos quartos a verificar. A data prevista também
fica na ficha e no formulário. O cálculo usa o dia de **Europe/Paris** e se
atualiza com a página aberta ou ao voltar ao aplicativo. Datas desconhecidas
não geram um prazo inventado.

Depois da visita, atualize o estado para **Résolu** ou **Cafards présents**,
conforme o resultado. Para uma nova aplicação, mantenha **Produit appliqué** e
informe a nova data: o prazo de sete dias será recalculado. Os avisos são
exibidos no aplicativo; não alteram o estado nem criam registros automaticamente.

Ao marcar **Détectés** em cafards/nuisibles no controle do quarto, o próprio
controle alimenta esse menu. Essa resposta não cria uma nova anomalia. Outros
defeitos elegíveis do mesmo controle continuam indo para **Problèmes techniques**.
Marcar **Aucun** no controle não encerra um acompanhamento: confirme **Résolu**
na ficha. Uma detecção posterior à resolução reabre o acompanhamento; um envio
antigo que chega atrasado não deve reabrir um caso resolvido mais recentemente.

As fichas iniciais são montadas a partir das anomalias já carregadas pelo
aplicativo **após o login**. O código público não contém uma cópia dos registros,
observações, datas ou identificadores operacionais da planilha. As datas de
aplicação só aparecem quando há registro explícito; as desconhecidas ficam em
branco. Uma aplicação de gel, sozinha, deixa o caso **À vérifier**. A resolução
exige uma verificação negativa explícita, e uma observação posterior de presença
mantém o caso ativo.

As anomalias antigas são preservadas, pois várias também descrevem reparos de
hidráulica, equipamentos ou outros problemas. Seus dados alimentam o histórico
inicial do acompanhamento, sem excluir nem reescrever os registros originais.
Os novos acompanhamentos explícitos prevalecem sobre essa referência inicial.

As atualizações usam a fila existente, inclusive sem conexão, e são salvas como
eventos imutáveis de `cafardFollowup` em **Suivi quotidien**. Há controle de
revisão e reenvio idempotente. A interface mostra os envios pendentes ou recusados.
O Apps Script atualizado oferece `commitCafardFollowupV2`, que também confere
se houve nova detecção desde a abertura do formulário. Não há nova aba ou migração;
a implantação do script deve acompanhar esta versão do aplicativo.

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
  Ao marcar livre, o quarto sai do checklist e continua acessível no menu de ocupação.
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
**Rien de cassé** ou **Fenêtre fonctionnelle**, ou **Caché** em
**Chauffage / radiateur**. **Détectés** em cafards/nuisibles
alimenta o menu **Suivi des cafards**, sem gerar uma anomalia.
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
  equipamentos ainda sem resposta, incluindo detector e ferme-porte; itens já sinalizados
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
  usam termos reconhecidos em francês. Quando há mais de um signalement correspondente,
  o resumo permite escolher o vínculo entre eles. O antigo atalho para criar outro
  signalement do mesmo item foi retirado. Só constats elegíveis novos criam uma anomalia; vínculos,
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
`commitRoomInspectionV2`, que o script antigo rejeita antes de gravar: nesse caso
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

- `/checklist`: **Checklist des chambres**, com os quartos ocupados ou de ocupação
  ainda não informada, agrupados por andar. Há pesquisa, filtros e histórico individual.
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
  ainda não abertas. O service worker de Lingerie exibe notificações; ele não
  guarda páginas nem promete abertura completa offline. Com a tela carregada, os formulários novos podem
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
Os testes de navegador exigem um ambiente que permita iniciar o Chromium e acessar
o servidor local. O resultado das verificações executadas e eventuais limitações
de ambiente são registrados na descrição de cada pull request.

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
The duplicate-protected writes require the updated Apps Script deployment described
at the top of this README; publish a new application build after that update.
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
