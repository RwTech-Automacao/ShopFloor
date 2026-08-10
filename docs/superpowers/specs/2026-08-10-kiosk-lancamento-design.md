# Modo Kiosk do ShopFloor — Design

> **Data:** 2026-08-10 · **Módulo:** ShopFloor (app-shell + Operação/Análise) · **Branch:** `feat/shopfloor-kiosk`
> **Tipo:** trava de navegação (kiosk) por terminal, sem migração.

## Contexto e objetivo
O Lançamento vai rodar num equipamento touchscreen no chão de fábrica. O operador deve ficar **preso a um
conjunto de abas** e só **sair com senha de supervisor**. Hoje o RBAC é por **seção/permissão** (a permissão
`lancar` abre a seção Operação inteira = Lançamento + Consultar Integração + Manutenção; `visualizar` abre a
Análise inteira). Não dá pra restringir a **abas específicas**. O Kiosk resolve isso por terminal.

**Abas que o operador vai usar:** **Lançamento** (`/shopfloor/operar/lancamento`) + **Pesquisa**
(`/shopfloor/analisar/pesquisa`) — duas seções diferentes.

## Decisões (do usuário)
- **Conjunto configurável** de abas (não fixo em Lançamento) — ex.: Chão de fábrica = Lançamento + Pesquisa;
  Reparo = Lançamento + Manutenção.
- **Kiosk por terminal:** configurado uma vez no aparelho (guardado em `localStorage`); sempre abre travado.
- **Sair = login do supervisor** (e-mail + senha), validado + checando permissão `administrar`.

## Estrutura atual (achados)
- **Menu (`app-shell.tsx`):** itens de topo — Home, Recebimento, **Operação** (`/shopfloor/operar`), **Análise**
  (`/shopfloor/analisar`), Registros, Ordens, Configurações…
- **Abas dentro das páginas (`AbasFluxo`):** Operação = [Lançamento, Consultar Integração, Manutenção];
  Análise = [Dashboard, Pesquisa, Burn-in, Caixas, Fluxo].
- A aba permitida é sempre uma **rota folha** (ex.: `/shopfloor/operar/lancamento`). Menu, barra de abas e guarda
  de rota derivam disso por **prefixo**.

## Design

### Config do kiosk (por terminal, sem banco)
`localStorage['sf:kiosk']` = `{ ligado: boolean, abas: string[] }`, onde `abas` é a lista de **rotas folha**
permitidas (ex.: `['/shopfloor/operar/lancamento','/shopfloor/analisar/pesquisa']`). Um `KioskProvider`
(client, no app-shell) lê isso e expõe `{ ligado, abas, rotaInicial }`.

### 1) Entrada / setup (supervisor liga o kiosk no terminal)
Tela/dialog "Modo quiosque" (visível só pra quem tem `administrar`): checklist de todas as abas (agrupadas por
seção) + botão **Ativar**. Ao ativar: grava o `localStorage`, entra em **tela cheia** (Fullscreen API) e recarrega
travado na `rotaInicial` (1ª aba permitida).

### 2) Menu travado (app-shell)
Quando `ligado`: esconde o menu completo. Mostra só um **cabeçalho enxuto** com as abas permitidas (ou nada, já
que a barra `AbasFluxo` cobre) + um botão **🔒 Sair do modo quiosque**. Itens de seção aparecem só se contêm
alguma aba permitida (prefixo): Operação some se nenhuma `abas` começa com `/shopfloor/operar`, etc.

### 3) Barra de abas filtrada (`AbasFluxo`)
`AbasFluxo` passa a esconder as abas fora de `abas` quando o kiosk está `ligado` (Operação mostra só Lançamento;
Análise mostra só Pesquisa). Fora do kiosk, mostra tudo (inalterado).

### 4) Guarda de rota
Um guard client (no app-shell/layout): se `ligado` e a rota atual não casa com nenhuma `abas` (por prefixo),
**redireciona** pra `rotaInicial`. Impede digitar a URL de uma aba proibida.

### 5) Saída (login do supervisor)
Botão 🔒 → diálogo com **e-mail + senha**. Server action `validarSupervisor(email, senha)`:
- cria um **client Supabase isolado** e faz `signInWithPassword` **só pra verificar** (não troca a sessão do
  operador);
- confere que o usuário validado tem **`administrar`** no perfil;
- se ok → resposta ok. O cliente **limpa o `localStorage`**, sai da tela cheia e recarrega **destravado**.
Erros claros: credencial inválida / sem permissão.

## Fora de escopo (MVP)
- **Workspace nomeado reusável no banco** (tabela + tela) — o MVP usa config por terminal (localStorage). Fica
  como evolução se quiserem reaproveitar entre terminais.
- **Lockdown do SO** (impedir fechar o navegador) — é config do equipamento (Chrome `--kiosk`/quiosque do SO),
  não código. Documentar à parte.

## Critérios de sucesso
- Terminal configurado abre **travado** nas abas escolhidas; menu e barra de abas mostram só elas; URL proibida
  redireciona.
- Sair só com **e-mail+senha de um supervisor com `administrar`**; sem isso, fica preso.
- **Sem migração.** build+lint+test verdes. Fora do kiosk, nada muda.

## Riscos
- **Validar senha sem derrubar a sessão do operador:** usar client Supabase isolado (`signInWithPassword` só pra
  checar). Testar que a sessão atual não é trocada.
- **localStorage apagado** (limpeza do device) → terminal destrava; re-configurar. Aceitável pra MVP.
- Fullscreen API precisa de gesto do usuário (o clique em "Ativar" serve).

## Dimensionamento
Tudo numa branch, **~1 cadência**, **sem migração**:
- Config/provider (localStorage) — P · Setup/ativar — P/M · Menu travado (app-shell) — M · AbasFluxo filtra — P ·
  Guarda de rota — P · Diálogo de saída + `validarSupervisor` — M (o ponto sensível).
