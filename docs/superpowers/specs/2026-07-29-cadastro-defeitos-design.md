# Cadastro de Defeitos (catálogo) — Design

> **Data:** 2026-07-29 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** nova tela de configuração (catálogo admin). Segue o fluxo Dev × Prod.

## Contexto

A lista de defeitos (`sf_defeitos`) veio do legado e hoje é **só leitura** — usada no Lançamento e na
Manutenção para classificar reprovas. Não existe tela para **gerir** esse catálogo; incluir/remover um
defeito exige mexer no banco. A reunião (2026-07-29) pediu uma **tela para cadastrar novo defeito**, com
permissão **somente admin**.

Levantamento do que já existe (reduz o tamanho):
- Tabela `public.sf_defeitos` já criada na fundação (`0028`): `codigo text primary key`
  (ex.: `'1002 TRILHA ROMPIDA'`), `tipo smallint not null` (**1 = peça** | **2 = teste**),
  `created_at timestamptz`.
- **RLS já pronta e por módulo** (`0040`/`0043`): `select` exige `shopfloor.visualizar`;
  escrita (`for all`) exige `shopfloor.administrar`. Ou seja, o backstop de "só admin escreve" **já existe**.
- Leitura atual: `listarDefeitos()` em `infra/lancamento-repository.ts` (`select codigo,tipo order by codigo`).
- `sf_registros.codigo_defeito` é **texto solto** (snapshot), **sem FK** para `sf_defeitos` → excluir/renomear
  um defeito do catálogo **não quebra o histórico**.

## Objetivo

Uma tela admin em **Configurações › ShopFloor › Defeitos** para **listar**, **cadastrar** e **excluir**
defeitos do catálogo, sem migração de banco.

## Escopo

**Dentro:**
- Novo accordion **"ShopFloor"** em Configurações (espelha o de Recebimento), com o item **Defeitos**.
- Rota `/configuracoes/sf-defeitos`: listar (ordenado por código) + busca por texto do código + tipo por linha.
- Dialog **"Novo defeito"**: campo **Código** (texto livre, único campo) + **Tipo** (peça/teste). No salvar:
  `trim` + **UPPERCASE**; rejeita código vazio, tipo inválido e código duplicado.
- **Excluir** por linha (com confirmação).
- Enforcement em **três camadas**: guard `shopfloor.administrar` na **página**, na **action**, e a **RLS** de backstop.

**Fora (confirmado):**
- **Migração** — nenhuma (tabela + RLS já existem).
- **Editar** o código de um defeito — é a PK; "renomear" = excluir + recriar.
- Mexer no consumo dos defeitos (Lançamento/Manutenção continuam iguais).
- Campos separados número/descrição — fica **um campo só** (fiel ao formato atual).

## Design

### 1. Dados / domínio
- **Tipos:** `type TipoDefeito = 1 | 2` (1 = peça, 2 = teste). `interface Defeito { codigo: string; tipo: TipoDefeito }`.
- **`domain/defeito.ts`:**
  - `normalizarCodigoDefeito(bruto: string): string` → `bruto.trim().replace(/\s+/g, ' ').toUpperCase()`
    (colapsa espaços internos + maiúsculas; fiel ao catálogo existente).
  - `validarDefeito(entrada: { codigo: string; tipo: number }): { ok: true; valor: Defeito } | { ok: false; erro: string }`
    - código normalizado não-vazio (senão `'Informe o código do defeito.'`);
    - `tipo === 1 || tipo === 2` (senão `'Selecione o tipo (peça ou teste).'`).
  - Testável em isolamento (sem banco).

### 2. Infra — `infra/defeitos-repository.ts`
- `listarDefeitos(): Promise<Defeito[]>` — `from('sf_defeitos').select('codigo,tipo').order('codigo')`,
  mapeando `tipo` para `1 | 2`. (Move a leitura do catálogo para o repo próprio; o `listarDefeitos` que hoje
  vive em `lancamento-repository.ts` **permanece** onde está — o Lançamento não muda nesta tarefa.)
- `inserirDefeito(d: Defeito): Promise<{ ok: true } | { ok: false; erro: string }>` — `insert`; traduz
  violação de PK (código `23505`) em `'Esse defeito já existe.'`.
- `excluirDefeito(codigo: string): Promise<void>` — `delete().eq('codigo', codigo)`.

### 3. Application — `application/defeitos-actions.ts`
Segue **exatamente** o padrão de `padroes-fluxo-actions.ts`: `'use server'`, `type Resultado = { ok: true }
| { ok: false; erro: string }`, guard inline `const sessao = await getSessao(); if (!sessao ||
!podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) return { ok: false, erro: '…' }`. Sem log (as
actions dos Padrões não logam).
- `cadastrarDefeitoAction(dados: { codigo: string; tipo: number }): Promise<Resultado>`:
  - guard acima (`erro: 'Você não tem permissão para gerenciar defeitos.'`);
  - `validarDefeito(dados)`; se `!ok` retorna o erro; chama `inserirDefeito(v.valor)` (propaga o
    `'Esse defeito já existe.'` do repo); `revalidatePath('/configuracoes/sf-defeitos')`; retorna `{ ok: true }`.
- `excluirDefeitoAction(codigo: string): Promise<Resultado>`:
  - mesmo guard; `try { await excluirDefeito(codigo) } catch { return { ok:false, erro:'Erro ao excluir o defeito.' } }`;
    `revalidatePath('/configuracoes/sf-defeitos')`; `{ ok: true }`.

### 4. UI — `app/(app)/configuracoes/sf-defeitos/`
- **`page.tsx`** (server): guard **na página** no padrão de `ordens/page.tsx` —
  `const sessao = await getSessao(); if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar'))
  return <SemPermissao descricao="Você não tem permissão para gerenciar defeitos." />`; busca
  `listarDefeitos()` (do novo `defeitos-repository`); renderiza `<DefeitosLista defeitos={...} />`.
- **`defeitos-lista.tsx`** (client):
  - busca (filtra por substring do código, client-side, `useState`), contador, tabela (Código | Tipo | ações);
  - **badge de tipo** peça/teste;
  - botão **"Novo defeito"** → Dialog (base-ui) com Código (controlado) + Tipo (radios/Select); ao confirmar,
    chama `cadastrarDefeitoAction({ codigo, tipo })` (não é `useActionState`/`formData` — chamada direta como
    nos Padrões), trata `{ ok, erro }` com `useTransition` p/ pending; **reset ao abrir** o Dialog (evita
    "cache" — lição do form de OP);
  - **excluir** por linha com confirmação → `excluirDefeitoAction(codigo)`.
  - Segue os componentes/estilos já usados nas telas de Configurações do Recebimento.

### 5. Menu — `shared/ui/app-shell.tsx`
- Novo array `CONFIG_SHOPFLOOR: FolhaModular[]` com
  `{ chave: 'sf-defeitos', rotulo: 'Defeitos', href: '/configuracoes/sf-defeitos', icone: <ícone>, modulo: 'shopfloor', perm: 'administrar' }`.
- Renderizar um **accordion "ShopFloor"** dentro de Configurações, no mesmo padrão do `CONFIG_RECEBIMENTO`
  (estado aberto/fechado próprio; visível só se o item passar no filtro `pode`). Incluir em `CONFIG_TODOS`
  para o cálculo de item ativo/breadcrumb.

## Critérios de sucesso
- Admin vê **Configurações › ShopFloor › Defeitos**; não-admin não vê o item nem acessa a rota (guard + RLS).
- Lista mostra os defeitos ordenados por código, com tipo; busca filtra por código.
- "Novo defeito" grava `codigo` normalizado (trim + maiúsculas) + tipo; código duplicado → erro amigável,
  sem gravar; código vazio / tipo ausente → erro de validação.
- Excluir remove do catálogo (com confirmação) e **não afeta** registros históricos.
- Reabrir "Novo defeito" após salvar → form limpo.
- Build limpo; 0 migração; testes do domínio (`validarDefeito`/`normalizarCodigoDefeito`) verdes.

## Riscos / considerações
- **Sem migração:** confiar na RLS existente como backstop; ainda assim manter o guard na página e na action
  (defesa em profundidade e UX — 403 do RLS vira erro feio sem o guard).
- **Normalização de código:** UPPERCASE + colapso de espaços pode fazer dois "quase-iguais" colidirem na PK —
  é o comportamento desejado (evita duplicata por caixa/espaço), reportado como "já existe".
- **Excluir sem cascata:** seguro por não haver FK; registros antigos preservam o texto. Documentar isso na
  confirmação de exclusão (já previsto no mockup).
- Baixo risco geral: sem banco, mudanças concentradas em arquivos novos + o accordion no `app-shell.tsx`.
