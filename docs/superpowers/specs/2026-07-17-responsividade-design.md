# Responsividade — pacote final — Design

**Melhoria de alcance** (`memory/roadmap-pos-reuniao.md`, seção RESPONSIVIDADE). Mockup do
card do Grid aprovado pelo usuário.

## Objetivo

Fechar a responsividade do sistema: dar versão em **card** às 2 telas que ainda não têm, e
uniformizar o ponto de corte tabela↔card em **1024px** (tablet em pé = card, tablet deitado /
desktop = tabela).

## Contexto atual

- **Quase tudo já é responsivo** (tabela↔card via `md:hidden` no bloco de cards + `hidden
  md:block` no bloco da tabela): toda a Configurações (Campos, Criticidade, Listas, Logs, NQA,
  Perfis, Usuários), Etiquetas (a busca), histórico de etiquetas, Importações; o shell já vira
  drawer.
- **Correção (descoberta ao explorar o código):** as Etiquetas **já têm** um card mobile
  completo (checkbox de seleção + Nº + Status + Código/Pedido/Doc/Volumes/Prévia,
  iterando `linhasVisiveis`). Então **só o Grid de Processos** (`processos-grid.tsx`) está
  de fato sem card. O card das Etiquetas existe mas: usa o corte `md`, e **não** tem os
  menus de sub-filtro no mobile (o `MenuColunaEtiqueta` só vive no cabeçalho da tabela).
- **Corte atual = 768px (`md`).** Tablet em pé (768) cai na tabela.
- **~9 telas de Configurações + Importações** já têm card **simples** (rótulo à esquerda,
  valor à direita, sem tracejado/ver mais).

## Decisões (aprovadas)

1. **Corte 768→1024 (`md`→`lg`) em TODAS as telas**, para consistência: em qualquer tela,
   tablet em pé mostra card, tablet deitado mostra tabela. Troca **cirúrgica** — só as classes
   que fazem o switch tabela↔card (`md:hidden` nos blocos de card, `hidden md:block` nos blocos
   de tabela). **NÃO** mexer em outras utilidades `md:` (ex.: `sm:grid-cols-3 md:grid-cols-4`
   da grade de fotos em `anexos-processo.tsx` — não é switch de card).
2. **Card do Grid de Processos:** **Nº** como título + **Status** como badge no topo; as demais
   colunas **visíveis** (o que o admin configurou em Colunas da Lista) como lista `rótulo···valor`
   com **tracejado** (leader dots) ligando os dois. **Teto de 6 colunas + "ver mais"** (revela o
   resto; vira "ver menos"). O card inteiro é um link para o detalhe, levando `?g=&i=` (as setas
   continuam funcionando). Reusa a mesma formatação de célula (`celula()`).
3. **Ordenar/filtrar no card:** uma **barra de "chips"** no topo — um chip por coluna visível,
   cada um sendo o **mesmo `MenuColuna`** que já existe no desktop (ordenar + busca + checkboxes).
   Chip com filtro/ordenação ativo fica destacado. **Zero lógica nova** — só relocação do menu.
4. **Rodapé de paginação** reusado (já fica fora da `<Table>`, então serve os dois modos).
5. **Estilo novo (tracejado + "ver mais" + chips) só nas 2 GRADES** (Grid de Processos e
   Etiquetas — telas de tabela pesada com muitas colunas). As **~9 telas de Configurações /
   Importações mantêm o card simples** que já têm (poucas colunas fixas; retrofit seria
   retrabalho por estética). Consistência entre as duas grades; simplicidade nas de config.
6. **Etiquetas copia o Grid:** o card já existe — o upgrade é (a) converter os `dl` para o
   estilo `rótulo···valor` com tracejado e (b) adicionar a **barra de chips** com os
   `MenuColunaEtiqueta`, tornando o sub-filtro **usável no celular** (hoje só no desktop). O
   checkbox de seleção e a lógica de gerar **não mudam**. ("Ver mais" não dispara — são ~5
   colunas, abaixo do teto de 6.)
7. **Sem TDD** — é apresentação. Garantia por build + smoke.

## Arquitetura

### Ponto de corte (mecânico, todas as telas)

Trocar, **apenas** nos pares que fazem o switch tabela↔card:
- `md:hidden` → `lg:hidden` (bloco dos cards)
- `hidden md:block` → `hidden lg:block` (bloco da tabela)

Telas afetadas (as que já têm o par): `configuracoes/{campos,criticidade,listas,listas/[chave],
logs,nqa,perfis,usuarios}`, `recebimento/etiquetas/etiquetas-cliente`,
`recebimento/etiquetas/historico`, `recebimento/importacoes`. (O plano confirma cada par por
grep antes de trocar; nada além do switch.)

### Grid de Processos — `processos-grid.tsx`

O componente já é client e já recebe `colunas` (visíveis), `linhas`, `estado`. Estrutura nova:

- **Tabela** (hoje) envolvida em `hidden lg:block`.
- **Bloco de card** novo em `lg:hidden`:
  - **Barra de chips** (`overflow-x-auto`): para cada `coluna`, um `MenuColuna` (o mesmo do
    header) como trigger em pílula. Reusa o componente inteiro — ele já sabe abrir o Popover
    com ordenar/busca/checkbox e chamar `aplicar`.
  - **Lista de cards:** para cada `linha`, um `<Link>` para
    `/recebimento/processos/${id}?${g,i}` (mesma URL da seta da tabela), contendo:
    - topo: `Nº {numero}` + badge de status (`rotuloStatusProcesso`);
    - `<dl>` com as colunas visíveis **exceto** `numero` e `status`, cada uma
      `<dt>rótulo</dt><span leader-dots/><dd>{celula(coluna, valor)}</dd>`;
    - teto de 6 linhas + botão **"ver mais/menos"** (estado local por card → um pequeno
      componente `CardProcesso` client com `useState`).
  - **Vazio:** "Nenhum processo encontrado para os filtros aplicados." (igual à tabela).
- **Rodapé** de paginação: fica fora dos dois blocos (serve ambos).

### Etiquetas — `etiquetas-cliente.tsx` (upgrade do card existente)

- O corte da tabela/card de resultados já existe (`md:` → `lg:` pela Task do corte).
- **Adicionar** ao bloco de card (`lg:hidden`, já existente): uma **barra de chips** no topo
  com os `MenuColunaEtiqueta` (um por coluna do sub-filtro), tornando ordenar/filtrar usável no
  celular. **Converter** os `dl` do card para o estilo `rótulo···valor` com tracejado (leader
  dots). O **checkbox de seleção**, o Nº, o badge de status e a lógica de gerar **não mudam**.

### Leader dots (tracejado)

Um `<span>` com `flex:1; border-bottom: 1px dotted; transform: translateY(-4px)` entre `<dt>` e
`<dd>` numa linha flex. Sem imagem, sem dependência.

## Fora de escopo

- Redesenhar as telas já responsivas (só o corte muda nelas).
- Card para telas que não são tabela (formulários já fluem).
- Mudar o conteúdo/ordenação do grid — é o mesmo dado, só outra apresentação.
- Gestos (swipe), colunas fixas, densidade ajustável.

## Testes

- **Sem TDD** (apresentação).
- **tsc + lint + build.**
- **Smoke (redimensionar a janela / DevTools device):**
  - **Grid de Processos** abaixo de 1024: vira cards (Nº + Status + colunas visíveis com
    tracejado, teto 6 + ver mais); a barra de chips ordena/filtra igual ao desktop; abrir um
    card leva ao detalhe com as setas funcionando; paginação funciona; acima de 1024 volta à
    tabela.
  - **Etiquetas** abaixo de 1024: resultados viram cards; o checkbox de seleção funciona e o
    "Gerar" usa a seleção; chips filtram/ordenam.
  - **Uma tela já responsiva** (ex.: Configurações → Campos): agora vira card em tablet em pé
    (≤1024), não só em celular.
  - Nenhuma regressão no desktop.
