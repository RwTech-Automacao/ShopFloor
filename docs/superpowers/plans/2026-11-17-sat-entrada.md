# Plano — SAT: entrada de equipamentos e planilha "Peças em garantia" no banco

Spec: `docs/superpowers/specs/2026-11-17-sat-entrada-design.md` · Branch: `feat/sat-entrada`.
Cada tarefa: teste primeiro (vermelho), código, verde, `tsc` + `eslint` nos arquivos mexidos, commit.
Verificação: `npx vitest run --maxWorkers=2 <caminhos>`, `npx tsc --noEmit -p .`, `npx eslint <caminhos>`,
SQL no harness (`supabase/tests/rodar-sat-test.sh`, Postgres descartável em Docker).

Molde: o módulo `faturamento` (permissão sem flag, migração 0185 + harness, rota do cron fora da sessão).

## Tarefa 1 — Permissão própria `sat` (visualizar, registrar_entrada, aprovar_nf, administrar)

Arquivos: `src/modules/auth/domain/perfil.ts`, `modulos.ts`, `mapear-perfil.ts`,
`src/modules/perfis/domain/regras-perfil.ts` (+ testes em `__tests__` de cada um).

- `Permissao` ganha `'registrar_entrada' | 'aprovar_nf'` (sem coluna `pode_*`).
- `Modulo` ganha `'sat'`; `MODULOS` ganha `{ sat, 'SAT (assistência técnica)' }`;
  `PERMISSOES_POR_MODULO.sat = ['visualizar', 'registrar_entrada', 'aprovar_nf', 'administrar']`;
  `mapearPerfil` inicializa `sat: {}`; `PERMISSOES` ganha os rótulos.
- **Segurança:** `MODULOS_SEM_FLAG_LEGADA` ganha `'sat'`. Teste: nenhuma das 4 liga `pode_*`
  (em especial `sat.visualizar` → `pode_visualizar` abriria as tabelas do ShopFloor, e `sat.administrar` →
  `pode_administrar` daria escrita nelas).

## Tarefa 2 — Número de série (`src/modules/sat/domain/numero-serie.ts`)

- `normalizarNs(texto)` → `{ escrito, modelo, sequencia }` (modelo/sequência sem zeros à esquerda):
  17 dígitos `00043 00562 0019177` → 562/19177; compacto `43 00562 19725` → 562/19725; com traço
  `562 -19177` / `562-15382` → pelo traço; ilegível (`-`, texto) → `null/null`; só dígitos sem o prefixo 43
  → modelo `null`, sequência = os dígitos sem zeros (busca só pela sequência).
- `nsDaCelula(celula)` → lista de NS: separa por espaço/quebra de linha/vírgula/ponto e vírgula, mantendo
  `562 -19177` junto; descarta pedaços sem dígito quando há algum com dígito; célula vazia → `[]`.
- `chaveDoNs(n)` → `modelo/sequencia`, `seq:<sequencia>` ou `txt:<escrito normalizado>` (dedup).

## Tarefa 3 — Leitura da planilha (`src/modules/sat/domain/csv.ts`, `planilha.ts`)

- `lerCsv(texto)`: RFC 4180 (aspas, aspas dobradas, quebra de linha dentro de aspas, CRLF).
- `lerAba(csv, aba)`: acha o cabeçalho nas 3 primeiras linhas (a que tem `EQUIPAMENTO` e `PEÇA`), mapeia
  colunas por apelido sem acento/maiúscula (`DATA`/`DATA DO ENVIO`, `TÉCNICO`/`SOLICITANTE`,
  `NS`/`NUMERO DE SÉRIE`, `OS`/`NÚMERO DO CHAMADO NO SYSAID`, `VENDEDOR`/`VENDEDOR RESPONSÁVEL`,
  `ALGUMA OBSERVAÇÃO?`/`OBSERVAÇÃO`, `GARANTIA…`), pula linhas vazias; data `d/m/aaaa[ hh:mm:ss]` → `aaaa-mm-dd`.
- `montarOs(linhas por aba, em ordem de prioridade)` → OS (chave = nº da OS; sem OS = `sem-os|data|cliente|equip`)
  com campos do 1º valor não vazio e itens (um por NS × peça); duplicada (chave OS + NS + código da peça + data)
  grava uma vez. `cnpjDoCliente(texto)` separa o CNPJ do nome do cliente.
- Testes com CSVs SINTÉTICOS montados com os cabeçalhos das 3 abas (nada da planilha real).

## Tarefa 4 — Migração `supabase/migrations/0186_sat_entrada.sql` + harness

- Tabelas `sat_os`, `sat_os_itens`, `sat_motivos_nf`, `sat_entradas`, `sat_entradas_historico`.
- RLS de leitura `(select tem_permissao('sat','visualizar'))` (InitPlan); sem policy de escrita.
- Funções security definer: `sat_sincronizar_planilha(jsonb)` (só service_role), `sat_consultar_ns(text,text,text)`
  (visualizar; repinmetro + ShopFloor, que o perfil do SAT não lê), `sat_registrar_entrada(jsonb)`
  (registrar_entrada), `sat_corrigir_nf`, `sat_trocar_nf` (aprovar_nf), `sat_motivo_salvar` (administrar).
- Teste `supabase/tests/sat_test.sql` + `rodar-sat-test.sh` (stubs, reaplicação 2x, transação única, InitPlan).

## Tarefa 5 — Regras da entrada, escolha da OS e mensagens (`src/modules/sat/domain/entrada.ts`, `mensagens.ts`)

- `validarEntrada(input)`: NS e NF obrigatórios; reprovada exige 1+ motivo; aprovada sem motivo; valor/custo
  ≥ 0; frete `a_cobrar|pago`; `outros` exige o texto.
- `ordenarOs` (mais recente primeiro) e `osSugerida` (a última com solução "Envio ao SAT", senão a mais recente).
- `mensagemEntrada`, `mensagemCorrecaoNf`, `mensagemTrocaNf` (Discord). `rotuloStatus`.

## Tarefa 6 — Sincronização da planilha (cron)

- `src/modules/sat/infra/planilha-google.ts` (export CSV por gid; `SAT_PLANILHA_ID`, `SAT_PLANILHA_GIDS`).
- `src/modules/sat/application/sincronizar-planilha.ts` (portas: baixar aba, gravar lote) + teste.
- `src/modules/sat/infra/os-repository.ts` (`gravarOsDoServico`: rpc em lotes, service role).
- `src/app/api/sat/sincronizar-planilha/route.ts` (Bearer `ESTOQUE_CRON_SECRET`, `segredoConfere`, uma rodada
  por vez) + `src/modules/sat/domain/rotas-sat.ts` (rota exata) no `middleware.ts` + testes (rota e middleware).

## Tarefa 7 — Consulta do NS, ações e Discord

- `src/modules/sat/infra/repository.ts` (leituras pelo RLS e RPCs com a sessão), `infra/discord.ts`,
  `infra/compels.ts` (descrição pelo código, sem Compels = sem descrição).
- `src/modules/sat/application/consultar-ns.ts` (planilha + repinmetro + ShopFloor + Compels) + teste.
- `src/modules/sat/application/actions.ts`: buscar, registrar entrada, corrigir/trocar NF, motivos;
  permissão conferida antes de tudo; falha no Discord não impede a gravação. Testes.

## Tarefa 8 — Telas e menu

- `/sat/entrada` (registrar_entrada), `/sat/equipamentos` (lista com filtros), `/sat/equipamentos/[id]`
  (ficha + histórico + corrigir/trocar NF com aprovar_nf), `/sat/motivos` (administrar).
- Grupo "SAT" no `app-shell.tsx`.

## Tarefa 9 — Verificação final

Suite inteira, `tsc`, `eslint`, `next build`, harness SQL, conferência única (só contagens) contra a planilha
real, push.
