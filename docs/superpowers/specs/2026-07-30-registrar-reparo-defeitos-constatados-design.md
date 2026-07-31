# Registrar reparo — defeito relatado no cabeçalho + defeitos constatados — Design

> **Data:** 2026-07-30 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-ondas`
> **Tipo:** feature no dialog "Registrar reparo" (Manutenção). **Precisa de migração no Dev.** Fluxo Dev × Prod.

## Contexto

O dialog **"Registrar reparo"** (Manutenção → botão por pendência) hoje coleta **colaborador** + lista de
**consertos** (`{descrição, posição}`). O RPC `sf_registrar_reparo` ([0033](../../../supabase/migrations/0033_sf_manutencao.sql))
grava **uma linha por conserto** em `sf_registros` (posto=`Manutenção`, `codigo_defeito`=**relatado** copiado
da reprova, `reparo_conserto`/`reparo_posicao` preenchidos, `status`='').

Pedido (usuário, 2026-07-30): **acrescentar** (nada é removido):
1. **Cabeçalho:** exibir o **defeito relatado** (o que o testador registrou na reprova). O dado já existe
   (`alvo.cod` — já carregado e já passado pro action). Só exibir.
2. **Defeitos constatados:** novo campo pra registrar o(s) defeito(s) que o reparador **constatou**, **do
   catálogo `sf_defeitos`**, **podendo adicionar vários**. Decisões do usuário: **obrigatório** (≥1 pra
   concluir) e **conta nas análises** (aparece como defeito da peça em Registros/Pesquisa). **Constatado = só
   o código** (sem posição).

Levantamento: **não há** agregação/"top defeitos" hoje; defeitos aparecem na **Registros** (lê
`codigo_defeito` de todas as linhas) e na **Pesquisa** (por SN). Logo, "contar" = o constatado precisa virar
uma linha com `codigo_defeito`.

## Objetivo

Mostrar o defeito relatado no cabeçalho e permitir registrar **≥1 defeito constatado (do catálogo)** no
reparo, gravado como defeito da peça (conta nas análises), sem remover nada do fluxo atual.

## Escopo

**Dentro:**
- Cabeçalho do dialog exibe o **defeito relatado** (`alvo.cod`).
- Seção **"Defeitos constatados"**: campo com datalist do catálogo + "Adicionar defeito constatado" (vários);
  obrigatório ≥1.
- Cada constatado vira **uma linha** em `sf_registros` (posto=`Manutenção`, `codigo_defeito`=constatado,
  `status`='', marcada com flag nova `reparo_constatado=true`).
- Migração (coluna flag) + novo parâmetro no RPC + wiring action/infra/UI.

**Fora (confirmado):**
- **Posição** do constatado (só o código).
- Mexer nas linhas de **conserto** (continuam iguais, com o relatado).
- Criar tela/relatório de contagem de defeitos (não existe hoje; fora de escopo).
- Combobox no lugar do datalist (segue no backlog; aqui usa datalist como no Lançamento).

## Design

### 1. Migração — `supabase/migrations/0061_sf_reparo_constatado.sql`
**Uma migração** com (a) a coluna flag e (b) a redefinição do RPC (seção 2). A coluna:
```sql
-- Marca a linha de reparo como "defeito constatado" (código no codigo_defeito).
alter table public.sf_registros
  add column if not exists reparo_constatado boolean not null default false;
comment on column public.sf_registros.reparo_constatado is
  'true = linha de defeito CONSTATADO durante o reparo (codigo_defeito = defeito do catálogo).';
```
Aditiva (`add column ... default false`), metadata-only. **Só no Dev** nesta etapa. Sem mudança de RLS.
Próxima na sequência (Prod está em 0060) → **0061**.

### 2. RPC — `sf_registrar_reparo` (redefinir na 0061, aditivo)
Novo parâmetro `p_defeitos_constatados jsonb` (**array de strings** = códigos do catálogo). Como o parâmetro
**muda a assinatura**, `create or replace` criaria uma **sobrecarga** — então **dropar a assinatura antiga
primeiro** (na mesma 0061):
```sql
drop function if exists public.sf_registrar_reparo(
  text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb);
-- em seguida, create ... a nova versão com o parâmetro extra p_defeitos_constatados jsonb ao final.
```
Mudanças na função:
- Validação: além do `SEM_CONSERTOS`, exigir **≥1 constatado** → senão `{ ok:false, erro:'SEM_CONSTATADOS_DEFEITO' }`.
- Após inserir as linhas de conserto (inalterado), inserir **uma linha por constatado**:
  ```sql
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posto_origem, data_hora_origem, reparo_constatado)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    trim(both '"' from d::text), p_posto_origem, p_data_hora_origem, true
  from jsonb_array_elements(p_defeitos_constatados) d
  where coalesce(trim(both '"' from d::text), '') <> '';
  ```
  (`codigo_defeito` = código do constatado; `reparo_conserto`/`reparo_posicao` ficam no default ''; `status`
  fica '' — igual às linhas de conserto, pra **não** virar falsa pendência; `reparo_constatado=true`.)
- `security definer` + guard `tem_permissao('lancar')` como já é. Retorno pode incluir `constatados`.

### 3. Infra — `src/modules/shopfloor/infra/manutencao-repository.ts`
- `chamarSfRegistrarReparo(args)`: adicionar `p_defeitos_constatados: string[]` ao tipo dos args e passar no
  `rpc(...)`.
- (A leitura do catálogo reusa o `listarDefeitos()` já existente — de `defeitos-repository` ou
  `lancamento-repository`; ver Task de UI.)

### 4. Application — `src/modules/shopfloor/application/manutencao-actions.ts`
- `interface EntradaReparo` += `defeitosConstatados: string[]`.
- Em `registrarReparo`: normalizar `defeitosConstatados = entrada.defeitosConstatados.map(s => s.trim()).filter(Boolean)`;
  se `.length === 0` → `{ ok:false, erro: 'Informe ao menos um defeito constatado.' }`.
- Passar `p_defeitos_constatados: defeitosConstatados` no `chamarSfRegistrarReparo`.
- `MENSAGENS` += `SEM_CONSTATADOS_DEFEITO: 'Informe ao menos um defeito constatado.'`.
- `registrarLog`: incluir `constatados` no `dados` e na `descricao` (ex.: `… N conserto(s), M constatado(s)`).

### 5. UI — Manutenção
- **`page.tsx`** (`operar/manutencao/page.tsx`): carregar o catálogo `listarDefeitos()` e passar
  `defeitosCatalogo` (só os códigos: `string[]`) pro `<ManutencaoLista>`.
- **`manutencao-lista.tsx`:**
  - Prop nova `defeitosCatalogo: string[]`.
  - **Cabeçalho:** na `<p>` de contexto do dialog, acrescentar **"· defeito relatado: {alvo.cod}"** quando
    `alvo.cod` não vazio (mantém SN · PMO/OP · reprovada em … · posições).
  - Estado novo `const [constatados, setConstatados] = useState<string[]>([''])`; resetar em `abrirReparo`.
  - **Seção "Defeitos constatados"** (depois de Consertos), espelhando a estrutura de consertos, mas **um
    único `<Input list="defeitos-constatados-list">`** por linha + botão remover; `<datalist
    id="defeitos-constatados-list">` com `defeitosCatalogo.map(c => <option value={c}/>)`; botão **"Adicionar
    defeito constatado"**.
  - `valido` passa a exigir também `constatados.some(c => c.trim() !== '')`.
  - `onSalvar`: enviar `defeitosConstatados: constatados` no `registrarReparo({...})`.

## Critérios de sucesso
- Dialog mostra o **defeito relatado** no cabeçalho.
- Concluir reparo **exige** colaborador + ≥1 conserto + **≥1 defeito constatado**; sem constatado → bloqueia
  com mensagem.
- Cada constatado escolhido do catálogo vira **uma linha** em `sf_registros` (`codigo_defeito`=constatado,
  `reparo_constatado=true`, posto `Manutenção`, status '') → **aparece na Registros/Pesquisa** como defeito
  da peça; **não** cria falsa pendência de manutenção.
- Linhas de **conserto** inalteradas; nada removido do fluxo.
- Build limpo; testes verdes; migração `0061` só no Dev.

## Riscos / considerações
- **Redefinir o RPC** (`create or replace function`): manter a assinatura antiga? Não — a assinatura muda
  (novo parâmetro). Como o único chamador é o nosso `chamarSfRegistrarReparo`, tudo bem redefinir com o param
  novo; **atualizar o chamador junto** (Task de infra) pra não quebrar. Smoke pesado do reparo.
- **Não setar `status='Reprovado'`** nas linhas de constatado — status '' (igual conserto) evita ser lido
  como nova reprova/pendência por `listarReprovasOrigem` (que filtra por posto de origem, não Manutenção) e
  pelo `agruparPendencias`.
- **Duplicação:** o relatado já é gravado no Teste (conta lá) e é copiado nas linhas de conserto (rastreio) —
  comportamento **atual, inalterado**. O constatado adiciona linhas novas. Como não há contagem hoje, sem
  risco de quebrar número existente.
- **Datalist** só sugere ao digitar (limitação nativa; combobox é backlog) — aceitável, é o padrão do
  Lançamento.
- Baixo/médio risco: 1 migração aditiva + RPC redefinido + wiring; concentrado na Manutenção.
