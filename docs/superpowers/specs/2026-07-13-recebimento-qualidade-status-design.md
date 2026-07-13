# Spec — Seções Recebimento/Qualidade + status dinâmico (features #7 + #3a)

## Contexto
Features #7 e #3a do roadmap (`docs/roadmap-pos-apresentacao.md`), desenhadas **juntas** porque
o status de conclusão depende do fluxo de conferência. Requisitos aprovados pela equipe; foco no
design técnico. Ambiente Dev separado ainda não existe → a migração roda em **produção**, onde
**não há dados reais** (só testes — usuário confirmou).

Base atual: formulário dinâmico de processo (`processo-form.tsx`) montado de `configuracao_campos`
(grupos comercial/material/recebimento/qualidade) com **um** `salvarProcesso`; ciclo de vida em
`ciclo-vida.ts` (aberto→em_conferencia→finalizado/cancelado, reabrir); transições em
`transicoes-processo.ts`.

## Objetivo
1. Dividir a conferência em **duas seções independentes** (Recebimento e Qualidade), cada uma com
   seu **botão Salvar** e um **responsável** (quem salvou por último).
2. Tornar o **status terminal dinâmico**, dirigido pela lista suspensa **"Resultado"**.

## Requisitos (confirmados)

### Seções e salvamento
- **Comercial** e **Material** ficam **editáveis** no topo (grupos base).
- Duas seções de conferência, **independentes** (uma não depende da outra):
  - **Recebimento** — botão **Salvar** próprio. Salva **Comercial + Material + Recebimento** e
    carimba **`responsavel_recebimento`** = usuário que salvou (**último que salvou**, atualiza a
    cada save).
  - **Qualidade** — botão **Salvar** próprio; **"Part Number recebido" é o 1º item** dela. Salva
    **Comercial + Material + Qualidade** e carimba **`responsavel_qualidade`** = último que salvou.
- **Removidos:** o campo calculado **`responsavel_contagem`**, o **Salvar único** atual e todo o
  fluxo de **Cancelar** (status, botão e ação).
- 1º save de qualquer seção promove `aberto → em_conferencia` (como hoje).

### Status dinâmico
- Status fixos: **`aberto`**, **`em_conferencia`**.
- Status **terminais = os itens da lista "Resultado"** (hoje **Aprovado**/**Reprovado**; se o Admin
  adicionar itens à lista, viram status possíveis). O status terminal armazenado é o **valor do
  campo `resultado`** (ex.: `"Aprovado"`).
- **Finalizar** (botão mantido, como hoje): disponível em `em_conferencia`; exige **apenas o campo
  `resultado`** preenchido; ao finalizar, `status ← valor de resultado`.
- **Reabrir** (mantido): status terminal → `em_conferencia`.

## Design

### Modelo de dados (migração 0015)
- `processos_recebimento`:
  - **DROP** da CHECK de `status` (não dá para enumerar valores dinâmicos). `status` continua
    `text not null default 'aberto'`; a validação de valores válidos passa para o domínio/app.
  - **ADD** `responsavel_recebimento uuid references public.usuarios(id)`.
  - **ADD** `responsavel_qualidade uuid references public.usuarios(id)`.
  - **DROP** `responsavel_contagem` (era calculado, some).
  - `motivo_cancelamento`/`cancelado_por`: **mantidos** (nuláveis, sem uso — dropar não traz
    benefício e aumenta a superfície da migração).
  - **Dados existentes (teste):** `update ... set status='em_conferencia' where status in
    ('finalizado','cancelado')` — normaliza os processos de teste para o novo vocabulário.
- `configuracao_campos`:
  - `part_number_recebido`: `grupo` `recebimento` → **`qualidade`**, `ordem = 235` (antes de
    `inscricoes`, 240).
  - `responsavel_contagem`: **DELETE** da linha de config (e limpeza do cálculo — ver domínio).
  - `obrigatorio_finalizacao`: **`true` apenas em `resultado`**; `false` em todos os outros. Assim
    a validação de finalização (que já lê `obrigatorio_finalizacao`) passa a exigir só o resultado.
- `lista_itens` da lista **`resultado`**: seed dos itens **`Aprovado`** e **`Reprovado`** (a lista
  hoje está vazia; o Admin pode adicionar mais pela tela de Listas).
- **RLS** `processos_update` (substitui a de 0009): "concluído" deixa de ser `= 'finalizado'` e
  passa a ser "não é aberto/em_conferencia":
  ```sql
  using (
    public.tem_permissao('editar')
    and (status in ('aberto','em_conferencia') or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status in ('aberto','em_conferencia')
         or public.tem_permissao('finalizar')
         or public.tem_permissao('editar_finalizado'))
  )
  ```
  (Remove a cláusula de `cancelado`.)

### Domínio — ciclo de vida (`ciclo-vida.ts`)
O status terminal é dinâmico, então o `TRANSICOES` fixo sai; entra lógica por helpers puros
(testáveis):
- `STATUS_BASE = ['aberto','em_conferencia']`.
- `ehTerminal(status): boolean` → `!STATUS_BASE.includes(status)`.
- `podeFinalizar(status): boolean` → `status === 'em_conferencia'`.
- `podeReabrir(status): boolean` → `ehTerminal(status)`.
- `podePromoverParaConferencia(status): boolean` → `status === 'aberto'`.
- `camposFaltantesFinalizacao(...)` — **mantido** (já lê `obrigatorioFinalizacao`; com só
  `resultado` marcado, exige só ele).

### Domínio — cálculo (`calculos.ts`)
- Remover o tratamento da fórmula **`usuario_primeiro`** (só o `responsavel_contagem` a usava) e
  seus testes/fixtures. Os demais calculados (atraso, divergência, crítico, amostral) ficam.

### Aplicação
- **Nova action `salvarSecaoProcesso(id, secao: 'recebimento' | 'qualidade', valores)`** (substitui
  `salvarProcesso`), reaproveitando a lógica atual de conversão/validação/recompute de calculados:
  - Aceita os campos de **comercial + material + a seção** (`secao`); ignora campos de fora.
  - Grava, promove `aberto → em_conferencia` no 1º save, recomputa calculados, loga o diff.
  - Carimba `responsavel_recebimento` (se `secao='recebimento'`) ou `responsavel_qualidade` (se
    `'qualidade'`) = `sessao.usuarioId`.
  - Permissões: exige `editar`; se `ehTerminal(status)` exige `editar_finalizado` (backstop do RLS).
- **`finalizarProcesso(id)`** (ajuste): valida `em_conferencia` + `camposFaltantesFinalizacao`
  (= só `resultado`); grava `status = valor do campo resultado` do processo (lê `processo.resultado`;
  se vazio, erro "Preencha o Resultado."). Loga `mudar_status`.
- **`reabrirProcesso(id)`** (ajuste): `ehTerminal(status)` → `em_conferencia`; limpa
  `finalizado_por/finalizado_em`.
- **Remover `cancelarProcesso`**.

### UI
- **`processo-form.tsx`**: passa a renderizar **Comercial + Material** (base, editáveis) + **seção
  Recebimento** (campos + botão **Salvar Recebimento**) + **seção Qualidade** (campos, PN recebido
  1º + botão **Salvar Qualidade**). Cada Salvar chama `salvarSecaoProcesso` com a `secao`
  correspondente (enviando comercial+material+os da seção). Estado dirty por seção.
- **`acoes-processo.tsx`**: mantém **Finalizar** (em_conferencia) e **Reabrir** (terminal); **remove
  Cancelar** e o dialog de motivo.
- **Status/badges (`status-processo.ts`)**: `aberto`/`em_conferencia` com cor fixa; terminais
  conhecidos `Aprovado`(verde)/`Reprovado`(vermelho); qualquer outro terminal cai no rótulo bruto +
  cor neutra (o fallback atual já faz isso).
- **Filtro de status (`processos-filtros.tsx`)**: as opções passam a ser `aberto`,
  `em_conferencia` + os itens da lista "Resultado" (carregados do banco). O filtro por igualdade na
  RPC/consultas continua válido (status = valor).
- **Detalhe do processo**: mostra os dois responsáveis (recebimento/qualidade) quando preenchidos.

### Tratamento de erros
- Save de seção sem permissão / processo concluído sem `editar_finalizado` → erro amigável (backstop
  RLS). Finalizar sem `resultado` → "Preencha o Resultado.". Falhas de banco → mensagem genérica
  (padrão atual).

### Testes
- **Domínio (TDD):** `ciclo-vida` (ehTerminal, podeFinalizar/Reabrir/promover; camposFaltantes só
  resultado); `calculos` sem `usuario_primeiro` (ajustar suíte existente).
- **Aplicação/infra/UI:** verificação por `tsc`/lint/build + **smoke manual** (padrão do projeto
  para código que fala com Supabase e para telas).

## Migração de status — nota de segurança
A DROP da constraint + o UPDATE dos status rodam em **produção**, mas **não há dados reais** (só
teste) — confirmado. A RPC de contagem por mês (0014) e a lista por mês (3b) **não dependem** do
status, então seguem funcionando.

## Fora de escopo
- **#5** (trava de etiqueta por status "concluído" + campos) — vem em seguida, usando `ehTerminal`.
- **#4** (adicionar processo manual) — depois; a criação define Comercial/Material.
- **#1/#2/#6**.
- Padronizar a lista "Resultado" como "lista de sistema" não-editável — por ora ela é editável
  (o Admin controla os status terminais de propósito).

## Relação com outras features
- **#5** depende deste status (usa `ehTerminal` para liberar etiqueta).
- **#2** (setas) e **3b** (abas por mês) já convivem — o status novo só muda os badges/filtro.
