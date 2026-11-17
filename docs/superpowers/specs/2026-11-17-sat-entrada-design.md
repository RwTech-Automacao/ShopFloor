# SAT — módulo de entrada de equipamentos (desenho)

Data: 17/11/2026 · Branch: `feat/sat-entrada` · Desenho aprovado em partes pelo usuário em 17/11.

## Contexto

Equipamento que volta do cliente para a fábrica: o técnico de suporte preenche um Google Form, um workflow do n8n
("Abertura de OS") grava na planilha "Peças em garantia" (uma linha por peça) e manda e-mail ao comercial. Quando o
equipamento chega, quem recebe preenche a ficha de papel FO-161 ("Equipamentos para assistência técnica"). Este
módulo substitui a **metade de entrada** da FO-161 e traz a planilha para o banco. A manutenção (metade de baixo da
ficha) fica para depois — vai precisar de integrações com o Compels.

## Decisões

1. **Módulo próprio `sat`** (fora do Recebimento), com permissões: `visualizar`, `registrar_entrada`, `aprovar_nf`,
   `administrar`. Entra em `MODULOS_SEM_FLAG_LEGADA` (não liga nenhuma `pode_*`).
2. **Identificador = número de série.** Guardado como digitado e normalizado em **modelo + sequência**:
   `00043005620019177` → 562/19177 (17 dígitos: modelo = dígitos 6–10, sequência = últimos 7, como o repinmetro);
   `430056219725` → 562/19725; `562 -19177` e `562-18276` → modelo/sequência pelo traço. A busca usa o par.
3. **Planilha → banco, lida pelo ShopFloor** (a planilha continua em uso em paralelo; o n8n não muda). A planilha está
   aberta a "qualquer pessoa com o link": leitura pelo export CSV por aba, sem credencial. Abas: "Garantia 2026 -
   Automação" (gid 2133071592), "Garantia 2025" (gid 1388582578), "Garantia 2025/2024" (gid 1801872756). As outras
   abas antigas ficam de fora por ora. Rodada de 10 em 10 minutos (cron da instância, mesmo esquema da baixa de NF) —
   acrescenta e atualiza; nunca escreve na planilha; linha apagada na planilha continua no banco. A importação inicial
   é a primeira rodada.
4. **Uma OS tem vários equipamentos e várias peças.** Tabela de OS + tabela de itens (OS × número de série × peça).
   Célula com vários números de série vira vários itens. Duplicadas entre abas (150 linhas de 2025 repetem a
   2025/2024) gravam uma vez (chave: OS + modelo/sequência + código da peça + data).
5. **Tela de entrada:** digita o número de série → mostra o que achar em: planilha (OS mais recente primeiro, já
   escolhida a última "Envio ao SAT"), repinmetro (revenda, saída da expedição, teste de produção, números de série
   das peças internas), ShopFloor (OP/produto se passou pela produção acompanhada), Compels (descrição do produto pelo
   código). Nada encontrado = entrada manual.
6. **Campos da entrada:** empresa, CNPJ e produto (sugeridos, editáveis); NF de entrada; valor unitário; frete de
   entrada (a cobrar / pago); itens que vieram junto (bobina, chave, fonte, outros + texto); defeito relatado (vem da
   OS, editável); **locação** (texto livre; vira lista quando as prateleiras forem identificadas); custo; NF
   **aprovada** ou **reprovada** (reprovada exige 1+ motivos). Data = hoje; responsável = usuário logado.
7. **NF depois da entrada** (permissão `aprovar_nf`): **corrigir** (a mesma nota muda de reprovada para aprovada) ou
   **trocar** (nota nova; a antiga fica como substituída). Tudo em histórico (quem, quando, de/para, motivos).
8. **Motivos de reprovação:** lista cadastrada pela tela de administração do módulo (`administrar`), começa vazia.
9. **Status v1:** "Recebido – NF aprovada" / "Recebido – NF reprovada". (Manutenção entra depois.)
10. **Discord** (mesmo bot dos Alertas; canal `SAT_DISCORD_CANAL_ID`, senão `DISCORD_CANAL_ID`): ao salvar a entrada
    ("📦 Chegou no SAT: <NS> (<cliente>, OS <n>) — NF <n> aprovada ✅ / reprovada ❌ (motivos)") e a cada mudança da NF.
    Falha no Discord não impede a gravação.
11. **Lista do SAT:** equipamentos recebidos com filtros (status da NF, cliente, número de série, período) e a ficha de
    cada um com o histórico.
12. Itens do SAT já cadastrados no Recebimento do ShopFloor: levados para o módulo depois, à parte (fora desta
    entrega).

## Banco (migrações novas, a partir de 0186)

- `sat_os` (número, data, técnico, cliente, equipamento, garantia, primeiro registro, defeito, solução, vendedor,
  observação, aba de origem, linha de origem, atualizado_em) e `sat_os_itens` (os, ns como escrito, modelo,
  sequência, código e nome da peça, quantidade).
- `sat_motivos_nf` (texto, ativo).
- `sat_entradas` (ns como digitado, modelo, sequência, os escolhida, empresa, cnpj, produto, nf, valor, frete,
  itens que vieram, defeito, locação, custo, situação da NF, motivos, responsável, data) e `sat_entradas_historico`.
- RLS no padrão `(select tem_permissao('sat', ...))`; escrita do usuário só por funções security definer; a
  sincronização da planilha usa a service role.

## Fora desta entrega

Manutenção (defeito encontrado, peça trocada, tempo, frete de saída, responsável pelo teste), integrações com o
Compels para a manutenção, lista de prateleiras, migração dos itens já cadastrados no Recebimento.

## Testes

Normalização do número de série (os formatos vistos nas abas); leitura das 3 abas (cabeçalho na linha 1 ou 2, colunas
diferentes, células com vários NS, duplicadas); entrada aprovada/reprovada (motivo obrigatório); corrigir e trocar NF
com histórico; mensagens do Discord; permissões (`sat` não liga `pode_*`; sem `registrar_entrada` não grava). SQL no
harness: RLS e funções.
