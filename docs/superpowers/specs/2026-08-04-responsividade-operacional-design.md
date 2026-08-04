# Responsividade (operacional) + menu lateral retrátil — Design

> **Data:** 2026-08-04 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-responsividade`
> **Tipo:** UI/layout. **Sem migração, sem backend.** Foco: **tablet**, telas **operacionais** primeiro.

## Contexto

O app já é parcialmente responsivo: em `< lg` o menu lateral vira **drawer** (hambúrguer). No desktop o menu fica
**sempre visível, sem botão de esconder**. As telas de Lançamento hoje **rolam** a página em tela menor. O usuário
quer: **(A)** um botão pra esconder/mostrar o menu (lembrado); **(B)** o Lançamento **cabendo sem rolar** em
retrato/paisagem/web; **(C)** as demais operacionais responsivas. (Layout aprovado no mockup.)

## Escopo

**Dentro:** (A) menu retrátil no desktop (persistido) — `app-shell`; (B) Lançamento (Peça, Embalagem, Integração,
Burn-in) sem scroll de página, layout adaptativo; (C) responsividade de Manutenção, Consultar Integração, Consultar
Caixa (tabelas com scroll próprio, grids empilham, sem overflow horizontal do corpo).
**Fora:** telas de gestor/cadastro, Grade, Dashboards, Recebimento (ondas futuras); celular (foco é tablet, mas
o layout já ajuda). Sem migração/backend.

## Design

### A. Menu lateral retrátil — `src/shared/ui/app-shell.tsx` (já é client)
- Estado `const [menuRecolhido, setMenuRecolhido] = useState(false)`; **persistência** no `localStorage`
  (chave `sf:menu-recolhido`): ler num `useEffect` no mount (default `false`; aceita um flash breve por ser client),
  gravar num `useEffect` quando muda.
- **Aside** (desktop): `hidden shrink-0 lg:block transition-[width] duration-200` + `menuRecolhido ? 'lg:w-0
  lg:overflow-hidden' : 'lg:w-64'`. (No `< lg` continua `hidden` — o drawer é quem aparece.)
- **Botão de recolher** no `<header>`, **só desktop** (`hidden lg:inline-flex`): ícone `PanelLeftClose`/`PanelLeft`
  (lucide), `aria-label` "Recolher/Mostrar menu", toggla `menuRecolhido`. O **hambúrguer mobile atual fica** (`lg:hidden`).
- O drawer mobile (`mobileAberto`) **não muda**.

### B. Lançamento sem scroll — `lancamento-form.tsx` (+ panels)
Objetivo: a **página não rola**; o conteúdo usa a altura disponível; partes que crescem rolam **dentro da própria caixa**.
- **Raiz do form** vira `flex h-full min-h-0 flex-col gap-3` (ocupa a altura do `<main>`).
- **Contexto**: card compacto (padding/altura menores), grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (empilha no
  estreito). Fica no topo, altura natural.
- **Área de ação** (o card "Peça" **ou** o painel de Embalagem/Integração + o `PainelResultado`): num container
  `flex-1 min-h-0`, com layout adaptativo:
  - **estreito (retrato):** empilhado (bipe/painel/ação em coluna).
  - **largo (`lg:` paisagem/web):** 2 colunas (`lg:grid lg:grid-cols-2 lg:gap-4`) — bipe/ação de um lado, resultado do outro.
- **Regiões que crescem** ganham `min-h-0 overflow-y-auto`: a lista de **defeitos** (ao reprovar), a **tabela de
  receita** da Integração, o **quadro de SNs** da Embalagem. Assim elas rolam internamente, não a página.
- **Nota (`<main>` global):** hoje é `flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8`. Pra o Lançamento preencher a altura,
  o wrapper usa `h-full` e as regiões internas contêm o overflow — sem mudar o `<main>` (que segue rolando nas outras
  páginas). Ajuste fino de altura/padding é iterativo (validar no smoke em retrato/paisagem/web).

### C. Demais operacionais
- **Manutenção, Consultar Integração, Consultar Caixa:** toda tabela dentro de um container `overflow-x-auto`
  (a maioria já tem — garantir); grids/filtros `grid-cols-1 sm:grid-cols-…` empilham; nada força largura fixa que
  estoure o corpo (`min-w-0` onde precisar). Sem scroll horizontal da página.

## Critérios de sucesso
- Desktop: o botão recolhe/mostra o menu; a preferência **persiste** ao recarregar/navegar.
- Lançamento (Peça/Embalagem/Integração/Burn-in) **cabe sem rolar a página** em tablet retrato, paisagem e web (caso
  normal de bipe); conteúdo grande rola dentro da caixa.
- Manutenção/Consultas: sem scroll horizontal da página; tabelas rolam no próprio container.
- Build/lint/test verdes. Sem migração.

## Riscos / considerações
- **"Sem scroll" é iterativo:** garantir no caso normal; validar as 3 orientações no smoke e ajustar altura/padding.
  Conteúdo genuinamente grande rola na região, não na tela.
- **Hydration/flash do menu:** ler `localStorage` no `useEffect` pode dar um flash do menu ao carregar recolhido — aceitável; se incomodar, dá pra suprimir com um `data-` inicial no `<html>` (fora do escopo por ora).
- **Não quebrar desktop atual:** o menu recolhido é opt-in (default mostrado); o drawer mobile fica intacto.
- Smoke: recolher/mostrar menu (persiste) · Lançamento nas 3 orientações (Peça, Burn-in, Embalagem, Integração, incl. reprovar/receita/quadro) · Manutenção/Consultas em tablet.
