---
name: modificar-hotel-esby
description: Modificar o aplicativo web Hôtel Contrôle (hotel-esby) quando Mauricio descrever uma mudança no projeto, inclusive por nome de tela no contexto do hotel. Atualizar o README e abrir um pull request por alteração solicitada.
---

# Manutenção do Hôtel Contrôle

Trabalhe no repositório `mauricioDallOnder/hotel-esby`. No Windows de Mauricio, a cópia de manutenção fica em `~/Documents/hotel-esby`. O ZIP `hotel-controle-presentation.zip` contém uma apresentação com capturas de tela. Para implementar mudanças, use o código versionado.

1. Confirme o endereço de `origin`, consulte o estado local e atualize as referências remotas. Para um pedido novo, crie uma branch a partir da branch padrão atual de `origin`. Se houver trabalho local em andamento, preserve-o usando um worktree separado. Para ajustes no mesmo PR, continue na branch dele.
2. Leia o `AGENTS.md` e localize o fluxo afetado. As telas ficam em `features/`, as rotas em `app/` e a integração com o Google Apps Script em `google-apps-script/`. Preserve o francês da interface. Use os comandos RTK no ambiente de Mauricio.
3. Implemente o pedido e atualize o `README.md` em francês no mesmo PR. Explique a mudança na seção correspondente e, quando mudar a interface, diga como a equipe usa a novidade. Para mudanças técnicas, mantenha a explicação breve e junto às notas de manutenção.
4. Escolha as verificações do `package.json` e da CI que cobrem o fluxo alterado. Para mudanças de documentação, confira o conteúdo e os links locais editados. Para mudanças na interface, verifique também o comportamento pela tela quando possível.
5. Revise o diff, faça commit dos arquivos do pedido e publique a branch. Abra um pull request para a branch padrão com o resumo e os resultados das verificações. Se a branch já tiver um PR aberto, atualize-o. Confira o destino e devolva o link a Mauricio em português. A conclusão deste fluxo é o PR aberto para revisão.
