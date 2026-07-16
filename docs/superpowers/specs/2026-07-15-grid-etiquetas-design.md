# Sub-filtro estilo planilha na tela de Etiquetas — Design

**Item 3 do roadmap pós-reunião** (`memory/roadmap-pos-reuniao.md`).

## Objetivo

Depois da busca principal (Nº NF / Nº embarque / Fornecedor), o **resultado**
ganha um **sub-filtro estilo Excel** nas colunas **Nº, Status, Código, Pedido,
Doc**: cada uma com **ordenar A→Z / Z→A**, **busca por texto** e **lista de
valores com checkbox**. Aplicado **no cliente**, em memória.

## Decisões (aprovadas)

1. **Dois níveis.** O **filtro principal** (NF/EMB/Fornecedor via `buscarEtiquetas`,
   teto de 500 linhas) **não muda**. O sub-filtro atua **sobre o resultado já
   carregado**.
2. **Client-side.** O resultado é ≤500 linhas e já está no navegador → o
   sub-filtro é em memória, **sem servidor**. NÃO reusa a máquina server-side do
   grid de Processos.
3. **Colunas com menu:** `Nº`, `Status`, `Código`, `Pedido`, `Doc`.
   **Volumes** e **Prévia** NÃO ganham menu (Volumes não foi pedido; Prévia é
   valor calculado). **Doc** é derivado (`DI/INPI` ou, na falta, `NF`) — o
   filtro/ordenação usa esse mesmo valor exibido.
4. **Status** no checkbox mostra o rótulo em **pt-BR** (`rotuloStatusProcesso`),
   mas filtra pelo valor cru.
5. **Seleção persiste por id.** O sub-filtro só **esconde** linhas — nunca
   desmarca. "Gerar" usa todas as selecionadas (visíveis ou não). O contador
   passa a mostrar `Y = linhas visíveis`.
6. **"Selecionar todos (elegíveis)"** respeita o sub-filtro: seleciona só os
   elegíveis **visíveis** (opção (a)).
7. **Efêmero, sem URL.** É estado em memória; some ao refazer a busca principal.
8. **Só no desktop** (o menu mora no cabeçalho da tabela). No mobile (cards) o
   sub-filtro fica para o **pacote de responsividade** (fim). A busca principal
   segue no mobile.

## Arquitetura

Sem migração, sem servidor novo. Domínio puro + UI.

### Domínio (TDD) — `src/modules/etiquetas/domain/sub-filtro.ts`

```ts
export type DirecaoSub = 'asc' | 'desc'
export type FiltroColunaSub = { texto?: string; valores?: string[] }

export interface SubFiltroEtiquetas {
  ordenar: string | null            // coluna, ou null = ordem original (numero desc do servidor)
  direcao: DirecaoSub
  filtros: Record<string, FiltroColunaSub>
}

export const SUB_FILTRO_PADRAO: SubFiltroEtiquetas = { ordenar: null, direcao: 'asc', filtros: {} }

/** Valor comparável de uma coluna, para uma linha. `numero` devolve number
 *  (ordena numericamente); o resto devolve string. */
export type Acessor<T> = (linha: T) => string | number | null

/** Valores distintos de uma coluna, a partir das linhas carregadas — para a
 *  lista de checkbox. Ordenados; valores vazios/nulos omitidos. */
export function valoresDistintosSub<T>(linhas: T[], acessor: Acessor<T>): string[]

/** Aplica o sub-filtro (busca por texto + checkbox de valores) e a ordenação,
 *  em memória, sobre as linhas. Ordem original preservada quando `ordenar` é
 *  null. Não muta a entrada. */
export function aplicarSubFiltro<T>(
  linhas: T[],
  subFiltro: SubFiltroEtiquetas,
  acessores: Record<string, Acessor<T>>,
): T[]
```

- **Filtro texto:** mantém linhas cujo `String(acessor(linha))` (case-insensitive)
  contém o texto.
- **Filtro valores:** mantém linhas cujo `String(acessor(linha))` está no
  conjunto de `valores`.
- **Ordenação:** por `acessor(ordenar)`; números comparados numericamente,
  strings por `localeCompare` (pt-BR); `null`/vazio vai para o fim; `direcao`
  aplica asc/desc. `ordenar === null` → mantém a ordem recebida.
- Colunas cujo campo não está em `acessores` são ignoradas (defesa).

### UI — `etiquetas-cliente.tsx`

- **Estado novo:** `const [subFiltro, setSubFiltro] = useState<SubFiltroEtiquetas>(SUB_FILTRO_PADRAO)`.
  Resetado a cada nova busca principal (`buscar()` faz `setSubFiltro(SUB_FILTRO_PADRAO)`).
- **Acessores** (de `ProcessoEtiquetaLista`):
  | Coluna | key | acessor | display no checkbox |
  |---|---|---|---|
  | Nº | `numero` | `p.numero` | valor cru |
  | Status | `status` | `p.status` | `rotuloStatusProcesso(v).rotulo` |
  | Código | `codigoMaterial` | `p.codigoMaterial ?? ''` | valor cru |
  | Pedido | `numeroPedido` | `p.numeroPedido ?? ''` | valor cru |
  | Doc | `doc` | `p.diInpi || p.numeroNf || ''` | valor cru |
- **Linhas exibidas:** `const linhasVisiveis = useMemo(() => aplicarSubFiltro(resultados ?? [], subFiltro, ACESSORES), [resultados, subFiltro])`.
  A tabela e os cards passam a iterar `linhasVisiveis` no lugar de `resultados`.
- **Menu de coluna** (`MenuColunaEtiqueta`, componente novo no mesmo arquivo ou
  irmão): Popover no cabeçalho com ordenar A→Z/Z→A + `Input` de busca + lista de
  `Checkbox` dos valores distintos (de `valoresDistintosSub(resultados, acessor)`;
  Status exibe o rótulo pt-BR) + Limpar/Aplicar. Reusa `Popover`/`Checkbox`
  (criados no grid de Processos). **Não** reusa o `MenuColuna` do grid (aquele
  chama Server Action; aqui os valores são de memória).
- **Contador:** `{selecionados.size} selecionado(s) de {linhasVisiveis.length} visível(is)`.
- **`selecionarTodosElegiveis`:** passa a operar sobre `linhasVisiveis` (só os
  elegíveis visíveis).
- **`previas`/`elegibilidades`:** continuam mapeadas por `id` sobre `resultados`
  (não muda — são lookups por id, e as linhas visíveis são um subconjunto).
- **Seleção:** inalterada (por id); o sub-filtro nunca mexe em `selecionados`.

### O que NÃO muda

- Server Actions `buscarEtiquetas`/`gerarEtiquetas`, o repositório, o domínio de
  part number. O sub-filtro é puramente de exibição no cliente.
- Os cards mobile continuam iterando as linhas visíveis, mas **sem** os menus de
  coluna (responsividade do sub-filtro fica para o pacote do fim).

## Validação e erros

| Situação | Comportamento |
|---|---|
| Sub-filtro sem resultado | Tabela vazia com a mensagem já existente; seleção intacta |
| Coluna de texto vazia numa linha | Conta como valor vazio; omitida da lista de checkbox |
| Nova busca principal | `subFiltro` volta ao padrão; seleção limpa (como hoje) |
| Ordenar por Nº | Numérico (não alfabético) |

## Fora de escopo

- Sub-filtro no mobile (cards) → pacote de responsividade.
- Filtrar Volumes/Prévia.
- Persistir o sub-filtro na URL.
- Qualquer mudança no filtro principal ou na geração.

## Testes

- **TDD (domínio `sub-filtro.ts`):**
  - `valoresDistintosSub`: distintos, ordenados, sem vazios.
  - `aplicarSubFiltro`: filtro texto (case-insensitive); filtro por valores;
    ordenar Nº (numérico) asc/desc; ordenar textual (localeCompare); `ordenar
    null` mantém a ordem; combinação texto+valores; não muta a entrada; acessor
    derivado (Doc) funciona.
- **UI:** build + smoke.
- **Smoke:** buscar por fornecedor → no resultado, ordenar **Código** A→Z; filtrar
  **Status** por "Aprovado" (checkbox em pt-BR) e conferir que some o resto;
  selecionar os visíveis com "Selecionar todos (elegíveis)"; mudar o filtro e
  confirmar que a seleção persiste; gerar e conferir o CSV; refazer a busca e ver
  o sub-filtro zerar.
