# Importação: data de chegada digitada + Nº EMB do nome do arquivo — Design

**Item 1 do roadmap pós-reunião** (`memory/roadmap-pos-reuniao.md`). Duas mudanças
na mesma tela (wizard de importação), num ciclo só.

## Objetivo

1. **Data de chegada** deixa de ser mapeada de uma coluna e passa a ser
   **digitada no momento da importação**, aplicada a **todos** os processos da
   planilha (os itens chegam juntos).
2. **Nº EMB** passa a vir dos **8 primeiros caracteres do nome do arquivo**
   importado, **pré-preenchido e editável**, também aplicado a todos.

## Decisões (aprovadas)

1. **`data_chegada` e `numero_emb` saem do mapeamento** — viram **campos
   digitados** ("valores fixos" da importação). Continuam aparecendo na
   **prévia** e passando pela **validação/conversão** normalmente.
2. **Obrigatoriedade = a configuração que já existe.** O switch
   **"Obrigatório na importação"** (Configurações → Campos, coluna
   `configuracao_campos.obrigatorio_importacao`) passa a valer para os campos
   digitados: se marcado, o wizard **trava** o avanço enquanto o valor estiver
   vazio. **Nada novo a construir** — a tela e o backend já existem.
3. **Nº EMB** = `nomeDoArquivo.slice(0, 8)` (ex.: `EMB341EA - ESTADOS UNIDOS.xlsx`
   → `EMB341EA`), **editável** pelo usuário.
4. **Os valores fixos são injetados DEPOIS da checagem de "linha vazia"** — ver
   "Risco conhecido".
5. **Sem migração** e **sem mudança no servidor**.

## Risco conhecido (o motivo de um teste dedicado)

A planilha real do Comercial tem **dezenas de linhas em branco no fim** (foram
83 num smoke anterior). O wizard as descarta via `linhaMapaVazia`. Como a data e
o EMB são **iguais em todas as linhas**, se fossem injetados **antes** da
checagem, **nenhuma linha seria mais considerada vazia** e as linhas em branco
**virariam processos**. Este bug já ocorreu uma vez no projeto (por outro
motivo) — por isso a ordem vira **regra testada**, não convenção.

## Arquitetura

Sem migração, sem tocar em Server Action/RPC: os valores entram nas linhas no
cliente, e a RPC `importar_processos` **já insere** `data_chegada` e
`numero_emb` (as chaves das linhas já são os nomes das colunas do banco).

### Domínio (TDD)

**`src/modules/recebimento/domain/mapeamento.ts`** (arquivo existente):

```ts
/** Campos que NÃO são mapeados de coluna: o usuário digita/edita uma vez e o
 *  valor vale para todas as linhas da planilha. */
export const CAMPOS_DIGITADOS = ['data_chegada', 'numero_emb'] as const

/** Nº EMB a partir do nome do arquivo: os 8 primeiros caracteres
 *  ('EMB341EA - ESTADOS UNIDOS.xlsx' → 'EMB341EA'). Nome com menos de 8
 *  caracteres devolve o que houver; o campo é editável de qualquer forma. */
export function numeroEmbDoArquivo(nomeArquivo: string): string
```

**`src/modules/recebimento/domain/validacao-linha.ts`** (arquivo existente) —
move a montagem das linhas (hoje inline no `useMemo` do wizard) para o domínio,
onde a ordem crítica fica testável:

```ts
/** Monta e valida as linhas da importação. Os `valoresFixos` (campos digitados)
 *  são aplicados SOMENTE às linhas que não são vazias — a checagem de vazio
 *  considera apenas os campos vindos da planilha, senão toda linha em branco
 *  passaria a "ter dado" e viraria processo. */
export function prepararLinhasImportacao(params: {
  linhasBrutas: Record<string, unknown>[]
  campos: CampoImportavel[]                     // todos (para validar/preview)
  mapeamento: Record<string, string>            // campo -> coluna da planilha
  valoresFixos: Record<string, string | null>   // ex.: { data_chegada, numero_emb }
  itensPorLista: Record<string, string[]>
}): { validadas: ReturnType<typeof validarLinha>[]; vazias: number }
```

Lógica: para cada linha bruta, monta o mapa **só com os campos mapeáveis**
(`campos` menos `CAMPOS_DIGITADOS`); se `linhaMapaVazia(mapa, camposMapeaveis)`
→ conta como vazia e pula; **senão** aplica os `valoresFixos` e chama
`validarLinha(mapa, campos, itensPorLista)` (com a lista **completa**, para os
campos digitados também serem convertidos/validados).

### UI — `wizard-importacao.tsx`

- **Estado novo:** `dataChegada` (string `'YYYY-MM-DD'`) e `numeroEmb` (string).
- **Passo 1:** ao ler o arquivo, além de `setArquivoNome(file.name)`, faz
  `setNumeroEmb(numeroEmbDoArquivo(file.name))`.
- **Passo 2 (Mapear):** bloco novo **acima** da tabela de mapeamento —
  *"Dados desta importação (aplicados a todos os processos)"* com:
  - **Data de chegada:** `<input type="date">` (produz `'YYYY-MM-DD'`, que é o
    que a coluna `date` espera).
  - **Nº EMB:** `<Input type="text">`, pré-preenchido, editável.
  - Cada um exibe `*` quando o campo estiver marcado como obrigatório.
  - A **tabela de mapeamento** passa a receber apenas `camposMapeaveis`
    (`campos` menos `CAMPOS_DIGITADOS`). `sugerirMapeamento` idem — não faz
    sentido sugerir coluna para campo digitado.
- **Trava de obrigatórios** (`camposFaltando`): para campo digitado, "falta" =
  **valor vazio**; para campo mapeável, "falta" = **coluna não mapeada** (regra
  atual). Ambos só valem se `obrigatorioImportacao` estiver marcado.
- **Passo 3 (Prévia):** sem mudança estrutural — as colunas Data Chegada e Nº EMB
  aparecem preenchidas com o valor fixo (vêm nos `valores` de cada linha).
- **Passo 4 (Importar):** o card de resumo passa a exibir **Data de chegada** e
  **Nº EMB** junto de Arquivo/Linhas, para conferência antes de confirmar.

### O que NÃO muda

- Server Action `importarPlanilha`, repositório `chamarImportarProcessos` e a
  RPC `importar_processos` (0008) — **intocados**.
- `configuracao_campos` — **sem migração**; `data_chegada` e `numero_emb` seguem
  com `obrigatorio_importacao = false` (o admin liga se quiser, na tela Campos).

## Validação e erros

| Situação | Comportamento |
|---|---|
| Data marcada como obrigatória e vazia | "Próximo/Importar" travado, com o rótulo listado nos campos faltando |
| Nº EMB marcado como obrigatório e vazio | idem |
| Nenhum dos dois obrigatório e vazios | Importa: processos ficam sem data ("Aguardando data de chegada") / sem EMB |
| Nome de arquivo com < 8 caracteres | `numeroEmbDoArquivo` devolve o que houver; usuário edita |
| Linhas em branco no fim da planilha | Continuam sendo descartadas e contadas em "N em branco ignoradas" |
| Data digitada inválida | O `<input type="date">` já impede; `converterValor` é a segunda barreira |

## Fora de escopo

- Mapeamentos reutilizáveis (padrões salvos) — é o **item 4** do roadmap.
- Qualquer mudança na RPC/servidor.
- A regra "quantidade recebida 0 → zerar data" — **descartada** pelo usuário.

## Testes

- **TDD (domínio):**
  - `numeroEmbDoArquivo`: 8 primeiros caracteres; nome curto; nome com espaços.
  - `prepararLinhasImportacao`:
    - **linha em branco continua sendo descartada mesmo com valores fixos**
      (o risco conhecido — teste principal);
    - valores fixos aplicados às linhas válidas;
    - campos digitados **não** são lidos do mapeamento (ignora coluna mapeada
      para eles, se houver resquício).
- **Wizard/UI:** build + smoke.
- **Smoke:** importar a planilha real → conferir que (a) o EMB veio do nome do
  arquivo, (b) a data digitada aparece na prévia e nos processos criados, (c) as
  linhas em branco continuam sendo ignoradas, (d) marcar "Obrigatório na
  importação" na Data Chegada trava o avanço com o campo vazio.
