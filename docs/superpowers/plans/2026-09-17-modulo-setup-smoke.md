# Roteiro de smoke — Módulo Setup (montagem de setup + abastecimento)

Para testar no preview da branch `feat/setup-abastecimento`, com o banco Dev.

## 0. Preparação no Dev

1. No SQL Editor do Supabase (Dev), rode **nessa ordem**: `0110_setup_modulo_grants.sql`, `0111_setup_tabelas.sql`, `0112_setup_funcoes.sql`.
   - **Esperado:** as três rodam sem erro. Se alguma reclamar de `$$` (delimitador de função), é bug — o SQL Editor só aceita `$func$`. Todas as três já usam `$func$`.
   - Ao final da 0111 e da 0112, roda `notify pgrst, 'reload schema';` — não precisa fazer nada, é automático.
2. Vá em **Configurações → Perfis** e confira que o perfil do seu usuário de teste tem o módulo **Setup** com `visualizar`, `lancar` e `administrar` marcados (a 0110 já dá isso de graça pra quem administra o Sistema).
3. Escolha uma OP de teste que já exista no ShopFloor (Dev) e anote a **PMO**, a **OP** e a **faixa de SN** dela (vai precisar disso nos passos seguintes). Se quiser testar a importação da estrutura (passo 2), a PMO ideal é a **PMOG13** — se ela não existir no Dev, cadastre uma OP de teste com essa PMO antes de continuar.

## 1. Cadastros (Configurações → Ajustes Setup)

1. Abra **Configurações → Ajustes Setup → Linhas e Máquinas**.
   - **Esperado:** lista com **4 linhas SMD** (Linha 1/YSM10, Linha 1/MG5, Linha 2/YSM10 com 148 posições, Linha 3/CP40) e **12 linhas PTH** (Linhas 1 a 6, cada uma com Bloco A e Bloco B — a coluna "Máquina/Bloco" mostra "Bloco A"/"Bloco B").
   - Clique em **Novo equipamento**, cadastre um equipamento de teste (ex.: SMD, Linha 9, MAQTESTE) e confirme que ele aparece na lista. Desative-o pelo interruptor da coluna "Ativo" e confirme que o estado muda.
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
2. Selecione a OP de teste, **Processo = SMD**, **Linha 1**, máquina **YSM10**, **Face = TOP**.
   - **Esperado:** abaixo dos campos aparece a descrição da OP e a faixa de SN (ou o aviso "OP sem faixa de SN cadastrada" se a OP não tiver faixa). Como não existe setup ainda, aparece o card **"Novo setup"**.
3. No campo **SN de Abertura**, bipe/digite um SN **fora** da faixa da OP e clique em **Montar do zero**.
   - **Esperado:** painel de aviso com ícone amarelo (!) e a mensagem "O número de série não pertence à faixa da OP."
4. Agora digite um SN **dentro** da faixa e clique em **Montar do zero**.
   - **Esperado:** o setup abre — aparece o cabeçalho "OP .../... · Linha 1 · YSM10 · TOP", o badge amarelo **"Em montagem"**, "0 posições" e a área de bipe com os campos **Posição**, **Feeder** e **Rolo**.
5. Bipe as 3 posições, uma de cada vez (Posição → Feeder → Rolo → Enter avança o foco; Enter no campo Rolo envia):
   - Posição `1`, Feeder `F1`, Rolo `CAPJ41-TESTE1`
   - Posição `2`, Feeder `F2`, Rolo `RESR85-TESTE1`
   - Posição `3`, Feeder `F3`, Rolo `CIRB26-TESTE1`
   - **Esperado a cada bipe:** painel verde/ok "Posição cadastrada" com os chips Posição/Feeder/Componente/Rolo, a posição some do foco (volta pro campo Posição) e a tabela ganha uma linha.
   - Os componentes `CAPJ41`, `RESR85` e `CIRB26` precisam estar na estrutura da PMO (da importação ou cadastrados à mão) — senão o teste do passo 6 abaixo ("fora da estrutura") já é esse mesmo caso.
6. Teste as recusas (todas devem mostrar o painel de aviso amarelo com som de erro, sem cadastrar nada):
   - **Componente fora da estrutura:** bipe Posição `4`, Feeder `F4`, Rolo com um prefixo que não existe na estrutura da PMO (ex.: `ZZZZ99-1`). Esperado: "Esse componente não está na estrutura da PMO."
   - **PTH num setup SMD:** bipe um rolo cujo componente está cadastrado como PTH na estrutura. Esperado: "Esse componente é de outro processo (SMD × PTH)."
   - **Posição com outro feeder:** tente bipar de novo a Posição `1` com um Feeder diferente (ex.: `F9`) e um rolo novo válido. Esperado: "Essa posição já está com outro feeder."
   - **Feeder em outra posição:** tente bipar uma posição nova (ex.: `5`) com o Feeder `F1` (já usado na posição 1) e um rolo novo válido. Esperado: "Esse feeder já está em outra posição."
   - **Rolo repetido:** tente bipar uma posição nova com o mesmo rolo já montado (ex.: `CAPJ41-TESTE1` de novo, em outra posição). Esperado: "Esse rolo já está montado em outra posição do setup."
   - **Rolo sem hífen:** digite um código sem separador (ex.: `CAPJ41TESTE1`) em qualquer posição livre. Esperado: "Código do rolo inválido. O formato é CÓDIGO-LOTE (ex.: CAPJ41-8521556004)." — e note que essa validação acontece **antes** de ir ao servidor (é local).
7. Clique em **Liberar setup**.
   - **Esperado:** diálogo "Liberar o setup?" com a descrição "Depois de liberado, só um administrador altera posições e feeders." Confirme e veja o badge virar verde **"Liberado"** e o toast "Setup liberado". Repare que o botão "Liberar setup" só aparece com pelo menos 1 posição e nenhuma sem rolo.

## 3. Copiar de OP anterior

Use outra OP de teste da **mesma PMO**, mesma máquina (Linha 1/YSM10) e mesma face (TOP) do setup liberado acima.

1. Em **Montar Setup**, selecione essa outra OP com o mesmo Processo/Linha/Máquina/Face.
2. No card "Novo setup", digite um SN de Abertura dentro da faixa dessa OP e clique em **Copiar de uma OP anterior**.
   - **Esperado:** lista aparece com o setup de origem, mostrando "OP ... · data · 3 posições · Liberado". Clique em **Copiar**.
3. **Esperado:** o novo setup abre já com as 3 posições, cada uma com o badge amarelo "falta bipar o rolo" na coluna "Rolo montado". As linhas com esse badge ficam com fundo amarelo claro e são clicáveis (o clique preenche Posição/Feeder e foca o Rolo).
4. Clique numa dessas linhas e bipe um rolo de um **componente diferente** do cadastrado naquela posição.
   - **Esperado:** painel de aviso "O rolo é de um componente diferente do cadastrado nessa posição."
5. Complete as 3 posições com os rolos certos (mesmo prefixo de componente da posição copiada) e clique em **Liberar setup**.
   - **Esperado:** mesma confirmação do passo anterior; badge vira "Liberado".

## 4. Abastecimento (troca de rolo)

Use o primeiro setup liberado (item 2).

1. Vá na aba **Abastecimento** (dentro de Setup → Operação) e selecione a mesma OP/Processo/Linha/Máquina/Face do setup liberado.
   - **Esperado:** cabeçalho do setup e os campos de bipe: **Posição**, **Feeder**, **Rolo que sai**, **Rolo que entra**, **SN Inicial**, e a lista **Últimas trocas** (vazia: "Nenhuma troca registrada nesse setup.").
2. **Troca certa:** Posição `1`, Feeder `F1`, Rolo que sai `CAPJ41-TESTE1` (o que está montado), Rolo que entra `CAPJ41-TESTE2`, SN Inicial dentro da faixa da OP.
   - **Esperado:** painel com ícone verde (✓) "Troca aprovada — pode seguir" com os 5 chips preenchidos; os campos limpam e o foco volta pra Posição; a tabela "Últimas trocas" ganha uma linha com badge verde "Aprovado"; toca um som de confirmação (silencioso comparado ao de erro).
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
8. Confira a lista **Últimas trocas**: cada linha reprovada mostra o(s) motivo(s) em vermelho abaixo da linha; a coluna Operador mostra seu nome.
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

1. Em **Setup → Consultas → Setups**: use os filtros (PMO, OP, Processo, Linha, Máquina/Bloco, Face, Estado) e clique em **Consultar**.
   - **Esperado:** tabela filtrada; **Limpar filtros** zera tudo e volta pro estado "Use os filtros e clique em Consultar."
   - Clique numa linha e use o campo **"Buscar posição, feeder, componente ou rolo"** dentro do diálogo — confirme que o termo aparece destacado (marca-texto amarela) nas linhas que baterem.
2. Em **Setup → Consultas → Trocas de rolo**: filtre por data (De/Até vêm com a data de hoje), PMO, OP, Processo, Linha, Máquina/Bloco, Resultado, Posição, Rolo, SN Inicial.
   - Faça uma consulta com mais de 100 resultados (ou ajuste o filtro pra ter poucos) e confira a paginação: os botões **Anterior**/**Próxima** navegam e o rodapé mostra "N trocas · página X de Y".
   - **Paginação mantém o filtro consultado:** depois de consultar, mude um campo do filtro (ex.: o campo Rolo) **sem** clicar em Consultar de novo, e clique em **Próxima**. Esperado: a navegação usa o filtro que foi efetivamente consultado (o texto novo digitado é ignorado até você clicar em Consultar de novo).
   - Clique em **Exportar CSV** e abra o arquivo `trocas-de-rolo.csv` no Excel.
   - **Esperado:** abre com os acentos corretos (não vira "Ã§Ã£o" etc — o arquivo tem BOM), separador `;`, e a coluna "Máquina/Bloco" mostra, para uma troca de PTH, o valor no formato **"Bloco A"** (não só "A").

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
2. Faça o mesmo em **Montar Setup**, trocando de seleção (OP/máquina/face) sem rede.
   - **Esperado:** "Não foi possível procurar o setup. Verifique a conexão e escolha a face de novo."
3. Religue o Wi-Fi e confirme que a tela volta a funcionar normalmente.
