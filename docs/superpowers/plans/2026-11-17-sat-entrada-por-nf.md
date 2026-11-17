# SAT — entrada por NF · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a entrada do SAT vira uma NF com vários relógios (spec `docs/superpowers/specs/2026-11-17-sat-entrada-por-nf-design.md`).

**Architecture:** o banco (migração 0187, PRONTA e testada — Task 1) guarda a nota em `sat_nfs` e um relógio por
linha em `sat_entradas`, escolhe a OS de cada relógio sozinho e expõe 4 funções. O app (Next.js 16, server actions)
valida, chama as funções, avisa no Discord e mostra as telas. O Compels é lido (só leitura) para achar a empresa pelo CNPJ.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (RPC), Vitest, Tailwind, componentes `@/components/ui/*`.

## Global Constraints

- Textos da interface e mensagens em PT-BR, no tom das telas atuais do SAT.
- Permissão conferida na action ANTES de tudo (`pode(perm)` em `src/modules/sat/application/actions.ts`) e de novo no banco.
- Aviso no Discord DEPOIS de gravar e nunca impede a gravação (`avisar()` já existe em actions.ts).
- `sat` continua em `MODULOS_SEM_FLAG_LEGADA`; a permissão nova `associar_os` também não vira flag `pode_*`.
- Compels: só leitura (`GET negociante/list`). Nunca gravar no Compels.
- Não acrescentar UI que não está no spec.
- Testes: `npx vitest run src/modules/sat "src/app/(app)/sat" src/modules/auth src/modules/perfis src/modules/compels`;
  `npx tsc --noEmit -p .`; `npx eslint` nos arquivos tocados. SQL: `bash supabase/tests/rodar-sat-test.sh` (já verde).

## Contrato do banco (0187 — já existe, NÃO mexer)

- `sat_registrar_nf(p jsonb)` — perm `sat.registrar_entrada`. `p = {numero, cnpj, empresa, negociante_codigo, valor
  (texto numérico com ponto, ou null), situacao: 'aprovada'|'reprovada', motivos: uuid[], relogios: [{ns, modelo,
  sequencia, produto, itens_junto: ('bobina'|'chave'|'fonte'|'outros')[], itens_junto_outros, locacao}]}`.
  Devolve `{nf_id, motivos: text[], relogios: [{id, ns, os_numero}]}`.
- `sat_corrigir_nf(p_nf uuid, p_situacao text, p_motivos uuid[])` — perm `aprovar_nf`.
- `sat_trocar_nf(p_nf uuid, p jsonb {numero, cnpj, empresa, negociante_codigo, valor, situacao, motivos})` — perm `aprovar_nf`.
  As duas devolvem `{nf_id, numero_de, numero_para, empresa, cnpj, situacao_de, situacao_para, motivos: text[], ns: text[]}`.
- `sat_associar_os(p_entrada uuid, p_os uuid|null)` — perm `associar_os`. Devolve `{ns, os_de, os_para}`.
- Erros novos levantados: `CNPJ_INVALIDO`, `SEM_RELOGIOS`, `RELOGIOS_DEMAIS`, `NS_REPETIDO`, `ITEM_INVALIDO`,
  `ENTRADA_INVALIDA`, `NF_NAO_ENCONTRADA`, `OS_DE_OUTRO_NS`, `OS_EM_USO` (+ os de antes: `SEM_PERMISSAO`,
  `NF_OBRIGATORIA`, `NS_OBRIGATORIO`, `MOTIVO_OBRIGATORIO`, `MOTIVO_EM_NF_APROVADA`, `MOTIVO_INVALIDO`,
  `OUTROS_SEM_TEXTO`, `OS_NAO_ENCONTRADA`, `ENTRADA_NAO_ENCONTRADA`, `NADA_A_MUDAR`, `MESMA_NF`, `SITUACAO_INVALIDA`).
- Tabelas (leitura com `sat.visualizar`): `sat_nfs (id, numero, cnpj, empresa, negociante_codigo, valor, situacao,
  motivos, responsavel_nome, data, criado_em)`; `sat_entradas (id, nf_id, ns_escrito, modelo, sequencia, os_id,
  os_numero, produto, itens_junto, itens_junto_outros, locacao, responsavel_nome, data, criado_em)`;
  `sat_historico (id, nf_id, entrada_id, tipo 'entrada'|'correcao'|'troca'|'os', de jsonb, para jsonb, motivos,
  usuario_nome, em)`. `sat_entradas_historico` NÃO existe mais. `sat_os` continua (garantia, defeito, solucao…).
- Funções que saíram: `sat_registrar_entrada`, `sat_motivo_salvar`, as versões antigas de corrigir/trocar.

---

### Task 1: Migração 0187 + testes SQL — FEITA (commit 08b5eba0)

### Task 2: Backend — domínio, Compels, repositório, actions, permissão

**Files:**
- Modify: `src/modules/sat/domain/entrada.ts` (+ `__tests__/entrada.test.ts`)
- Modify: `src/modules/sat/domain/mensagens.ts` (+ teste), `src/modules/sat/domain/erros.ts` (+ teste)
- Modify: `src/modules/sat/application/consultar-ns.ts` (+ teste)
- Modify: `src/modules/sat/infra/repository.ts`, `src/modules/sat/application/actions.ts` (+ `__tests__/actions.test.ts`)
- Create: `src/modules/sat/domain/cnpj.ts` (+ teste); Modify: `src/modules/sat/infra/compels.ts`
- Modify: `src/modules/compels/infra/cliente.ts` (método novo) + domínio de leitura em `src/modules/compels/domain/negociante.ts` (+ teste)
- Modify: `src/modules/auth/domain/modulos.ts`, `src/modules/auth/domain/perfil.ts`, `src/modules/perfis/domain/regras-perfil.ts` (+ testes existentes)

**Interfaces (produz — a Task 3 usa exatamente estes nomes):**

```ts
// domain/cnpj.ts
export function digitosCnpj(texto: string): string            // só dígitos
export function formatarCnpj(texto: string): string | null     // 14 díg → 99.999.999/9999-99; 11 → 999.999.999-99; senão null

// domain/entrada.ts  (remove EntradaInput/EntradaValida/validarEntrada/Frete/FRETES; mantém ITENS_JUNTO, ItemJunto,
// SituacaoNf, lerValor, ordenarOs, voltaParaFabrica, rotuloStatus, validarMudancaNf→ ver abaixo)
export interface RelogioInput { ns: string; produto: string; itensJunto: ItemJunto[]; itensJuntoOutros: string; locacao: string }
export interface NotaInput {
  cnpj: string; empresa: string; negocianteCodigo: string | null; numero: string; valor: string
  situacao: SituacaoNf; motivos: string[]; relogios: RelogioInput[]
}
export interface RelogioValido extends RelogioInput { modelo: string | null; sequencia: string | null }
export interface NotaValida extends Omit<NotaInput, 'valor' | 'relogios'> { valor: number | null; relogios: RelogioValido[] }
export function validarNota(i: NotaInput): { ok: true; valor: NotaValida } | { ok: false; erro: string }
//   erros (nesta ordem): 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).' · 'Informe o número da NF.' ·
//   'Valor da nota inválido.' · motivo obrigatório (texto atual) · 'Bipe ao menos um relógio.' ·
//   'O número de série X está duas vezes nesta nota.' (mesmo modelo+sequência; sem sequência, mesmo texto) ·
//   'Descreva os outros itens que vieram junto (X).' · item inválido. CNPJ sai formatado (formatarCnpj).
export type MudancaNf =
  | { tipo: 'corrigir'; situacao: SituacaoNf; motivos: string[] }
  | { tipo: 'troca'; numero: string; cnpj: string; empresa: string; negocianteCodigo: string | null; valor: string; situacao: SituacaoNf; motivos: string[] }
export function validarMudancaNf(m: MudancaNf): { ok: true; motivos: string[]; cnpj?: string; valor?: number | null } | { ok: false; erro: string }
// osSugerida(os, emUso: Set<string>) → a mais recente que volta para a fábrica e NÃO está em emUso; senão null.

// application/consultar-ns.ts
//   OsDoNs ganha `emUso: boolean` (a OS já está ligada a alguma entrada). ResultadoConsultaNs:
//   remove `sugestao.empresa/cnpj/defeito` → `sugestao: { produto: string }`; `osSugeridaId` usa emUso.
//   produto sugerido = `shopfloor[0].pmo` (código, ex. PMOC31) quando houver; senão ''. NÃO usa `os.equipamento`.
//   A porta `descricaoProduto` e o campo `compels` saem (não são mais usados).

// infra/repository.ts
export function osPorNs(...)                       // + emUso (consulta sat_entradas.os_id nos ids achados)
export async function registrarNf(n: NotaValida): Promise<{ nfId: string; motivos: string[]; relogios: { id: string; ns: string; osNumero: string }[] }>
export interface MudancaGravada { nfId: string; numeroDe: string; numeroPara: string; empresa: string; cnpj: string; situacaoDe: SituacaoNf; situacaoPara: SituacaoNf; motivos: string[]; ns: string[] }
export async function corrigirNf(nfId: string, situacao: SituacaoNf, motivos: string[]): Promise<MudancaGravada>
export async function trocarNf(nfId: string, t: { numero: string; cnpj: string; empresa: string; negocianteCodigo: string | null; valor: number | null; situacao: SituacaoNf; motivos: string[] }): Promise<MudancaGravada>
export async function associarOs(entradaId: string, osId: string | null): Promise<{ ns: string; osDe: string; osPara: string }>
export interface EntradaResumo { id: string; nfId: string; nsEscrito: string; empresa: string; cnpj: string; produto: string; osNumero: string; nf: string; situacao: SituacaoNf; locacao: string; data: string; responsavelNome: string }
export async function listarEntradas(f: FiltroEntradas): Promise<EntradaResumo[]>  // join sat_nfs; filtros situação/cliente(empresa)/NS/período
export interface NotaDetalhe { id: string; numero: string; cnpj: string; empresa: string; valor: number | null; situacao: SituacaoNf; motivos: string[]; data: string; responsavelNome: string }
export interface HistoricoSat { tipo: 'entrada' | 'correcao' | 'troca' | 'os'; de: Record<string, unknown> | null; para: Record<string, unknown>; motivos: string[]; usuarioNome: string; em: string; entradaId: string | null }
export interface EntradaDetalhe {
  id: string; nsEscrito: string; modelo: string | null; sequencia: string | null; produto: string
  itensJunto: ItemJunto[]; itensJuntoOutros: string; locacao: string; data: string; responsavelNome: string; criadoEm: string
  os: { id: string; numero: string; garantia: string; defeito: string; solucao: string; data: string | null } | null
  nota: NotaDetalhe
  outrosRelogios: { id: string; nsEscrito: string }[]      // da mesma nota, sem este
  osDoNs: OsDoNs[]                                          // para "Trocar OS" (com emUso)
  historico: HistoricoSat[]                                 // da nota + os de OS deste relógio, por `em`
}
export async function lerEntrada(id: string): Promise<EntradaDetalhe | null>

// infra/compels.ts
export async function empresaDoCnpj(cnpj: string): Promise<{ codigo: string; nome: string } | null>
//   Compels fora/sem config/não achou → null. Ver "Compels" abaixo.

// application/actions.ts
export async function consultarNsAction(ns: string)                     // como hoje (perm registrar_entrada)
export async function buscarEmpresaAction(cnpj: string): Promise<ResultadoAcao<{ codigo: string; nome: string } | null>>  // registrar_entrada; CNPJ inválido → ok:false
export async function registrarNfAction(input: NotaInput): Promise<ResultadoAcao<{ nfId: string; ids: string[] }>>
export async function corrigirNfAction(nfId: string, situacao: SituacaoNf, motivos: string[]): Promise<ResultadoAcao<null>>
export async function trocarNfAction(nfId: string, t: Omit<Extract<MudancaNf, { tipo: 'troca' }>, 'tipo'>): Promise<ResultadoAcao<null>>
export async function associarOsAction(entradaId: string, osId: string | null): Promise<ResultadoAcao<null>>  // perm associar_os
```

**Mensagens (Discord) — `domain/mensagens.ts`:**
- `mensagemNota({ numero, empresa, cnpj, situacao, motivos, ns: string[] })` →
  `📦 Chegou no SAT: NF 1234 — EMPRESA (12.345.678/0001-90) — aprovada ✅ — 3 relógios: NS1, NS2, NS3`
  (1 relógio → "1 relógio: NS1"; empresa vazia → só o CNPJ; reprovada → `reprovada ❌ (m1; m2)` como hoje).
- `mensagemMudancaNf({ tipo, numeroDe, numeroPara, empresa, cnpj, situacaoDe, situacaoPara, motivos, ns })` →
  correção: `🧾 NF do SAT corrigida: NF 1234 — EMPRESA (cnpj) — aprovada → reprovada ❌ (m) — relógios: NS1, NS2`;
  troca: `🧾 NF do SAT trocada: NF 1234 (aprovada) substituída pela NF 1240 — EMPRESA (cnpj) aprovada ✅ — relógios: …`.
- Associar OS não avisa no Discord.

**Erros (`domain/erros.ts`):** mapear os códigos novos para PT-BR (ex.: `CNPJ_INVALIDO` → 'CNPJ da nota inválido (14
dígitos) ou CPF (11).'; `NS_REPETIDO` → 'Um número de série está duas vezes nesta nota.'; `SEM_RELOGIOS` → 'Bipe ao
menos um relógio.'; `OS_EM_USO` → 'Essa OS já está ligada a outro relógio.'; `OS_DE_OUTRO_NS` → 'Essa OS não é deste
número de série.'; `NF_NAO_ENCONTRADA` → 'Nota não encontrada.'; `MESMA_NF` → 'A nota nova é igual à atual — para
mudar só a situação, use Corrigir.'). Remover os de motivo cadastrado (`TEXTO_INVALIDO`, `MOTIVO_NAO_ENCONTRADO`,
o caso `sat_motivos_nf_texto`).

**Compels (só leitura):** em `ClienteCompels`, `async buscarNegociantes(cpfCnpj: string): Promise<unknown>` faz
`GET /negociante/list?sortFilter=[]&filter=<json>&true=1&offset=0&limit=50` (use o mesmo `this.json(caminho)` /
`enviar` dos outros GETs do cliente, com `encodeURIComponent` no JSON), onde o filtro é exatamente
`{"codigo":"","nome":"","cpfCnpj":<cnpj>,"telefone":"","tipoIdList":null,"statusIdList":null,"transportadora":"",
"cep":"","municipio":"","uf":"","pais":"","situacao":"ATIVO","codigoVendedor":null,"observacao":"",
"limiteCreditoIdList":null,"restricaoVendedor":false,"carteiraRestricaoVendedor":false,"exibirUltimaCompra":false,
"atendenteAlocadoId":null,"cadastroLead":false}`. Resposta: `{ results: [{ codigo, cpfCnpj, nome, nomeFantasia,
inativo, … }] }`. Em `compels/domain/negociante.ts`: `negocianteDoCnpj(resposta: unknown, cnpjDigitos: string):
{ codigo: string; nome: string } | null` — pega a primeira linha com `inativo !== true` cujo `cpfCnpj` tenha os
MESMOS dígitos; `nome` = `nome` aparado, senão `nomeFantasia`; nenhuma → null. `empresaDoCnpj` tenta com o CNPJ
formatado (máscara) e, sem resultado, só os dígitos (o cadastro tem dos dois jeitos). Testes do domínio com
respostas fictícias (nada de dado real).

**Permissão:** `associar_os` em `PERMISSOES_POR_MODULO.sat` (depois de `aprovar_nf`), no tipo `Permissao`, e em
`regras-perfil.ts` com rótulo `'Associar OS'` (sem coluna/flag legada, como `aprovar_nf`). Atualizar o comentário de
`modulos.ts`.

- [ ] Testes primeiro (domínio cnpj/nota/mudança/mensagens/erros/negociante; consultar-ns: produto pelo PMO e não pela
      planilha, osSugerida ignora emUso; actions: permissões de cada action, `registrarNfAction` avisa UMA vez com todos
      os NS, Discord falhando não impede).
- [ ] Implementar até passar; tsc + eslint limpos.
- [ ] Commit: `feat(sat): backend da entrada por NF (nota com vários relógios, empresa pelo CNPJ no Compels, associar OS)`.

### Task 3: Telas — entrada, lista, ficha

**Files:**
- Modify: `src/app/(app)/sat/entrada/entrada-tela.tsx` (+ `__tests__/entrada-tela.test.tsx`), `src/app/(app)/sat/entrada/page.tsx`
- Modify: `src/app/(app)/sat/equipamentos/page.tsx`, `src/app/(app)/sat/equipamentos/[id]/page.tsx`, `src/app/(app)/sat/equipamentos/[id]/mudar-nf.tsx`
- Create: `src/app/(app)/sat/equipamentos/[id]/trocar-os.tsx`
- Modify se preciso: `src/app/(app)/sat/situacao-nf.tsx`, `src/app/(app)/sat/formato.ts`

**Entrada (`/sat/entrada`)** — consome a Task 2:
1. Seção **Nota fiscal**: **CNPJ** primeiro (ao sair do campo / Enter: `buscarEmpresaAction`; achou → preenche
   Empresa e guarda `negocianteCodigo`, com um texto pequeno "do cadastro do Compels"; não achou → texto pequeno
   "Não achamos no Compels — digite a empresa"); **Empresa** (sempre editável); **Número da NF**; **Valor da nota**;
   **Situação** (`SituacaoNfCampos`, como hoje).
2. Seção **Relógios**: campo "Número de série" (bipe + Enter) → `consultarNsAction`; NS já na lista → toast de erro
   e não adiciona. Cada relógio vira um cartão: título = NS; **Produto** (input, vem com `sugestao.produto`);
   **Itens que vieram junto** (checkboxes ITENS_JUNTO + "Quais?" quando outros); **Locação** (input); em letra pequena
   e cor apagada, só leitura: OS prevista = `os.find(id === osSugeridaId)` → "OS 26886 · SEM GARANTIA · Defeito:
   Guilhotina quebrada", senão "Sem OS"; **Repinmetro**: visível só "Revenda: X · saída da expedição dd/mm/aaaa,
   hh:mm" (se houver), e um `<details>` fechado "Teste de produção" com a(s) linha(s) do teste (data, status) e os
   seriais das peças (o conteúdo que hoje está no cartão Repinmetro); botão "Remover" no cartão.
   NÃO há escolha de OS, nem lista de OS da planilha, nem seções ShopFloor/Compels separadas.
3. Botão **"Registrar entrada (N relógios)"** (desabilitado com 0) → `registrarNfAction`; sucesso → toast, limpa
   tudo, mostra "Entrada da NF X registrada (N relógios)" com link para a lista filtrada por NS do primeiro ou para a
   ficha do primeiro relógio (`/sat/equipamentos/<ids[0]>`).
4. Remove os campos produto da planilha, CNPJ/empresa da OS, frete, custo, defeito.

**Lista (`/sat/equipamentos`)**: colunas NS · Produto · Empresa · NF · Situação · OS · Locação · Data; filtros iguais.

**Ficha (`/sat/equipamentos/[id]`)**:
- Relógio: NS, produto, itens, locação, data, responsável.
- **OS**: número, garantia, defeito, solução (ou "Sem OS"); botão **"Trocar OS"** (só com `sat.associar_os`) abre
  `trocar-os.tsx`: rádio com as `osDoNs` (OS nº · data · solução · garantia; as `emUso` de OUTRO relógio aparecem
  desabilitadas com "em outra entrada") + "Sem OS" → `associarOsAction`.
- **Nota fiscal**: número, CNPJ, empresa, valor, situação/motivos, e "Outros relógios desta NF" (links). Mudar NF
  (`mudar-nf.tsx`, perm `aprovar_nf`): Corrigir (situação/motivos) e Trocar (número, CNPJ com busca da empresa,
  empresa, valor, situação/motivos) → avisa que vale para todos os relógios da nota.
- **Histórico**: `historico` por data (entrada, correção, troca, troca de OS) com quem/quando/de→para.

- [ ] Ajustar o teste de componente da entrada (`entrada-tela.test.tsx`) ao novo fluxo (CNPJ preenche empresa;
      bipe adiciona cartão; NS repetido recusado; registrar manda a nota com os relógios).
- [ ] Implementar; tsc + eslint + vitest limpos.
- [ ] Commit: `feat(sat): telas da entrada por NF (nota + relógios), lista e ficha com trocar OS`.

### Task 4: Revisão final da branch + memória
