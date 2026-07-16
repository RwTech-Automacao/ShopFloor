# Padrões de mapeamento reutilizáveis (importação) — Design

**Item 4 do roadmap pós-reunião** (`memory/roadmap-pos-reuniao.md`).

## Objetivo

Na importação de planilhas, permitir **salvar o de-para de colunas** (o mapeamento
coluna-da-planilha → campo do sistema) com um **nome** e **reaplicá-lo** nas próximas
importações, vindo pré-preenchido. Isso evita remapear manualmente a mesma planilha
de fornecedor toda vez. Importar **sem** salvar padrão (avulso) continua funcionando
como hoje.

## Decisões (aprovadas)

1. **O que o padrão guarda:** apenas o `Record<campo_do_banco, nome_da_coluna>` dos
   campos **mapeáveis**, mais um **nome**. NÃO guarda `data_chegada`/`numero_emb` (são
   por-importação, digitados no wizard) nem o arquivo.
2. **Compartilhados, todos que importam gerenciam.** Um catálogo único visto por todos
   com permissão `importar`; qualquer um cria/edita/exclui. Admin (`administrar`)
   também. Não é por-usuário.
3. **Tudo dentro do wizard** (Passo 2 – Mapear): aplicar, salvar, atualizar e excluir
   ali mesmo. Sem tela separada em Configurações.
4. **Casamento tolerante (trocável).** Ao aplicar um padrão, cada coluna salva é casada
   contra as colunas da planilha atual por **nome normalizado** (`normalizarNome`, que
   já existe e é o mesmo usado na sugestão automática) — ignora acento, caixa e
   espaços. Fica **isolado numa função de domínio**, então trocar depois para exato ou
   híbrido é mudança localizada, sem migração (o padrão guarda os nomes crus das
   colunas).
5. **Aplicar substitui tudo.** Aplicar um padrão **substitui** o mapeamento atual pelo
   do padrão (casado). Ação limpa e previsível, sem mesclar com o palpite automático.
6. **Salvar exige ≥1 coluna mapeada.** Padrão vazio não é permitido.
7. **Defesa:** se um campo foi **desativado** no catálogo depois que o padrão foi salvo,
   ele é descartado ao aplicar.
8. **Nome único** (case-insensitive). Nome vazio ou duplicado → erro amigável.

## Arquitetura

Migração nova + quatro camadas. Reusa `normalizarNome` (domínio de mapeamento) e o
gate `tem_permissao('importar')` (já existe desde a 0001).

### Migração 0022 — `padroes_importacao`

```sql
create table public.padroes_importacao (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  mapeamento  jsonb not null default '{}'::jsonb,   -- { campo_do_banco: nome_da_coluna }
  criado_por  uuid references public.usuarios(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index padroes_importacao_nome_unq
  on public.padroes_importacao (lower(nome));

alter table public.padroes_importacao enable row level security;

-- Todos que importam gerenciam; admin também.
create policy padroes_importacao_select on public.padroes_importacao
  for select to authenticated
  using (public.tem_permissao('importar') or public.tem_permissao('administrar'));
create policy padroes_importacao_write on public.padroes_importacao
  for all to authenticated
  using (public.tem_permissao('importar') or public.tem_permissao('administrar'))
  with check (public.tem_permissao('importar') or public.tem_permissao('administrar'));
```

`updated_at` é atualizado explicitamente na operação de `atualizarPadrao` (set
`updated_at = now()`). Sem trigger novo (YAGNI).

### Domínio (TDD) — `src/modules/recebimento/domain/padrao-importacao.ts`

```ts
/** Mapa campo_do_banco → nome_da_coluna_da_planilha (o que um padrão guarda). */
export type MapeamentoSalvo = Record<string, string>

export interface ResultadoAplicarPadrao {
  /** campo_do_banco → nome_da_coluna, já casado com as colunas ATUAIS. */
  mapeamento: Record<string, string>
  /** Nomes de coluna do padrão que não existem na planilha atual (para o aviso). */
  colunasNaoEncontradas: string[]
}

/**
 * Aplica um padrão salvo às colunas da planilha atual. Casa cada coluna salva por
 * nome NORMALIZADO contra `colunasAtuais`; descarta campos que não estão mais em
 * `camposMapeaveis` (desativados). Substitui o mapeamento por completo.
 */
export function aplicarPadrao(
  mapeamentoSalvo: MapeamentoSalvo,
  colunasAtuais: string[],
  camposMapeaveis: CampoImportavel[],
): ResultadoAplicarPadrao

/** Nome não vazio após trim. */
export function nomePadraoValido(nome: string): boolean
```

- `aplicarPadrao`: para cada `[campo, colunaSalva]` do padrão, se `campo` está em
  `camposMapeaveis` E existe uma coluna atual com `normalizarNome` igual, mapeia para o
  **nome real da coluna atual** (não o salvo). Colunas salvas sem correspondência entram
  em `colunasNaoEncontradas`. Campos desativados são simplesmente ignorados (não contam
  como "não encontrada").
- Não muta as entradas.

### Infra — `src/modules/recebimento/infra/padrao-importacao-repository.ts`

```ts
export interface PadraoImportacao {
  id: string
  nome: string
  mapeamento: Record<string, string>
  updatedAt: string
}

export async function listarPadroesImportacao(): Promise<PadraoImportacao[]> // ordem: nome asc
export async function inserirPadraoImportacao(nome: string, mapeamento: Record<string, string>): Promise<PadraoImportacao>
export async function atualizarPadraoImportacao(id: string, mapeamento: Record<string, string>): Promise<PadraoImportacao> // set updated_at
export async function excluirPadraoImportacao(id: string): Promise<void>
```

A RLS é a autoridade; o repositório não recheca permissão (mas a Server Action valida
a sessão, como no resto do projeto).

### Application (Server Actions) — `src/modules/recebimento/application/padroes-importacao.ts`

`'use server'`. Cada action: valida sessão + `podeFazer(perfil, 'importar')`, chama o
repositório, e **retorna a lista atualizada** (`listarPadroesImportacao`) para o wizard
atualizar o estado local sem full refresh.

```ts
type ResultadoPadroes =
  | { ok: true; padroes: PadraoImportacao[] }
  | { ok: false; erro: string }

export async function salvarPadrao(nome: string, mapeamento: Record<string, string>): Promise<ResultadoPadroes>
export async function atualizarPadrao(id: string, mapeamento: Record<string, string>): Promise<ResultadoPadroes>
export async function excluirPadrao(id: string): Promise<ResultadoPadroes>
```

- `salvarPadrao`: valida `nomePadraoValido` e `Object.keys(mapeamento).length >= 1`;
  traduz violação do índice único (código Postgres `23505`) em
  `{ ok: false, erro: 'Já existe um padrão com esse nome.' }`.
- Sem permissão → `{ ok: false, erro: '...' }`.

### UI — `src/app/(app)/recebimento/importar/`

- **`page.tsx`** (server): carrega `listarPadroesImportacao()` e passa `padroes` ao
  wizard (junto de `campos`/`itensPorLista`).
- **`wizard-importacao.tsx`** (client): novo estado `padroes` (inicia com a prop) e
  `padraoSelecionadoId`. No **Passo 2**, uma barra "Padrão de mapeamento" acima da tabela:
  - `Select` "Aplicar padrão" (lista por nome). `onValueChange` → chama `aplicarPadrao`
    e faz `setMapeamento(resultado.mapeamento)`; guarda `colunasNaoEncontradas` para o
    aviso; marca `padraoSelecionadoId`.
  - Botão **"Salvar como padrão"** → abre um campo de nome inline (pequeno popover/linha
    com `Input` + confirmar); ao confirmar, chama `salvarPadrao(nome, mapeamento)` numa
    transição; em `ok`, atualiza `padroes` e seleciona o novo; em erro, mostra a mensagem.
  - Quando há `padraoSelecionadoId`: **"Atualizar"** (chama `atualizarPadrao(id, mapeamento)`)
    e **"Excluir"** (confirmação simples → `excluirPadrao(id)`, limpa a seleção).
  - Aviso discreto quando `colunasNaoEncontradas.length > 0`.
  - Só `mapeamento` (campos mapeáveis) participa — os digitados seguem intocados.

## Fluxo de dados

```
page.tsx (server) --listarPadroesImportacao--> wizard (prop padroes)
Passo 2:
  aplicar   -> aplicarPadrao(domínio) -> setMapeamento
  salvar    -> salvarPadrao(action)    -> setPadroes + seleciona
  atualizar -> atualizarPadrao(action) -> setPadroes
  excluir   -> excluirPadrao(action)   -> setPadroes + limpa seleção
```

## Validação e erros

| Situação | Comportamento |
|---|---|
| Salvar sem nenhuma coluna mapeada | Bloqueado com aviso ("Mapeie ao menos uma coluna…") |
| Nome vazio | Bloqueado com aviso |
| Nome duplicado (índice único) | Action devolve "Já existe um padrão com esse nome." |
| Aplicar padrão com colunas ausentes na planilha atual | Aplica o que casou; aviso lista quantas não foram encontradas; campos ficam "Não mapear" |
| Campo do padrão foi desativado no catálogo | Descartado ao aplicar (silencioso; não conta como "não encontrada") |
| Sem permissão `importar` | Actions retornam erro; a página de importar já bloqueia o acesso |
| Excluir | Confirmação antes |

## Fora de escopo

- Tela de gestão de padrões em Configurações (tudo no wizard).
- Padrões por-usuário (são compartilhados).
- Salvar `data_chegada`/`numero_emb` no padrão (são por-importação).
- Versionamento/histórico de padrões.
- Aplicar padrão automaticamente por heurística (o usuário escolhe manualmente).

## Testes

- **TDD (domínio `padrao-importacao.ts`):**
  - `aplicarPadrao`: casamento exato; casamento normalizado (acento/caixa/espaço);
    coluna salva ausente entra em `colunasNaoEncontradas`; campo desativado é
    descartado (e não vira "não encontrada"); substitui por completo; usa o nome REAL
    da coluna atual (não o salvo); não muta as entradas; padrão vazio → mapeamento vazio.
  - `nomePadraoValido`: vazio/espaços → false; com conteúdo → true.
- **Infra/Application/UI:** build + smoke.
- **Smoke:** abrir uma planilha, mapear, "Salvar como padrão" com nome; reabrir outra
  planilha (mesmo fornecedor), aplicar o padrão e ver o mapeamento vir pronto; renomear
  não está no escopo — "Atualizar" grava o mapeamento atual; excluir some da lista;
  tentar salvar nome duplicado → erro; tentar salvar sem mapear nada → bloqueado.
- **Migração 0022** aplicada em produção (seguro — sem dado real).
