# Roteiro de smoke — Módulo Setup (montagem de setup + abastecimento)

Para testar no preview da branch `feat/setup-abastecimento`, com o banco Dev.

## 0. Preparação no Dev

1. No SQL Editor do Supabase (Dev), rode **nessa ordem**: `0110_setup_modulo_grants.sql`, `0111_setup_tabelas.sql`, `0112_setup_funcoes.sql`.
   - **Se o Dev já tinha as `st_*` de uma rodada anterior**, derrube as tabelas e as assinaturas antigas de `st_abrir_setup`, `st_incluir_item` e `st_trocar_rolo` antes de rodar a 0111 de novo (as três ganharam `p_colaborador`; o SQL está no relatório, em `.superpowers/sdd/colaborador-report.md`). Os dados de setup do Dev são de teste e podem ser descartados.
   - **Esperado:** as três rodam sem erro. Se alguma reclamar de `$$` (delimitador de função), é bug — o SQL Editor só aceita `$func$`. Todas as três já usam `$func$`.
   - Ao final da 0111 e da 0112, roda `notify pgrst, 'reload schema';` — não precisa fazer nada, é automático.
2. Vá em **Configurações → Perfis** e confira que o perfil do seu usuário de teste tem o módulo **Setup** com `visualizar`, `lancar` e `administrar` marcados (a 0110 já dá isso de graça pra quem administra o Sistema).
3. Escolha uma OP de teste que já exista no ShopFloor (Dev) e anote a **PMO**, a **OP** e a **faixa de SN** dela (vai precisar disso nos passos seguintes). Se quiser testar a importação da estrutura (passo 2), a PMO ideal é a **PMOG13** — se ela não existir no Dev, cadastre uma OP de teste com essa PMO antes de continuar.

## 1. Cadastros (Configurações → Ajustes Setup)

1. Abra **Configurações → Ajustes Setup → Linhas e Máquinas**.
   - **Esperado:** tabela com as colunas **Processo · Linha · Bloco · Máquina · Ativo**, com **4 equipamentos SMD** (Linha 1/Bloco A/MG5, Linha 1/Bloco A/YSM10, Linha 2/Bloco A/YSM10, Linha 3/Bloco A/CP40) e **12 PTH** (Linhas 1 a 6 × Blocos A e B, todos com **Máquina = "—"**).
   - Clique em **Novo equipamento**. Com **Processo = SMD** aparecem os campos **Linha**, **Bloco** e **Máquina**; troque para **PTH** e confirme que o campo **Máquina desaparece**. Não existe mais campo "Nº de posições".
   - Cadastre um SMD de teste (ex.: Linha 9, Bloco A, Máquina MAQTESTE) e confirme que ele aparece na lista com a máquina preenchida. Cadastre um PTH de teste (ex.: Linha 9, Bloco C) e confirme que a coluna Máquina mostra "—".
   - Tente cadastrar de novo exatamente o mesmo equipamento (mesmo processo, linha, bloco e máquina) — e, no PTH, a mesma linha e bloco. **Esperado:** toast "Esse equipamento já está cadastrado."
   - Desative um deles pelo interruptor da coluna "Ativo" e confirme que o estado muda. Depois volte em **Setup → Operação** e confirme que o equipamento desativado **não aparece** mais nos selects de Bloco/Máquina.
2. Abra **Configurações → Ajustes Setup → Estrutura da PMO** e selecione a PMO da sua OP de teste (ex.: PMOG13) no campo **PMO**.
3. Em **Importar composição do ERP**, escolha o arquivo `composicao_produto_com_preco_PMOG13.xlsx`.
   - **Esperado:** abre o diálogo **"Prévia da importação — PMO PMOG13"** com as seções **Novos** (75 componentes: 6 PTH, 69 SMD), **Processo alterado**, **Já existentes**, **Ignorados** (com o motivo de cada linha ignorada) e **Duplicados no arquivo**. O botão mostra "Importar 75 componentes" (ou o total de novos + processo-alterado).
   - Clique no botão de importar.
   - **Esperado:** toast (embaixo, centralizado) "Importado: 75 novos, 0 atualizados" (ou números equivalentes) e a tabela de componentes é atualizada, com os chips **SMD: 69** e **PTH: 6**.
4. Em **Adicionar componente à mão**, digite um código (ex.: `TESTE01`), marque SMD ou PTH e clique em **Adicionar**.
   - **Esperado:** toast "Componente TESTE01 adicionado" e a linha aparece na tabela com Origem "Manual".
5. Clique no ícone de lixeira da linha desse componente.
   - **Esperado:** diálogo de confirmação `Remover "TESTE01"?` com a descrição "O componente sai da estrutura da PMO. Não afeta setups já montados." Confirme e veja o toast "Componente TESTE01 removido" e a linha sumir.

## 2. Montar Setup do zero (SMD, Linha 1, YSM10, TOP)

1. Vá em **Setup → Operação** (aba **Montar Setup**, é a aba padrão).
2. Selecione a OP de teste, **Processo = SMD**, **Linha 1**, **Bloco A**, **Máquina YSM10**, **Face = TOP**. Os selects são em cascata (trocar o processo ou a linha limpa os de baixo) e só oferecem o que existe cadastrado e ativo. Num setup **PTH**, o select de **Máquina não aparece** — o equipamento é linha + bloco.
   - **Esperado:** abaixo dos campos aparece a descrição da OP e a faixa de SN (ou o aviso "OP sem faixa de SN cadastrada" se a OP não tiver faixa). Como não existe setup ainda, aparece o card **"Novo setup"**.
3. No card "Novo setup", o primeiro campo é **Colaborador** (já com o foco): bipe/digite o crachá de quem está montando. É **texto livre, sem nenhuma conferência** e **pode ficar em branco** — nada trava por causa dele. Enter passa o foco pro SN de Abertura.
4. No campo **SN de Abertura**, bipe/digite um SN **fora** da faixa da OP e clique em **Montar do zero**.
   - **Esperado:** painel de aviso com ícone amarelo (!) e a mensagem "O número de série não pertence à faixa da OP."
5. Agora digite um SN **dentro** da faixa e clique em **Montar do zero**.
   - **Esperado:** o setup abre — aparece o cabeçalho "OP .../... · Linha 1 · Bloco A · MG5 · TOP" (no formato `Linha · Bloco · Máquina · Face`; num setup PTH sai só "Linha 1 · Bloco A · TOP"), o badge amarelo **"Em montagem"**, "0 posições" e a área de bipe com os campos **Colaborador**, **Posição**, **Feeder** e **Rolo** — o Colaborador já vem preenchido com o crachá digitado na abertura.
6. Bipe as 3 posições, uma de cada vez (Colaborador → Posição → Feeder → Rolo → Enter avança o foco; Enter no campo Rolo envia):
   - Posição `1`, Feeder `F1`, Rolo `CAPJ41-TESTE1`
   - Posição `2`, Feeder `F2`, Rolo `RESR85-TESTE1`
   - Posição `3`, Feeder `F3`, Rolo `CIRB26-TESTE1`
   - **Esperado a cada bipe:** painel verde/ok "Posição cadastrada" com os chips Posição/Feeder/Componente/Rolo, o foco volta pro campo Posição e a tabela ganha uma linha, com o crachá na coluna **Colaborador** (`—` quando o campo está em branco).
   - **Colaborador persiste:** confira que ele **não** é limpo depois de gravar (nem ao trocar de OP/equipamento/face) — quem está no tablet bipa o crachá uma vez e segue bipando as posições. Troque o crachá no meio e confirme que as linhas novas saem com o nome novo e as antigas continuam com o antigo.
   - Os componentes `CAPJ41`, `RESR85` e `CIRB26` precisam estar na estrutura da PMO (da importação ou cadastrados à mão) — senão o teste do passo 7 abaixo ("fora da estrutura") já é esse mesmo caso.
7. Teste as recusas (todas devem mostrar o painel de aviso amarelo com som de erro, sem cadastrar nada):
   - **Componente fora da estrutura:** bipe Posição `4`, Feeder `F4`, Rolo com um prefixo que não existe na estrutura da PMO (ex.: `ZZZZ99-1`). Esperado: "Esse componente não está na estrutura da PMO."
   - **PTH num setup SMD:** bipe um rolo cujo componente está cadastrado como PTH na estrutura. Esperado: "Esse componente é de outro processo (SMD × PTH)."
   - **Posição com outro feeder:** tente bipar de novo a Posição `1` com um Feeder diferente (ex.: `F9`) e um rolo novo válido. Esperado: "Essa posição já está com outro feeder."
   - **Feeder em outra posição:** tente bipar uma posição nova (ex.: `5`) com o Feeder `F1` (já usado na posição 1) e um rolo novo válido. Esperado: "Esse feeder já está em outra posição."
   - **Rolo repetido:** tente bipar uma posição nova com o mesmo rolo já montado (ex.: `CAPJ41-TESTE1` de novo, em outra posição). Esperado: "Esse rolo já está montado em outra posição do setup."
   - **Rolo sem hífen:** digite um código sem separador (ex.: `CAPJ41TESTE1`) em qualquer posição livre. Esperado: "Código do rolo inválido. O formato é CÓDIGO-LOTE (ex.: CAPJ41-8521556004)." — e note que essa validação acontece **antes** de ir ao servidor (é local).
8. Clique em **Liberar setup**.
   - **Esperado:** diálogo "Liberar o setup?" com a descrição "Depois de liberado, só um administrador altera posições e feeders." Confirme e veja o badge virar verde **"Liberado"** e o toast "Setup liberado". Repare que o botão "Liberar setup" só aparece com pelo menos 1 posição e nenhuma sem rolo.

## 3. Copiar de OP anterior

Use outra OP de teste da **mesma PMO**, **mesmo equipamento** (Linha 1 / Bloco A / YSM10) e mesma face (TOP) do setup liberado acima.

1. Em **Montar Setup**, selecione essa outra OP com o mesmo Processo/Linha/Bloco/Máquina/Face. Repare que a lista de cópias sai por **equipamento**: mudar de máquina (ou de bloco) já é outro equipamento e a lista vem vazia ("Nenhum setup anterior dessa PMO nesse equipamento e face.").
2. No card "Novo setup", digite um SN de Abertura dentro da faixa dessa OP e clique em **Copiar de uma OP anterior**.
   - **Esperado:** lista aparece com o setup de origem, mostrando "OP ... · data · 3 posições · Liberado". Clique em **Copiar**.
3. **Esperado:** o novo setup abre já com as 3 posições, cada uma com o badge amarelo "falta bipar o rolo" na coluna "Rolo montado" e o **Colaborador vazio** (`—`) — ninguém bipou essas posições ainda. As linhas com esse badge ficam com fundo amarelo claro e são clicáveis (o clique preenche Posição/Feeder e foca o Rolo).
4. Clique numa dessas linhas e bipe um rolo de um **componente diferente** do cadastrado naquela posição.
   - **Esperado:** painel de aviso "O rolo é de um componente diferente do cadastrado nessa posição."
5. Complete as 3 posições com os rolos certos (mesmo prefixo de componente da posição copiada) e clique em **Liberar setup**.
   - **Esperado:** cada posição preenchida passa a mostrar na coluna **Colaborador** o crachá de quem bipou o rolo (o campo Colaborador que está na tela naquele momento).
   - **Esperado:** mesma confirmação do passo anterior; badge vira "Liberado".

## 4. Abastecimento (troca de rolo)

Use o primeiro setup liberado (item 2).

1. Vá na aba **Abastecimento** (dentro de Setup → Operação) e selecione a mesma OP/Processo/Linha/Bloco/Máquina/Face do setup liberado.
   - **Esperado:** cabeçalho do setup e os campos de bipe: **Colaborador**, **Posição**, **Feeder**, **Rolo que sai**, **Rolo que entra**, **SN Inicial**, e a lista **Últimas trocas** (vazia: "Nenhuma troca registrada nesse setup.").
2. **Troca certa:** Colaborador (crachá de quem está abastecendo — livre e opcional, igual ao de Montar Setup), Posição `1`, Feeder `F1`, Rolo que sai `CAPJ41-TESTE1` (o que está montado), Rolo que entra `CAPJ41-TESTE2`, SN Inicial dentro da faixa da OP.
   - **Esperado:** painel com ícone verde (✓) "Troca aprovada — pode seguir" com os 5 chips preenchidos; os campos de bipe limpam (o **Colaborador continua preenchido**) e o foco volta pra Posição; a tabela "Últimas trocas" ganha uma linha com badge verde "Aprovado"; toca um som de confirmação (silencioso comparado ao de erro).
3. **Rolo que sai antigo (repete a troca com o rolo antigo):** Posição `1`, Feeder `F1`, Rolo que sai `CAPJ41-TESTE1` de novo (já não é mais o montado), Rolo que entra `CAPJ41-TESTE3`, SN dentro da faixa.
   - **Esperado:** painel vermelho (✗) "Troca reprovada — confira o componente" com o motivo **"O rolo montado na posição 1 é CAPJ41-TESTE2, não CAPJ41-TESTE1."**. Os campos **não** são limpos (só o necessário) e o foco vai para o campo **"Rolo que sai"** com o texto selecionado — bipe um novo valor e ele **substitui** o que estava lá, não concatena.
4. **Componente diferente:** Posição `1`, Feeder `F1`, Rolo que sai `CAPJ41-TESTE2` (certo), Rolo que entra de outro componente (ex.: `RESR85-TESTE9`), SN válido.
   - **Esperado:** reprovado com "Componente diferente: sai CAPJ41, entra RESR85."
5. **Mesmo rolo:** Rolo que sai e Rolo que entra iguais (ex.: `CAPJ41-TESTE2` nos dois).
   - **Esperado:** reprovado com "O rolo que entra é o mesmo que sai."
6. **SN fora da faixa:** troca correta de componente, mas SN Inicial fora da faixa da OP.
   - **Esperado:** reprovado com "O SN ... não pertence à faixa da OP." (a troca é registrada mesmo reprovada).
7. **Posição inexistente:** digite uma posição que não existe nesse setup (ex.: `99`).
   - **Esperado:** reprovado com "A posição 99 não existe nesse setup." (no PTH, o texto usa "posto" no lugar de "posição").
8. Confira a lista **Últimas trocas**: cada linha reprovada mostra o(s) motivo(s) em vermelho abaixo da linha; a coluna **Operador** mostra seu nome (usuário logado) e a coluna **Colaborador**, ao lado, o crachá bipado (`—` quando em branco). Faça uma troca **sem** preencher o Colaborador e confirme que ela é aceita normalmente.
9. Confirme que toda reprovação (steps 3–7) tocou o som de erro e toda aprovação (step 2) tocou o som de sucesso.

## 5. Edição admin + histórico

1. No setup liberado do item 2, com seu usuário **administrador** (permissão `administrar`), volte pra **Montar Setup**, localize o mesmo setup e clique no ícone de lápis de uma posição.
   - **Esperado:** diálogo "Editar posição 1" (ou "Editar posto ..." no PTH) com os campos Posição/Feeder e o aviso "A alteração fica registrada no histórico do setup."
2. Troque o valor do feeder (ex.: de `F1` pra `F1B`) e clique em **Salvar**.
   - **Esperado:** toast "Alteração salva" e a tabela reflete o novo feeder.
3. Vá em **Setup → Consultas → Setups**, procure esse setup (filtro por OP) e clique na linha pra abrir o diálogo de detalhes.
   - **Esperado:** seção **"Histórico de alterações"** com uma linha do tipo **"Troca de feeder"**, mostrando "Antes → Depois" com os valores posição/feeder antigos e novos, data/hora e seu nome de usuário.
4. Repita o passo 1 logado com um usuário que tem Setup **sem** `administrar` (só `visualizar`/`lancar`).
   - **Esperado:** o ícone de lápis (editar) **não aparece** na tabela para esse usuário — só o de remover (se o setup estiver em montagem) some também, já que "remover" também some quando liberado e sem administrar.

## 6. Consultas

1. Em **Setup → Consultas → Setups**: use os filtros (PMO, OP, Cliente, Processo, **Linha**, **Bloco**, **Máquina**, Face, Estado) e clique em **Consultar**.
   - **Esperado:** a tabela tem colunas **Linha · Bloco · Máquina** separadas (Máquina = "—" nos setups PTH); **Limpar filtros** zera tudo e volta pro estado "Use os filtros e clique em Consultar."
   - **Cascata dos filtros:** escolher Processo limpa Linha/Bloco/Máquina; escolher Linha limpa Bloco/Máquina; escolher Bloco limpa Máquina. Com **Processo = PTH** o filtro **Máquina** fica só com "Todas" (nenhum PTH tem máquina).
   - Filtre por **Bloco A** sem escolher máquina e confirme que vêm os setups de todas as máquinas daquele bloco.
   - No diálogo, confira que o cabeçalho traz **Colaborador** (o crachá de quem abriu o setup) ao lado do processo e do SN de Abertura, e que a tabela de itens tem a coluna **Colaborador**.
   - Clique numa linha e use o campo **"Buscar posição, feeder, componente ou rolo"** dentro do diálogo — confirme que o termo aparece destacado (marca-texto amarela) nas linhas que baterem e que o título traz `OP … · Linha 1 · Bloco A · MG5 · TOP`.
2. Em **Setup → Consultas → Trocas de rolo**: filtre por data (De/Até vêm com a data de hoje), PMO, OP, Processo, **Linha**, **Bloco**, **Máquina**, Resultado, Posição, Rolo, SN Inicial.
   - **Esperado:** a coluna "Linha · Equipamento · Face" mostra `Linha 1 · Bloco A · MG5 · TOP` (no PTH, `Linha 1 · Bloco A · TOP`), e as colunas **Operador** e **Colaborador** vêm lado a lado no fim da tabela.
   - Faça uma consulta com mais de 100 resultados (ou ajuste o filtro pra ter poucos) e confira a paginação: os botões **Anterior**/**Próxima** navegam e o rodapé mostra "N trocas · página X de Y".
   - **Paginação mantém o filtro consultado:** depois de consultar, mude um campo do filtro (ex.: o campo Rolo) **sem** clicar em Consultar de novo, e clique em **Próxima**. Esperado: a navegação usa o filtro que foi efetivamente consultado (o texto novo digitado é ignorado até você clicar em Consultar de novo).
   - Clique em **Exportar CSV** e abra o arquivo `trocas-de-rolo.csv` no Excel.
   - **Esperado:** abre com os acentos corretos (não vira "Ã§Ã£o" etc — o arquivo tem BOM), separador `;`, e as colunas **Processo · Linha · Bloco · Máquina** separadas: numa troca de **PTH** a coluna **Máquina vem vazia**; numa de SMD vem o nome da máquina (ex.: `YSM10`). A última coluna é **Colaborador**, logo depois de **Operador** (vazia nas trocas feitas sem crachá).

## 7. Permissões

1. Com um usuário que só tem o módulo **Setup** (sem nenhuma permissão de ShopFloor), abra **Setup → Operação**.
   - **Esperado:** o seletor de OP mostra as OPs normalmente (o módulo Setup lê as OPs do ShopFloor direto, independente da permissão de ShopFloor do usuário).
2. Com um usuário **sem** nenhuma permissão de Setup (`visualizar`/`lancar`/`administrar` todos desmarcados):
   - **Esperado:** o grupo **"Setup"** não aparece no menu lateral.
   - Digite a URL `/setup/operar/montar` direto na barra de endereços.
   - **Esperado:** é redirecionado para `/home`.

## 8. Erro de rede (opcional)

1. No tablet/notebook de teste, com o setup liberado aberto em **Abastecimento**, desligue o Wi-Fi e tente enviar uma troca.
   - **Esperado:** painel de aviso "Falha de conexão. Confira em Últimas trocas se a troca foi registrada antes de reenviar." e o foco volta pro campo Posição (evita reenviar com tudo preenchido e gerar uma reprovação por engano).
2. Faça o mesmo em **Montar Setup**, trocando de seleção (OP/equipamento/face) sem rede.
   - **Esperado:** "Não foi possível procurar o setup. Verifique a conexão, troque a face ou o equipamento e volte pra tentar de novo."
3. Religue o Wi-Fi e confirme que a tela volta a funcionar normalmente.
4. Ainda sem rede, em **Montar Setup** com um setup em montagem aberto, bipe Colaborador/Posição/Feeder/Rolo completos e confirme.
   - **Esperado:** painel de aviso "Falha de conexão. Confira a lista antes de bipar de novo." e a tela **não** quebra (sem tela de erro do Next) — a lista tenta recarregar sozinha.
5. Confirme também que **Remover**, **Liberar setup** e **Salvar** (edição admin) sem rede mostram um toast de erro (embaixo) em vez de derrubar a tela.

## 9. Detalhes desta rodada de correções

1. **Bipe substitui o campo selecionado depois de uma recusa:** em **Montar Setup**, quando uma recusa devolve o foco para Posição/Feeder/Rolo (ex.: rolo inválido, componente fora da estrutura), bipe/digite um valor novo sem apagar antes — o texto anterior tem que ser **substituído**, não concatenado (o campo já vem com o conteúdo selecionado). Vale também pro **Colaborador**: ao focar, o crachá antigo já vem selecionado e o bipe novo substitui.
2. **Colaborador (campo novo):** é só registro de quem fez e conviver com o usuário logado — **nada é conferido** e **em branco é aceito** em todos os pontos (abrir setup, bipar item, trocar rolo). Grava em três lugares: setup (quem abriu), item (quem bipou) e troca (quem trocou). Numa troca aprovada, a coluna Colaborador do **item** continua sendo a de quem montou; a de quem trocou fica em **Últimas trocas** / Consultas.
3. **Filtro Cliente em Setups:** em **Setup → Consultas → Setups**, digite parte do nome do cliente de uma OP de teste (o cliente vem de `sf_ordens`) e confirme que só os setups dessa OP (e de outras OPs do mesmo cliente) aparecem. Um cliente que não bate com nenhuma OP deve devolver a tabela vazia.
4. **Usuário só com `visualizar`:** confirme que **Setup → Consultas** funciona normalmente (lista e abre os detalhes) e que em **Setup → Operação** os campos de bipe de **Montar Setup** e **Abastecimento** ficam bloqueados/ocultos (sem `lancar`, não é possível abrir, copiar ou bipar nada).
5. **Usuário só com o módulo Setup, sem nenhum módulo do ShopFloor:** confirme que a lista de OPs aparece normalmente no seletor (ela vem de `st_listar_ordens`, direto do ShopFloor, independente da permissão do usuário nesse módulo). Se a lista vier **vazia**, o problema é o owner/RLS de `sf_ordens` (a função é `security definer`, então não deveria depender do RLS do usuário — mas vale confirmar).
6. **Nota:** a 0110 dá o módulo Setup só aos perfis que já têm `sistema.administrar`. Para os operadores de chão de fábrica testarem, é preciso ir em **Configurações → Perfis** e marcar `visualizar`/`lancar`/`administrar` de Setup no perfil deles.

## 10. Pergunta em aberto (chão de fábrica)

No **PTH**, um mesmo saquinho/rolo alimenta várias locações do mesmo posto (ou de postos diferentes)? Hoje, se o mesmo rolo for bipado numa segunda locação, o sistema recusa com "Esse rolo já está montado em outra posição do setup." — precisa confirmar com o pessoal do chão de fábrica se esse comportamento está certo ou se o PTH tem um caso legítimo de um rolo/saquinho abastecer mais de uma locação.
