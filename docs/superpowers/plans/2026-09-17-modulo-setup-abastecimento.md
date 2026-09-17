# Módulo Setup (montagem de setup e abastecimento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o módulo **Setup**, separado do ShopFloor, com:
- estrutura de componentes por PMO, importada da composição de produto do ERP;
- montagem de setup por OP (do zero ou copiando de uma OP anterior), com controle do rolo montado em cada posição;
- abastecimento (troca de rolo) com aprovação ou reprovação e motivos;
- consultas de setups e de trocas;
- cadastros de linhas, máquinas e blocos.

**Architecture:**
- **Banco:** tabelas `st_*` com RLS por módulo (`tem_permissao('setup', …)`). Toda escrita de operação passa por funções `security definer` atômicas, com lock por setup, que devolvem códigos de erro (`raise exception 'CODIGO'`). Essas funções são a fonte da verdade das regras.
- **Domínio TS puro e testado:** parser do código do rolo, normalização de face, leitura da composição do ERP, prévia da importação e mensagens dos códigos de erro.
- **App:** telas Next.js (App Router) seguindo os padrões do ShopFloor: `PainelResultado`, `tocarErro`, CRUDs de Configurações e server actions `{ ok } | { ok: false, erro }`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4 + shadcn/ui (Base UI), Supabase (Postgres 15, PostgREST), SheetJS (`xlsx`), Vitest, Docker `postgres:15-alpine` pra testar SQL.

**Spec:** `docs/superpowers/specs/2026-09-16-modulo-setup-abastecimento-design.md`

## Global Constraints

- **Branch/worktree:** `feat/setup-abastecimento` em `/home/rwtech/Área de trabalho/ShopFloor-setup` (tem `node_modules` real e `.env.local` do Dev). Nunca trabalhar na `main`.
- **Idioma:** textos de UI, mensagens, comentários e commits em **português (PT-BR)**. Commits terminam com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Módulo:** chave `'setup'`, rótulo `'Setup'`. Permissões `visualizar`, `lancar`, `administrar`.
  - montar setup e trocar rolo = `lancar`;
  - estrutura, cadastros e edição de setup liberado = `administrar`;
  - consultas = `visualizar`.
- **Migrações:** próximas livres = `0110`, `0111`, `0112`.
  - **SQL Editor do Supabase não aceita `$$`**: usar `$func$`.
  - Toda policy usa `(select tem_permissao('setup', '<nivel>'))` (padrão da 0096).
  - Toda tabela nova tem GRANT explícito (padrão da 0107): `grant select … to authenticated; grant select, insert, update, delete … to service_role;`.
  - Terminar com `notify pgrst, 'reload schema';`.
- **'use server':** arquivos de action exportam **só funções async** (tipos podem ser exportados; constantes não).
- **Nada de segredos** em código, testes ou commits. Os arquivos do legado na raiz (`*.txt`, `.xlsx`) **não** são commitados.
- **Código do rolo:** `CÓDIGO_ERP` + separador + `LOTE_E_NÚMERO_DO_ROLO`. Separadores: `-`, `–`, `—`, `_`, `:`, `/` ou espaço.
  - **Prefixo** = texto antes do 1º separador, em maiúsculas: é o componente.
  - **Sequencial** = o resto: identifica o rolo, único por rolo. Comparado sem zeros à esquerda.
  - Código sem separador ou com sequencial vazio é **inválido**.
- **Face:** valores `TOP`, `BOT`, `TOP E BOT`. `BOT E TOP` normaliza para `TOP E BOT`. Duas faces se sobrepõem se forem iguais ou se uma for `TOP E BOT`.
- **Normalização:** posição, feeder, posto, locação e componentes = `upper(btrim(texto))`, sempre texto ("01" continua "01"). SN = `limparSerie` do ShopFloor (sem separadores, mantém zeros).
- **SN na faixa:** mesma regra de `serieDentroDaFaixa(snIni, snFim, sn)` (`src/modules/shopfloor/domain/serie.ts`). OP com `sn_ini` ou `sn_fim` vazio = **sem faixa**: aceita e devolve aviso.
- **PTH:** as colunas genéricas `posicao`/`feeder` guardam **posto/locação**; a UI troca os rótulos. **Bloco** e **posto** são localizações dentro da fábrica; **locação** é a posição do componente na placa.
  - **SMD:** posição única no setup e feeder único no setup.
  - **PTH:** só o par (posto, locação) é único.
  - **Os dois:** rolo único no setup.
- **Estrutura:** componente guarda código + processo (`SMD`/`PTH`). Setup SMD só aceita componente SMD, e PTH só PTH.
- **Importação da composição do ERP:**
  - Aba `COMPOSIÇÃO DE PRODUTO` (ou a 1ª). Cabeçalho = 1ª linha que contém `NÍVEL` e `CÓDIGO ITEM`.
  - **PMO** = código da linha de nível 1.
  - **Entram** só linhas com `LOCALIZAÇÃO` preenchida.
  - **Processo** pelo ancestral mais próximo com nível menor cuja descrição começa com `PARTES PTH` / `PARTES SMD`.
  - **Importar não remove** componentes.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/auth/domain/perfil.ts`, `modulos.ts`, `mapear-perfil.ts` + testes | Módulo `setup` no RBAC |
| `src/modules/perfis/domain/regras-perfil.ts` | Rótulo "Lançar" genérico |
| `supabase/migrations/0110_setup_modulo_grants.sql` | Grants `setup.*` pros perfis que já administram o sistema |
| `supabase/migrations/0111_setup_tabelas.sql` | Tabelas `st_*`, RLS, GRANTs, seed de equipamentos |
| `supabase/migrations/0112_setup_funcoes.sql` | Helpers SQL + funções `st_*` atômicas |
| `supabase/tests/setup_st_test.sql` + `supabase/tests/rodar-setup-test.sh` | Testes SQL num Postgres descartável |
| `src/modules/setup/domain/codigo-rolo.ts` | `separarRolo` |
| `src/modules/setup/domain/face.ts` | `normalizarFace`, `facesSobrepoem`, `FACES` |
| `src/modules/setup/domain/composicao-erp.ts` | `lerComposicao(linhas)` (puro, sem xlsx) |
| `src/modules/setup/domain/ler-composicao-xlsx.ts` | Lê o arquivo no cliente (único import de `xlsx` do módulo) |
| `src/modules/setup/domain/estrutura-previa.ts` | `compararEstrutura` |
| `src/modules/setup/domain/mensagens.ts` | `mensagemErroSetup(codigo)` |
| `src/modules/setup/domain/tipos.ts` | Tipos compartilhados |
| `src/modules/setup/infra/setup-repository.ts` | Leituras e chamadas RPC |
| `src/modules/setup/application/setup-actions.ts` | Actions de operação (montar/abastecer) |
| `src/modules/setup/application/cadastros-actions.ts` | Actions de equipamentos e estrutura |
| `src/shared/ui/app-shell.tsx` | Seção SETUP + itens de configuração |
| `src/app/(app)/setup/**` | Telas de operação e consultas |
| `src/app/(app)/configuracoes/setup-equipamentos/**`, `setup-estrutura/**` | Cadastros |

---

### Task 1: Módulo `setup` no RBAC

**Files:**
- Modify: `src/modules/auth/domain/perfil.ts`, `src/modules/auth/domain/modulos.ts`, `src/modules/auth/domain/mapear-perfil.ts`, `src/modules/perfis/domain/regras-perfil.ts`, `src/app/(app)/sobre/page.tsx`, `src/app/(app)/home/page.tsx`
- Modify tests: `src/modules/auth/domain/__tests__/modulos.test.ts`, `src/modules/auth/domain/__tests__/perfil.test.ts`, `src/modules/auth/application/__tests__/mapear-perfil.test.ts`
- Create: `supabase/migrations/0110_setup_modulo_grants.sql`

**Interfaces:**
- Produces: `Modulo = 'recebimento' | 'shopfloor' | 'setup' | 'sistema'`; `PERMISSOES_POR_MODULO.setup = ['visualizar', 'lancar', 'administrar']`.

- [ ] **Step 1: Atualizar os testes pra esperar o módulo novo**

`modulos.test.ts`: onde está `expect(chaves).toEqual(['recebimento','shopfloor','sistema'])`, trocar por:
```ts
expect(chaves).toEqual(['recebimento', 'shopfloor', 'setup', 'sistema'])
```
e acrescentar:
```ts
it('setup expõe visualizar, lançar e administrar', () => {
  expect(PERMISSOES_POR_MODULO.setup).toEqual(['visualizar', 'lancar', 'administrar'])
})
```
(importar `PERMISSOES_POR_MODULO` se ainda não estiver importado).

`mapear-perfil.test.ts`: nas asserções que esperam `{ recebimento: {}, shopfloor: {}, sistema: {} }`, trocar por `{ recebimento: {}, shopfloor: {}, setup: {}, sistema: {} }`, e o texto "vazio para os 3 módulos" por "vazio para os 4 módulos". Acrescentar:
```ts
it('lê grants do módulo setup', () => {
  const p = mapearPerfil({ ...rowBase, perfil_permissao: [{ modulo: 'setup', permissao: 'lancar' }] })
  expect(p.porModulo.setup).toEqual({ lancar: true })
})
```
(usar a fixture de linha já existente no arquivo no lugar de `rowBase`; se ela tiver outro nome, adaptar).

`perfil.test.ts`: no literal de `porModulo` da fixture, acrescentar `setup: {}`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/auth`
Expected: FAIL (ordem de módulos / `setup` ausente / erro de tipo).

- [ ] **Step 3: Implementar**

`perfil.ts`:
```ts
export type Modulo = 'recebimento' | 'shopfloor' | 'setup' | 'sistema'
```

`modulos.ts`:
```ts
export const MODULOS: { chave: Modulo; rotulo: string }[] = [
  { chave: 'recebimento', rotulo: 'Recebimento' },
  { chave: 'shopfloor', rotulo: 'Fluxo de Processos' },
  { chave: 'setup', rotulo: 'Setup' },
  { chave: 'sistema', rotulo: 'Sistema' },
]

export const PERMISSOES_POR_MODULO: Record<Modulo, Permissao[]> = {
  recebimento: ['visualizar', 'importar', 'editar', 'finalizar', 'editar_finalizado', 'excluir', 'gerar_etiqueta', 'administrar'],
  shopfloor: ['visualizar', 'lancar', 'administrar'],
  setup: ['visualizar', 'lancar', 'administrar'],
  sistema: ['administrar'],
}
```

`mapear-perfil.ts`:
```ts
const porModulo: Perfil['porModulo'] = { recebimento: {}, shopfloor: {}, setup: {}, sistema: {} }
```

`regras-perfil.ts`: trocar o rótulo `'Lançar (Shopfloor)'` por `'Lançar'`.

`sobre/page.tsx`: acrescentar ao array `MODULOS` local um item no mesmo formato dos existentes. Ícone `Cpu` do lucide, nome `'Setup'`, descrição `'Estrutura de componentes por PMO, montagem de setup das máquinas SMT/PTH e conferência da troca de rolos.'`

`home/page.tsx`: acrescentar a `ATALHOS` (importar `Cpu` do lucide):
```ts
{
  titulo: 'Setup',
  descricao: 'Montagem de setup das máquinas e conferência da troca de rolos.',
  href: '/setup/operar/montar',
  icone: Cpu,
  modulo: 'setup',
  permissao: 'lancar',
},
```

- [ ] **Step 4: Migração de grants**

Create `supabase/migrations/0110_setup_modulo_grants.sql`:
```sql
-- =============================================================
-- Módulo Setup (montagem de setup e abastecimento de componentes).
-- O módulo é só uma chave nova em perfil_permissao (sem CHECK de módulo): esta migração apenas
-- dá acesso inicial a quem já administra o sistema, pra alguém conseguir configurar os perfis.
-- =============================================================
insert into public.perfil_permissao (perfil_id, modulo, permissao)
select pp.perfil_id, 'setup', p.permissao
from public.perfil_permissao pp
cross join (values ('visualizar'), ('lancar'), ('administrar')) as p(permissao)
where pp.modulo = 'sistema' and pp.permissao = 'administrar'
on conflict do nothing;
```

- [ ] **Step 5: Rodar testes e tipos**

Run: `npx vitest run src/modules/auth src/modules/perfis && npx tsc --noEmit`
Expected: PASS e nenhum erro de tipo. Se o `tsc` apontar outro literal `Record<Modulo, …>`, acrescentar `setup` nele.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth src/modules/perfis "src/app/(app)/sobre/page.tsx" "src/app/(app)/home/page.tsx" supabase/migrations/0110_setup_modulo_grants.sql
git commit -m "feat(setup): módulo Setup no controle de acesso por módulo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — código do rolo, face e mensagens

**Files:**
- Create: `src/modules/setup/domain/codigo-rolo.ts`, `src/modules/setup/domain/face.ts`, `src/modules/setup/domain/mensagens.ts`, `src/modules/setup/domain/tipos.ts`
- Test: `src/modules/setup/domain/__tests__/codigo-rolo.test.ts`, `face.test.ts`, `mensagens.test.ts`

**Interfaces:**
- Produces:
  - `separarRolo(codigo: string): { valido: boolean; prefixo: string; sequencial: string; normalizado: string }`
  - `normalizarFace(face: string): Face | null`, `facesSobrepoem(a: Face, b: Face): boolean`, `FACES: Face[]`, `type Face = 'TOP' | 'BOT' | 'TOP E BOT'`
  - `normalizarTexto(t: string): string`
  - `mensagemErroSetup(textoErro: string): string`
  - Tipos em `tipos.ts`: `Processo = 'SMD' | 'PTH'`, `EstadoSetup = 'montagem' | 'liberado'`, `rotulosPosicao(processo)`

- [ ] **Step 1: Testes**

`codigo-rolo.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { separarRolo, normalizarTexto } from '../codigo-rolo'

describe('separarRolo', () => {
  it('separa código do ERP e lote/número do rolo no primeiro hífen', () => {
    expect(separarRolo('CAPJ41-8521556004')).toEqual({
      valido: true, prefixo: 'CAPJ41', sequencial: '8521556004', normalizado: 'CAPJ41-8521556004',
    })
  })
  it('aceita outros separadores e normaliza maiúsculas e espaços nas pontas', () => {
    expect(separarRolo('  capj41_00012 ')).toMatchObject({ valido: true, prefixo: 'CAPJ41', sequencial: '00012', normalizado: 'CAPJ41_00012' })
    expect(separarRolo('RESR85 7788')).toMatchObject({ valido: true, prefixo: 'RESR85', sequencial: '7788' })
    expect(separarRolo('LED131/1')).toMatchObject({ valido: true, prefixo: 'LED131' })
    expect(separarRolo('LED131–1')).toMatchObject({ valido: true, prefixo: 'LED131' })
  })
  it('só o primeiro separador divide; o resto fica no sequencial', () => {
    expect(separarRolo('CON578-0061-2626')).toMatchObject({ prefixo: 'CON578', sequencial: '0061-2626' })
  })
  it('é inválido sem separador ou sem sequencial', () => {
    expect(separarRolo('CAPJ41').valido).toBe(false)
    expect(separarRolo('CAPJ41-').valido).toBe(false)
    expect(separarRolo('-123').valido).toBe(false)
    expect(separarRolo('').valido).toBe(false)
  })
})

describe('normalizarTexto', () => {
  it('maiúsculas, sem espaços nas pontas, mantém zeros', () => {
    expect(normalizarTexto('  zsy-008-01 ')).toBe('ZSY-008-01')
    expect(normalizarTexto('01')).toBe('01')
  })
})
```

`face.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { normalizarFace, facesSobrepoem, FACES } from '../face'

describe('face', () => {
  it('normaliza as três faces e a forma invertida', () => {
    expect(normalizarFace('top')).toBe('TOP')
    expect(normalizarFace(' BOT ')).toBe('BOT')
    expect(normalizarFace('TOP E BOT')).toBe('TOP E BOT')
    expect(normalizarFace('bot  e  top')).toBe('TOP E BOT')
    expect(normalizarFace('LADO A')).toBeNull()
  })
  it('TOP E BOT sobrepõe as duas faces', () => {
    expect(facesSobrepoem('TOP', 'TOP')).toBe(true)
    expect(facesSobrepoem('TOP', 'BOT')).toBe(false)
    expect(facesSobrepoem('TOP E BOT', 'BOT')).toBe(true)
    expect(facesSobrepoem('TOP', 'TOP E BOT')).toBe(true)
  })
  it('lista as faces na ordem da tela', () => {
    expect(FACES).toEqual(['TOP', 'BOT', 'TOP E BOT'])
  })
})
```

`mensagens.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mensagemErroSetup } from '../mensagens'

describe('mensagemErroSetup', () => {
  it('traduz o código que vem dentro da mensagem do Postgres', () => {
    expect(mensagemErroSetup('P0001: COMPONENTE_FORA_DA_ESTRUTURA')).toBe('Esse componente não está na estrutura da PMO.')
    expect(mensagemErroSetup('SN_FORA_DA_FAIXA')).toBe('O número de série não pertence à faixa da OP.')
  })
  it('mensagem genérica pra erro desconhecido', () => {
    expect(mensagemErroSetup('deu ruim')).toBe('Não foi possível concluir a operação.')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/setup`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

`codigo-rolo.ts`:
```ts
/** Texto de posição, feeder, posto, locação e componente: maiúsculas, sem espaços nas pontas. */
export function normalizarTexto(t: string): string {
  return (t ?? '').toString().trim().toUpperCase()
}

const SEPARADOR = /[-–—_:/ ]/

/**
 * Código do rolo = CÓDIGO_ERP + separador + LOTE_E_NÚMERO_DO_ROLO (ex.: CAPJ41-8521556004).
 * O prefixo é o componente (confere com a estrutura da PMO); o sequencial identifica o rolo
 * (único por rolo). Espelha st_rolo_prefixo/st_rolo_sequencial (0112).
 */
export function separarRolo(codigo: string): { valido: boolean; prefixo: string; sequencial: string; normalizado: string } {
  const normalizado = normalizarTexto(codigo)
  const i = normalizado.search(SEPARADOR)
  if (i <= 0) return { valido: false, prefixo: i === 0 ? '' : normalizado, sequencial: '', normalizado }
  const prefixo = normalizado.slice(0, i)
  const sequencial = normalizado.slice(i + 1).trim()
  return { valido: sequencial !== '', prefixo, sequencial, normalizado }
}
```

`face.ts`:
```ts
export type Face = 'TOP' | 'BOT' | 'TOP E BOT'
export const FACES: Face[] = ['TOP', 'BOT', 'TOP E BOT']

/** TOP, BOT ou TOP E BOT ("BOT E TOP" vira "TOP E BOT"). Outro texto → null. Espelha st_face (0112). */
export function normalizarFace(face: string): Face | null {
  const f = (face ?? '').toString().trim().toUpperCase().replace(/\s+/g, ' ')
  if (f === 'TOP' || f === 'BOT') return f
  if (f === 'TOP E BOT' || f === 'BOT E TOP') return 'TOP E BOT'
  return null
}

export function facesSobrepoem(a: Face, b: Face): boolean {
  return a === b || a === 'TOP E BOT' || b === 'TOP E BOT'
}
```

`tipos.ts`:
```ts
export type Processo = 'SMD' | 'PTH'
export type EstadoSetup = 'montagem' | 'liberado'

/** No PTH as colunas posicao/feeder guardam posto/locação. */
export function rotulosPosicao(processo: Processo): { posicao: string; feeder: string; equipamento: string } {
  return processo === 'PTH'
    ? { posicao: 'Posto', feeder: 'Locação', equipamento: 'Bloco' }
    : { posicao: 'Posição', feeder: 'Feeder', equipamento: 'Máquina' }
}
```

`mensagens.ts`:
```ts
const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  OP_INEXISTENTE: 'OP não encontrada no ShopFloor.',
  PMO_INEXISTENTE: 'Essa PMO não existe no ShopFloor.',
  EQUIPAMENTO_INVALIDO: 'Linha, máquina ou bloco não cadastrado para esse processo.',
  FACE_INVALIDA: 'Face inválida.',
  FACE_SOBREPOSTA: 'Já existe setup dessa OP nessa máquina com uma face que se sobrepõe (TOP E BOT).',
  SN_OBRIGATORIO: 'Informe o número de série.',
  SN_FORA_DA_FAIXA: 'O número de série não pertence à faixa da OP.',
  COPIA_INCOMPATIVEL: 'O setup de origem é de outra PMO, processo, máquina ou face.',
  SETUP_INEXISTENTE: 'Setup não encontrado.',
  SETUP_LIBERADO: 'O setup já foi liberado. Só um administrador pode alterá-lo.',
  SETUP_NAO_LIBERADO: 'O setup ainda não foi liberado.',
  CAMPOS_OBRIGATORIOS: 'Preencha todos os campos.',
  ROLO_INVALIDO: 'Código do rolo inválido. O formato é CÓDIGO-LOTE (ex.: CAPJ41-8521556004).',
  COMPONENTE_FORA_DA_ESTRUTURA: 'Esse componente não está na estrutura da PMO.',
  COMPONENTE_OUTRO_PROCESSO: 'Esse componente é de outro processo (SMD × PTH).',
  COMPONENTE_DIFERENTE_DA_POSICAO: 'O rolo é de um componente diferente do cadastrado nessa posição.',
  POSICAO_JA_CADASTRADA: 'Essa posição já está cadastrada com rolo nesse setup.',
  POSICAO_COM_OUTRO_FEEDER: 'Essa posição já está com outro feeder.',
  FEEDER_EM_OUTRA_POSICAO: 'Esse feeder já está em outra posição.',
  ROLO_JA_MONTADO: 'Esse rolo já está montado em outra posição do setup.',
  SETUP_VAZIO: 'O setup não tem nenhuma posição.',
  FALTA_ROLO: 'Ainda há posições sem rolo bipado.',
  ITEM_INEXISTENTE: 'Posição não encontrada.',
  COMPONENTE_INVALIDO: 'Código de componente inválido.',
  PROCESSO_INVALIDO: 'Processo inválido.',
}

/** Traduz o código (`raise exception 'CODIGO'`) que chega dentro da mensagem de erro do Postgres. */
export function mensagemErroSetup(textoErro: string): string {
  const texto = textoErro ?? ''
  for (const [codigo, mensagem] of Object.entries(MENSAGENS)) {
    if (texto.includes(codigo)) return mensagem
  }
  return 'Não foi possível concluir a operação.'
}
```
Nota: `COMPONENTE_FORA_DA_ESTRUTURA` precisa ser checado antes de qualquer código que seja prefixo dele. Nenhum código da tabela é prefixo de outro; manter assim ao acrescentar códigos.

- [ ] **Step 4: Rodar**

Run: `npx vitest run src/modules/setup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/setup/domain
git commit -m "feat(setup): regras de código do rolo, face e mensagens de erro

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Domínio — leitura da composição do ERP e prévia da importação

**Files:**
- Create: `src/modules/setup/domain/composicao-erp.ts`, `src/modules/setup/domain/estrutura-previa.ts`, `src/modules/setup/domain/ler-composicao-xlsx.ts`
- Test: `src/modules/setup/domain/__tests__/composicao-erp.test.ts`, `estrutura-previa.test.ts`

**Interfaces:**
- Consumes: `normalizarTexto` (Task 2), `Processo` (Task 2).
- Produces:
  - `lerComposicao(linhas: unknown[][]): ResultadoComposicao` com:
    ```ts
    interface ComponenteLido { componente: string; processo: Processo; linha: number }
    interface IgnoradoLido { linha: number; codigo: string; motivo: string }
    interface ResultadoComposicao { pmo: string | null; componentes: ComponenteLido[]; ignorados: IgnoradoLido[]; duplicados: string[]; erro: string | null }
    ```
  - `compararEstrutura(atual: { componente: string; processo: Processo }[], arquivo: { componente: string; processo: Processo }[]): PreviaEstrutura` com:
    ```ts
    interface PreviaEstrutura { novos: ItemEstrutura[]; iguais: ItemEstrutura[]; processoAlterado: (ItemEstrutura & { processoAtual: Processo })[]; ausentesNoArquivo: ItemEstrutura[] }
    ```
  - `lerComposicaoXlsx(file: File): Promise<unknown[][]>`: linhas brutas da aba, pra passar a `lerComposicao`.

- [ ] **Step 1: Testes**

`composicao-erp.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { lerComposicao } from '../composicao-erp'

const CAB = ['NÍVEL', 'CÓDIGO ITEM', 'DESCRIÇÃO ITEM', 'DESCRIÇÃO ITEM (Inglês)', 'NCM', 'ORIGEM', 'QUANTIDADE', 'UNIDADE', 'LOCALIZAÇÃO']
const linha = (nivel: number, codigo: string, desc: string, loc = '') => [nivel, codigo, desc, '', '', '', 1, 'UN', loc]

// Recorte fiel da composição da PMOG13.
const PLANILHA: unknown[][] = [
  ['EMPRESA', 'ENTERPLAK PRODUTOS ELETRONICOS LTDA'],
  [],
  CAB,
  linha(1, 'PMOG13', 'PLACA VVC117 PRINCIPAL'),
  linha(2, 'EMB110', 'CAIXA PADRAO'),
  linha(2, 'PRT787', 'PARTES PTH DA PLACA VVC117'),
  linha(3, 'BAR180', '.BARRA DE PINOS', 'CN6'),
  linha(3, 'CON802', '.CONECTOR', 'CN1'),
  linha(3, 'PRT788', 'PARTES SMD DA PLACA VVC117'),
  linha(4, 'CAPJ41', '.CAPACITOR', 'C1, C12'),
  linha(4, 'resr85', '.RESISTOR', 'R11'),
  linha(4, 'PCI624', 'PLACA DE CIRCUITO IMPRESSO'),
  linha(4, 'CAPJ41', '.CAPACITOR REPETIDO', 'C2'),
  linha(2, 'SAC005', 'SACO ESD'),
]

describe('lerComposicao', () => {
  it('pega a PMO do nível 1', () => {
    expect(lerComposicao(PLANILHA).pmo).toBe('PMOG13')
  })
  it('importa só linhas com localização, com o processo do subconjunto pai', () => {
    const r = lerComposicao(PLANILHA)
    expect(r.componentes).toEqual([
      { componente: 'BAR180', processo: 'PTH', linha: 7 },
      { componente: 'CON802', processo: 'PTH', linha: 8 },
      { componente: 'CAPJ41', processo: 'SMD', linha: 10 },
      { componente: 'RESR85', processo: 'SMD', linha: 11 },
    ])
  })
  it('lista ignorados com motivo e duplicados', () => {
    const r = lerComposicao(PLANILHA)
    expect(r.ignorados.map((i) => i.codigo)).toEqual(['EMB110', 'PRT787', 'PRT788', 'PCI624', 'SAC005'])
    expect(r.ignorados[0]!.motivo).toBe('Sem localização (não é componente de montagem).')
    expect(r.duplicados).toEqual(['CAPJ41'])
    expect(r.erro).toBeNull()
  })
  it('componente com localização fora de PARTES SMD/PTH fica ignorado', () => {
    const r = lerComposicao([CAB, linha(1, 'PMOX', 'PLACA'), linha(2, 'CAPJ41', '.CAP', 'C1')])
    expect(r.componentes).toEqual([])
    expect(r.ignorados).toEqual([{ linha: 3, codigo: 'CAPJ41', motivo: 'Processo indefinido (fora de PARTES SMD/PTH).' }])
  })
  it('erro quando não acha o cabeçalho ou o nível 1', () => {
    expect(lerComposicao([['A', 'B']]).erro).toBe('Cabeçalho não encontrado (colunas NÍVEL e CÓDIGO ITEM).')
    expect(lerComposicao([CAB, linha(2, 'X', 'Y', 'C1')]).erro).toBe('Não encontrei a PMO (linha de nível 1).')
  })
})
```

`estrutura-previa.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { compararEstrutura } from '../estrutura-previa'

describe('compararEstrutura', () => {
  it('separa novos, iguais, processo alterado e ausentes', () => {
    const atual = [
      { componente: 'CAPJ41', processo: 'SMD' as const },
      { componente: 'BAR180', processo: 'SMD' as const },
      { componente: 'OLD001', processo: 'SMD' as const },
    ]
    const arquivo = [
      { componente: 'CAPJ41', processo: 'SMD' as const },
      { componente: 'BAR180', processo: 'PTH' as const },
      { componente: 'NEW002', processo: 'PTH' as const },
    ]
    expect(compararEstrutura(atual, arquivo)).toEqual({
      novos: [{ componente: 'NEW002', processo: 'PTH' }],
      iguais: [{ componente: 'CAPJ41', processo: 'SMD' }],
      processoAlterado: [{ componente: 'BAR180', processo: 'PTH', processoAtual: 'SMD' }],
      ausentesNoArquivo: [{ componente: 'OLD001', processo: 'SMD' }],
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/setup/domain/__tests__/composicao-erp.test.ts src/modules/setup/domain/__tests__/estrutura-previa.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`composicao-erp.ts`:
```ts
import { normalizarTexto } from './codigo-rolo'
import type { Processo } from './tipos'

export interface ComponenteLido { componente: string; processo: Processo; linha: number }
export interface IgnoradoLido { linha: number; codigo: string; motivo: string }
export interface ResultadoComposicao {
  pmo: string | null
  componentes: ComponenteLido[]
  ignorados: IgnoradoLido[]
  duplicados: string[]
  erro: string | null
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const chave = (v: unknown) => semAcento(String(v ?? '')).trim().toUpperCase()

/**
 * Lê a composição de produto do ERP (linhas brutas da planilha, `header: 1`).
 * PMO = código do nível 1; entram só linhas com LOCALIZAÇÃO; processo = subconjunto pai
 * "PARTES PTH"/"PARTES SMD" (ancestral mais próximo com nível menor). `linha` é 1-based como no Excel.
 */
export function lerComposicao(linhas: unknown[][]): ResultadoComposicao {
  const vazio: ResultadoComposicao = { pmo: null, componentes: [], ignorados: [], duplicados: [], erro: null }
  const iCab = linhas.findIndex((l) => Array.isArray(l) && l.some((c) => chave(c) === 'NIVEL') && l.some((c) => chave(c) === 'CODIGO ITEM'))
  if (iCab < 0) return { ...vazio, erro: 'Cabeçalho não encontrado (colunas NÍVEL e CÓDIGO ITEM).' }
  const cab = linhas[iCab]!.map(chave)
  const col = { nivel: cab.indexOf('NIVEL'), codigo: cab.indexOf('CODIGO ITEM'), descricao: cab.indexOf('DESCRICAO ITEM'), localizacao: cab.indexOf('LOCALIZACAO') }
  if (col.localizacao < 0) return { ...vazio, erro: 'Coluna LOCALIZAÇÃO não encontrada.' }

  const r: ResultadoComposicao = { ...vazio }
  // pilha de ancestrais: { nivel, processo? }
  const pilha: { nivel: number; processo: Processo | null }[] = []
  const vistos = new Set<string>()

  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i] ?? []
    const nivel = Number(l[col.nivel])
    const codigo = normalizarTexto(String(l[col.codigo] ?? ''))
    if (!Number.isFinite(nivel) || codigo === '') continue
    const descricao = chave(col.descricao >= 0 ? l[col.descricao] : '')
    const localizacao = String(l[col.localizacao] ?? '').trim()
    const numeroLinha = i + 1

    while (pilha.length > 0 && pilha[pilha.length - 1]!.nivel >= nivel) pilha.pop()
    const processoPai = [...pilha].reverse().find((p) => p.processo !== null)?.processo ?? null
    const processoProprio: Processo | null = descricao.startsWith('PARTES PTH') ? 'PTH' : descricao.startsWith('PARTES SMD') ? 'SMD' : null
    pilha.push({ nivel, processo: processoProprio })

    if (nivel === 1) {
      if (r.pmo === null) r.pmo = codigo
      continue
    }
    if (localizacao === '') {
      r.ignorados.push({ linha: numeroLinha, codigo, motivo: 'Sem localização (não é componente de montagem).' })
      continue
    }
    if (processoPai === null) {
      r.ignorados.push({ linha: numeroLinha, codigo, motivo: 'Processo indefinido (fora de PARTES SMD/PTH).' })
      continue
    }
    if (vistos.has(codigo)) {
      if (!r.duplicados.includes(codigo)) r.duplicados.push(codigo)
      continue
    }
    vistos.add(codigo)
    r.componentes.push({ componente: codigo, processo: processoPai, linha: numeroLinha })
  }
  if (r.pmo === null) return { ...vazio, erro: 'Não encontrei a PMO (linha de nível 1).' }
  return r
}
```
Nota: na pilha, a linha de nível 1 (PMO) e a de nível 2 (`PARTES PTH`) ficam como ancestrais do `PARTES SMD` de nível 3. O `processoPai` pega o ancestral **mais próximo** com processo, então itens abaixo de `PARTES SMD` saem como SMD mesmo estando dentro de `PARTES PTH`. O teste cobre esse caso.

`estrutura-previa.ts`:
```ts
import type { Processo } from './tipos'

export interface ItemEstrutura { componente: string; processo: Processo }
export interface PreviaEstrutura {
  novos: ItemEstrutura[]
  iguais: ItemEstrutura[]
  processoAlterado: (ItemEstrutura & { processoAtual: Processo })[]
  ausentesNoArquivo: ItemEstrutura[]
}

/** Prévia da importação: o que entra, o que muda de processo e o que ficou só no cadastro (não é apagado). */
export function compararEstrutura(atual: ItemEstrutura[], arquivo: ItemEstrutura[]): PreviaEstrutura {
  const porCodigo = new Map(atual.map((a) => [a.componente, a]))
  const noArquivo = new Set(arquivo.map((a) => a.componente))
  const previa: PreviaEstrutura = { novos: [], iguais: [], processoAlterado: [], ausentesNoArquivo: [] }
  for (const item of arquivo) {
    const existente = porCodigo.get(item.componente)
    if (!existente) previa.novos.push({ componente: item.componente, processo: item.processo })
    else if (existente.processo === item.processo) previa.iguais.push({ componente: item.componente, processo: item.processo })
    else previa.processoAlterado.push({ componente: item.componente, processo: item.processo, processoAtual: existente.processo })
  }
  for (const a of atual) if (!noArquivo.has(a.componente)) previa.ausentesNoArquivo.push({ componente: a.componente, processo: a.processo })
  return previa
}
```

`ler-composicao-xlsx.ts` (sem teste unitário, porque depende de `File`/`xlsx`; coberto no smoke):
```ts
import * as XLSX from 'xlsx'

/** Lê a planilha da composição do ERP no navegador. Aba "COMPOSIÇÃO DE PRODUTO" ou, se não houver, a primeira. */
export async function lerComposicaoXlsx(file: File): Promise<unknown[][]> {
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
    const nome = wb.SheetNames.find((n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase() === 'COMPOSICAO DE PRODUTO') ?? wb.SheetNames[0]
    if (!nome) return []
    return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome]!, { header: 1, defval: '' })
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run src/modules/setup`
Expected: PASS.

- [ ] **Step 5: Conferir com a planilha real** (arquivo fora do git, só leitura):
```bash
node -e "
const XLSX=require('xlsx');
const wb=XLSX.readFile('/home/rwtech/Área de trabalho/ShopFloor/composicao_produto_com_preco_PMOG13.xlsx');
require('fs').writeFileSync('/tmp/claude-1000/pmog13.json', JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets['COMPOSIÇÃO DE PRODUTO'],{header:1,defval:''})));
" && npx tsx -e "import {lerComposicao} from './src/modules/setup/domain/composicao-erp'; const r=lerComposicao(JSON.parse(require('fs').readFileSync('/tmp/claude-1000/pmog13.json','utf8'))); console.log(r.pmo, r.componentes.length, r.componentes.filter(c=>c.processo==='PTH').length, r.componentes.filter(c=>c.processo==='SMD').length, r.duplicados, r.erro)"
```
Expected: `PMOG13 75 6 69 [] null`. Se o `tsx` não estiver instalado, usar `npx --yes tsx` ou pular este passo e anotar no relatório.

- [ ] **Step 6: Commit**

```bash
git add src/modules/setup/domain
git commit -m "feat(setup): leitura da composição de produto do ERP e prévia da importação

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Migração das tabelas

**Files:**
- Create: `supabase/migrations/0111_setup_tabelas.sql`

**Interfaces:**
- Produces: as tabelas `st_equipamentos`, `st_estrutura`, `st_setups`, `st_setup_itens`, `st_trocas` e `st_alteracoes`, com as colunas abaixo, usadas nas Tasks 5–12.

- [ ] **Step 1: Escrever a migração**

```sql
-- =============================================================
-- Módulo Setup — tabelas (spec 2026-09-16-modulo-setup-abastecimento-design.md).
-- Leitura: quem visualiza o módulo. Escrita de operação: só pelas funções st_* (0112, security
-- definer). Cadastros (equipamentos, estrutura) são escritos direto pelo app, restritos a administrar.
-- No PTH, posicao/feeder guardam posto/locação.
-- =============================================================

create table public.st_equipamentos (
  id          uuid primary key default gen_random_uuid(),
  processo    text not null check (processo in ('SMD', 'PTH')),
  linha       text not null,
  equipamento text not null,                -- máquina (SMD) ou bloco (PTH)
  posicoes    int check (posicoes is null or posicoes > 0),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  unique (processo, linha, equipamento)
);

create table public.st_estrutura (
  pmo        text not null,
  componente text not null,                 -- código do ERP (prefixo do rolo), maiúsculas
  processo   text not null check (processo in ('SMD', 'PTH')),
  origem     text not null default 'manual' check (origem in ('importacao', 'manual')),
  criado_por uuid references public.usuarios(id),
  criado_em  timestamptz not null default now(),
  primary key (pmo, componente)
);

create table public.st_setups (
  id           uuid primary key default gen_random_uuid(),
  pmo          text not null,
  op           text not null,
  processo     text not null check (processo in ('SMD', 'PTH')),
  linha        text not null,
  equipamento  text not null,
  face         text not null check (face in ('TOP', 'BOT', 'TOP E BOT')),
  sn_abertura  text not null,
  estado       text not null default 'montagem' check (estado in ('montagem', 'liberado')),
  copiado_de   uuid references public.st_setups(id) on delete set null,
  criado_por   uuid references public.usuarios(id),
  criado_em    timestamptz not null default now(),
  liberado_por uuid references public.usuarios(id),
  liberado_em  timestamptz,
  unique (pmo, op, processo, linha, equipamento, face)
);
create index st_setups_pmo_op on public.st_setups (pmo, op);

create table public.st_setup_itens (
  id             uuid primary key default gen_random_uuid(),
  setup_id       uuid not null references public.st_setups(id) on delete cascade,
  processo       text not null check (processo in ('SMD', 'PTH')),   -- cópia do setup (índices parciais)
  posicao        text not null,              -- posição (SMD) ou posto (PTH)
  feeder         text not null,              -- feeder (SMD) ou locação (PTH)
  componente     text not null,
  rolo           text,                       -- rolo montado agora (código completo); null = falta bipar
  atualizado_por uuid references public.usuarios(id),
  atualizado_em  timestamptz not null default now(),
  unique (setup_id, posicao, feeder)
);
create unique index st_itens_posicao_smd on public.st_setup_itens (setup_id, posicao) where processo = 'SMD';
create unique index st_itens_feeder_smd  on public.st_setup_itens (setup_id, feeder)  where processo = 'SMD';
create unique index st_itens_rolo        on public.st_setup_itens (setup_id, rolo)    where rolo is not null;

create table public.st_trocas (
  id            uuid primary key default gen_random_uuid(),
  setup_id      uuid not null references public.st_setups(id) on delete cascade,
  item_id       uuid references public.st_setup_itens(id) on delete set null,
  posicao       text not null,
  feeder        text not null,
  rolo_saida    text not null,
  rolo_entrada  text not null,
  sn_inicial    text not null,
  resultado     text not null check (resultado in ('APROVADO', 'REPROVADO')),
  motivos       text[] not null default '{}',
  operador      uuid references public.usuarios(id),
  operador_nome text not null default '',
  data_hora     timestamptz not null default now()
);
create index st_trocas_setup_data on public.st_trocas (setup_id, data_hora desc);
create index st_trocas_data on public.st_trocas (data_hora desc);

create table public.st_alteracoes (
  id           uuid primary key default gen_random_uuid(),
  setup_id     uuid not null references public.st_setups(id) on delete cascade,
  item_id      uuid,
  tipo         text not null check (tipo in ('troca_feeder', 'troca_posicao', 'correcao', 'inclusao', 'remocao')),
  antes        jsonb,
  depois       jsonb,
  usuario      uuid references public.usuarios(id),
  usuario_nome text not null default '',
  data_hora    timestamptz not null default now()
);
create index st_alteracoes_setup on public.st_alteracoes (setup_id, data_hora desc);

-- ---------- RLS ----------
alter table public.st_equipamentos enable row level security;
alter table public.st_estrutura    enable row level security;
alter table public.st_setups       enable row level security;
alter table public.st_setup_itens  enable row level security;
alter table public.st_trocas       enable row level security;
alter table public.st_alteracoes   enable row level security;

create policy st_equipamentos_select on public.st_equipamentos for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_equipamentos_admin  on public.st_equipamentos for all using ((select tem_permissao('setup', 'administrar'))) with check ((select tem_permissao('setup', 'administrar')));
create policy st_estrutura_select    on public.st_estrutura    for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_estrutura_admin     on public.st_estrutura    for all using ((select tem_permissao('setup', 'administrar'))) with check ((select tem_permissao('setup', 'administrar')));
create policy st_setups_select       on public.st_setups       for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_setup_itens_select  on public.st_setup_itens  for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_trocas_select       on public.st_trocas       for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_alteracoes_select   on public.st_alteracoes   for select using ((select tem_permissao('setup', 'visualizar')));

-- ---------- GRANTs (no RDS da AWS os privilégios padrão podem não valer pra tabela nova) ----------
grant select on public.st_setups, public.st_setup_itens, public.st_trocas, public.st_alteracoes to authenticated;
grant select, insert, update, delete on public.st_equipamentos, public.st_estrutura to authenticated;
grant select, insert, update, delete on public.st_equipamentos, public.st_estrutura, public.st_setups,
  public.st_setup_itens, public.st_trocas, public.st_alteracoes to service_role;

-- ---------- Equipamentos de hoje (planilha legada) ----------
insert into public.st_equipamentos (processo, linha, equipamento, posicoes) values
  ('SMD', '1', 'YSM10', null),
  ('SMD', '1', 'MG5', null),
  ('SMD', '2', 'YSM10', 148),
  ('SMD', '3', 'CP40', null)
on conflict do nothing;
insert into public.st_equipamentos (processo, linha, equipamento)
select 'PTH', l::text, b
from generate_series(1, 6) as l, unnest(array['A', 'B']) as b
on conflict do nothing;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Testar num Postgres descartável**

```bash
docker rm -f pg-setup-t4 >/dev/null 2>&1
docker run -d --name pg-setup-t4 -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
for i in $(seq 1 30); do docker exec pg-setup-t4 pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0111_setup_tabelas.sql pg-setup-t4:/tmp/0111.sql
docker exec -i pg-setup-t4 psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create role authenticated; create role service_role; create role anon;
create table public.usuarios (id uuid primary key, nome text not null default '');
create function public.tem_permissao(m text, p text) returns boolean language sql as $f$ select true $f$;
\i /tmp/0111.sql
select processo, count(*) from st_equipamentos group by 1 order by 1;
SQL
docker rm -f pg-setup-t4 >/dev/null
```
Expected: sem `ERROR`; `PTH | 12` e `SMD | 4`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0111_setup_tabelas.sql
git commit -m "feat(setup): tabelas do módulo Setup com RLS por módulo e equipamentos iniciais

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Migração das funções + testes SQL

**Files:**
- Create: `supabase/migrations/0112_setup_funcoes.sql`, `supabase/tests/setup_st_test.sql`, `supabase/tests/rodar-setup-test.sh`

**Interfaces:**
- Consumes: tabelas da Task 4; `public.sf_ordens(pmo, op, cliente, descricao, status, sn_ini, sn_fim)`; `public.usuarios(id, nome)`; `public.tem_permissao(text, text)`; `auth.uid()`.
- Produces (todas `security definer`, `grant execute … to authenticated`):
  - `st_listar_ordens() returns table (pmo text, op text, cliente text, descricao text, status text, sn_ini text, sn_fim text)`: visualizar.
  - `st_abrir_setup(p_pmo text, p_op text, p_processo text, p_linha text, p_equipamento text, p_face text, p_sn_abertura text, p_copiar_de uuid default null) returns jsonb`: lancar. Retorna `{ setup_id, criado boolean, sem_faixa boolean }`.
  - `st_incluir_item(p_setup_id uuid, p_posicao text, p_feeder text, p_rolo text) returns jsonb`: lancar (setup liberado exige administrar). Retorna `{ item_id, componente, atualizou boolean }`.
  - `st_remover_item(p_item_id uuid) returns void`: lancar (setup liberado exige administrar).
  - `st_editar_item(p_item_id uuid, p_posicao text, p_feeder text) returns void`: administrar.
  - `st_liberar_setup(p_setup_id uuid) returns void`: lancar.
  - `st_trocar_rolo(p_setup_id uuid, p_posicao text, p_feeder text, p_rolo_saida text, p_rolo_entrada text, p_sn_inicial text) returns jsonb`: lancar. Retorna `{ troca_id, resultado 'APROVADO'|'REPROVADO', motivos text[], sem_faixa boolean }`.
  - `st_importar_estrutura(p_pmo text, p_itens jsonb) returns jsonb`: administrar. `p_itens = [{componente, processo}]`. Retorna `{ novos, atualizados, iguais }`.
- Erros: `raise exception 'CODIGO'` com os códigos de `mensagens.ts` (Task 2).

- [ ] **Step 1: Escrever a migração**

```sql
-- =============================================================
-- Módulo Setup — funções. Regras do spec 2026-09-16 (seção 5). Toda escrita de operação passa aqui:
-- checa a permissão do MÓDULO setup, trava o setup (pg_advisory_xact_lock) e devolve códigos de erro
-- que o app traduz (src/modules/setup/domain/mensagens.ts).
-- $func$ em vez de $$: o SQL Editor do Supabase não aceita $$.
-- =============================================================

-- ---------- helpers puros ----------
create or replace function public.st_norm(p text) returns text
language sql immutable as $func$ select upper(btrim(coalesce(p, ''))) $func$;

create or replace function public.st_face(p text) returns text
language plpgsql immutable as $func$
declare v text := upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
begin
  if v in ('TOP', 'BOT') then return v; end if;
  if v in ('TOP E BOT', 'BOT E TOP') then return 'TOP E BOT'; end if;
  raise exception 'FACE_INVALIDA';
end $func$;

create or replace function public.st_faces_sobrepoem(a text, b text) returns boolean
language sql immutable as $func$ select a = b or a = 'TOP E BOT' or b = 'TOP E BOT' $func$;

-- Prefixo (componente) = até o 1º separador; sequencial = o resto. Espelha separarRolo (TS).
create or replace function public.st_rolo_prefixo(p text) returns text
language sql immutable as $func$ select coalesce(substring(public.st_norm(p) from '^([^-–—_:/ ]+)[-–—_:/ ]'), '') $func$;

create or replace function public.st_rolo_sequencial(p text) returns text
language sql immutable as $func$ select btrim(coalesce(substring(public.st_norm(p) from '^[^-–—_:/ ]+[-–—_:/ ](.*)$'), '')) $func$;

create or replace function public.st_limpar_sn(p text) returns text
language sql immutable as $func$ select regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g') $func$;

-- Espelha serieDentroDaFaixa (src/modules/shopfloor/domain/serie.ts). null = OP sem faixa.
create or replace function public.st_sn_na_faixa(p_ini text, p_fim text, p_sn text) returns boolean
language plpgsql immutable as $func$
declare
  a text := public.st_limpar_sn(p_ini); b text := public.st_limpar_sn(p_fim); x text := public.st_limpar_sn(p_sn);
  ma text[]; mb text[]; mx text[];
  lo text; hi text;
begin
  if a = '' or b = '' then return null; end if;
  ma := regexp_match(a, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mb := regexp_match(b, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mx := regexp_match(x, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  if ma is not null and mb is not null and mx is not null then
    if lower(ma[1]) <> lower(mb[1]) or lower(ma[3]) <> lower(mb[3]) then return false; end if;
    if lower(mx[1]) <> lower(ma[1]) or lower(mx[3]) <> lower(ma[3]) then return false; end if;
    return mx[2]::numeric between least(ma[2]::numeric, mb[2]::numeric) and greatest(ma[2]::numeric, mb[2]::numeric);
  end if;
  lo := least(a, b); hi := greatest(a, b);
  return x >= lo and x <= hi;
end $func$;

create or replace function public.st_nome_usuario() returns text
language sql stable security definer set search_path = public as $func$
  select coalesce((select nome from public.usuarios where id = auth.uid()), '')
$func$;

-- ---------- leitura das OPs do ShopFloor pra quem só tem o módulo Setup ----------
create or replace function public.st_listar_ordens()
returns table (pmo text, op text, cliente text, descricao text, status text, sn_ini text, sn_fim text)
language plpgsql stable security definer set search_path = public as $func$
begin
  if not tem_permissao('setup', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select o.pmo, o.op, o.cliente, o.descricao, o.status, o.sn_ini, o.sn_fim
    from public.sf_ordens o
    order by o.pmo, o.op;
end $func$;

-- ---------- abrir (criar ou reabrir) setup ----------
create or replace function public.st_abrir_setup(
  p_pmo text, p_op text, p_processo text, p_linha text, p_equipamento text, p_face text,
  p_sn_abertura text, p_copiar_de uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_processo text := public.st_norm(p_processo);
  v_linha text := public.st_norm(p_linha);
  v_equip text := public.st_norm(p_equipamento);
  v_face text;
  v_sn text := public.st_limpar_sn(p_sn_abertura);
  v_ordem record;
  v_faixa boolean;
  v_id uuid;
  v_origem record;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_processo not in ('SMD', 'PTH') then raise exception 'PROCESSO_INVALIDO'; end if;
  v_face := public.st_face(p_face);

  select pmo, op, sn_ini, sn_fim into v_ordem from public.sf_ordens
   where pmo = btrim(p_pmo) and op = btrim(p_op);
  if not found then raise exception 'OP_INEXISTENTE'; end if;

  if not exists (select 1 from public.st_equipamentos
                  where processo = v_processo and linha = v_linha and equipamento = v_equip and ativo) then
    raise exception 'EQUIPAMENTO_INVALIDO';
  end if;

  perform pg_advisory_xact_lock(hashtext('st/' || v_ordem.pmo || '/' || v_ordem.op)::bigint);

  -- Já existe setup dessa OP nessa máquina e face: reabre (a cópia é ignorada).
  select id into v_id from public.st_setups
   where pmo = v_ordem.pmo and op = v_ordem.op and processo = v_processo
     and linha = v_linha and equipamento = v_equip and face = v_face;
  if found then
    return jsonb_build_object('setup_id', v_id, 'criado', false, 'sem_faixa', false);
  end if;

  if exists (select 1 from public.st_setups
              where pmo = v_ordem.pmo and op = v_ordem.op and processo = v_processo
                and linha = v_linha and equipamento = v_equip and public.st_faces_sobrepoem(face, v_face)) then
    raise exception 'FACE_SOBREPOSTA';
  end if;

  if v_sn = '' then raise exception 'SN_OBRIGATORIO'; end if;
  v_faixa := public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_sn);
  if v_faixa = false then raise exception 'SN_FORA_DA_FAIXA'; end if;

  if p_copiar_de is not null then
    select * into v_origem from public.st_setups where id = p_copiar_de;
    if not found or v_origem.pmo <> v_ordem.pmo or v_origem.processo <> v_processo
       or v_origem.linha <> v_linha or v_origem.equipamento <> v_equip or v_origem.face <> v_face then
      raise exception 'COPIA_INCOMPATIVEL';
    end if;
  end if;

  insert into public.st_setups (pmo, op, processo, linha, equipamento, face, sn_abertura, copiado_de, criado_por)
  values (v_ordem.pmo, v_ordem.op, v_processo, v_linha, v_equip, v_face, v_sn, p_copiar_de, auth.uid())
  returning id into v_id;

  if p_copiar_de is not null then
    insert into public.st_setup_itens (setup_id, processo, posicao, feeder, componente, rolo, atualizado_por)
    select v_id, i.processo, i.posicao, i.feeder, i.componente, null, auth.uid()
    from public.st_setup_itens i where i.setup_id = p_copiar_de;
  end if;

  return jsonb_build_object('setup_id', v_id, 'criado', true, 'sem_faixa', v_faixa is null);
end $func$;

-- ---------- incluir item (bipe Posição → Feeder → Rolo) ----------
create or replace function public.st_incluir_item(p_setup_id uuid, p_posicao text, p_feeder text, p_rolo text)
returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_setup record;
  v_pos text := public.st_norm(p_posicao);
  v_fee text := public.st_norm(p_feeder);
  v_rolo text := public.st_norm(p_rolo);
  v_prefixo text := public.st_rolo_prefixo(p_rolo);
  v_proc_estrutura text;
  v_item record;
  v_id uuid;
begin
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado = 'liberado' then
    if not tem_permissao('setup', 'administrar') then raise exception 'SETUP_LIBERADO'; end if;
  elsif not tem_permissao('setup', 'lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);

  if v_pos = '' or v_fee = '' or v_rolo = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  if v_prefixo = '' or public.st_rolo_sequencial(p_rolo) = '' then raise exception 'ROLO_INVALIDO'; end if;

  select processo into v_proc_estrutura from public.st_estrutura where pmo = v_setup.pmo and componente = v_prefixo;
  if not found then raise exception 'COMPONENTE_FORA_DA_ESTRUTURA'; end if;
  if v_proc_estrutura <> v_setup.processo then raise exception 'COMPONENTE_OUTRO_PROCESSO'; end if;

  if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and rolo = v_rolo) then
    raise exception 'ROLO_JA_MONTADO';
  end if;

  -- Mesmo par (posição, feeder): posição copiada sem rolo recebe o rolo; com rolo, recusa.
  select * into v_item from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos and feeder = v_fee;
  if found then
    if v_item.rolo is not null then raise exception 'POSICAO_JA_CADASTRADA'; end if;
    if v_item.componente <> v_prefixo then raise exception 'COMPONENTE_DIFERENTE_DA_POSICAO'; end if;
    update public.st_setup_itens set rolo = v_rolo, atualizado_por = auth.uid(), atualizado_em = now()
     where id = v_item.id;
    return jsonb_build_object('item_id', v_item.id, 'componente', v_prefixo, 'atualizou', true);
  end if;

  if v_setup.processo = 'SMD' then
    if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos) then
      raise exception 'POSICAO_COM_OUTRO_FEEDER';
    end if;
    if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and feeder = v_fee) then
      raise exception 'FEEDER_EM_OUTRA_POSICAO';
    end if;
  end if;

  insert into public.st_setup_itens (setup_id, processo, posicao, feeder, componente, rolo, atualizado_por)
  values (p_setup_id, v_setup.processo, v_pos, v_fee, v_prefixo, v_rolo, auth.uid())
  returning id into v_id;

  if v_setup.estado = 'liberado' then
    insert into public.st_alteracoes (setup_id, item_id, tipo, antes, depois, usuario, usuario_nome)
    values (p_setup_id, v_id, 'inclusao', null,
            jsonb_build_object('posicao', v_pos, 'feeder', v_fee, 'componente', v_prefixo, 'rolo', v_rolo),
            auth.uid(), public.st_nome_usuario());
  end if;
  return jsonb_build_object('item_id', v_id, 'componente', v_prefixo, 'atualizou', false);
end $func$;

-- ---------- remover item ----------
create or replace function public.st_remover_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = public as $func$
declare v_item record; v_setup record;
begin
  select * into v_item from public.st_setup_itens where id = p_item_id;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  select * into v_setup from public.st_setups where id = v_item.setup_id;
  if v_setup.estado = 'liberado' then
    if not tem_permissao('setup', 'administrar') then raise exception 'SETUP_LIBERADO'; end if;
  elsif not tem_permissao('setup', 'lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || v_item.setup_id::text)::bigint);
  delete from public.st_setup_itens where id = p_item_id;
  if v_setup.estado = 'liberado' then
    insert into public.st_alteracoes (setup_id, item_id, tipo, antes, depois, usuario, usuario_nome)
    values (v_item.setup_id, p_item_id, 'remocao', to_jsonb(v_item) - 'setup_id', null, auth.uid(), public.st_nome_usuario());
  end if;
end $func$;

-- ---------- editar item (admin): trocar feeder e/ou posição ----------
create or replace function public.st_editar_item(p_item_id uuid, p_posicao text, p_feeder text) returns void
language plpgsql security definer set search_path = public as $func$
declare
  v_item record; v_setup record;
  v_pos text := public.st_norm(p_posicao); v_fee text := public.st_norm(p_feeder);
  v_tipo text;
begin
  if not tem_permissao('setup', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_item from public.st_setup_itens where id = p_item_id;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  select * into v_setup from public.st_setups where id = v_item.setup_id;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || v_item.setup_id::text)::bigint);
  if v_pos = '' or v_fee = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  if v_pos = v_item.posicao and v_fee = v_item.feeder then return; end if;

  if exists (select 1 from public.st_setup_itens where setup_id = v_item.setup_id and id <> p_item_id and posicao = v_pos and feeder = v_fee) then
    raise exception 'POSICAO_JA_CADASTRADA';
  end if;
  if v_setup.processo = 'SMD' then
    if exists (select 1 from public.st_setup_itens where setup_id = v_item.setup_id and id <> p_item_id and posicao = v_pos) then
      raise exception 'POSICAO_COM_OUTRO_FEEDER';
    end if;
    if exists (select 1 from public.st_setup_itens where setup_id = v_item.setup_id and id <> p_item_id and feeder = v_fee) then
      raise exception 'FEEDER_EM_OUTRA_POSICAO';
    end if;
  end if;

  v_tipo := case
    when v_pos = v_item.posicao then 'troca_feeder'
    when v_fee = v_item.feeder then 'troca_posicao'
    else 'correcao' end;

  update public.st_setup_itens set posicao = v_pos, feeder = v_fee, atualizado_por = auth.uid(), atualizado_em = now()
   where id = p_item_id;
  insert into public.st_alteracoes (setup_id, item_id, tipo, antes, depois, usuario, usuario_nome)
  values (v_item.setup_id, p_item_id, v_tipo,
          jsonb_build_object('posicao', v_item.posicao, 'feeder', v_item.feeder),
          jsonb_build_object('posicao', v_pos, 'feeder', v_fee),
          auth.uid(), public.st_nome_usuario());
end $func$;

-- ---------- liberar ----------
create or replace function public.st_liberar_setup(p_setup_id uuid) returns void
language plpgsql security definer set search_path = public as $func$
declare v_setup record;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado = 'liberado' then return; end if;
  if not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id) then raise exception 'SETUP_VAZIO'; end if;
  if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and rolo is null) then raise exception 'FALTA_ROLO'; end if;
  update public.st_setups set estado = 'liberado', liberado_por = auth.uid(), liberado_em = now() where id = p_setup_id;
end $func$;

-- ---------- trocar rolo (abastecimento) ----------
create or replace function public.st_trocar_rolo(
  p_setup_id uuid, p_posicao text, p_feeder text, p_rolo_saida text, p_rolo_entrada text, p_sn_inicial text
) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_setup record; v_ordem record; v_item record;
  v_pos text := public.st_norm(p_posicao); v_fee text := public.st_norm(p_feeder);
  v_saida text := public.st_norm(p_rolo_saida); v_entrada text := public.st_norm(p_rolo_entrada);
  v_sn text := public.st_limpar_sn(p_sn_inicial);
  v_motivos text[] := '{}';
  v_faixa boolean;
  v_outra text;
  v_resultado text;
  v_troca uuid;
  rotulo_pos text; rotulo_fee text;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado <> 'liberado' then raise exception 'SETUP_NAO_LIBERADO'; end if;
  if v_pos = '' or v_fee = '' or v_saida = '' or v_entrada = '' or v_sn = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);

  rotulo_pos := case when v_setup.processo = 'PTH' then 'posto' else 'posição' end;
  rotulo_fee := case when v_setup.processo = 'PTH' then 'locação' else 'feeder' end;

  -- 1. posição e feeder
  select * into v_item from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos and feeder = v_fee;
  if not found then
    if not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos) then
      v_motivos := v_motivos || format('A %s %s não existe nesse setup.', rotulo_pos, v_pos);
    elsif not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and feeder = v_fee) then
      v_motivos := v_motivos || format('O %s %s não existe nesse setup.', rotulo_fee, v_fee);
    else
      v_motivos := v_motivos || format('O %s %s não está na %s %s.', rotulo_fee, v_fee, rotulo_pos, v_pos);
    end if;
  else
    -- 2. rolo que sai = rolo montado
    if v_item.rolo is distinct from v_saida then
      v_motivos := v_motivos || format('O rolo montado na %s %s é %s, não %s.', rotulo_pos, v_pos, coalesce(v_item.rolo, '(nenhum)'), v_saida);
    end if;
  end if;

  -- 3. mesmo componente / 4. outro rolo
  if public.st_rolo_prefixo(v_entrada) = '' or public.st_rolo_sequencial(v_entrada) = '' then
    v_motivos := v_motivos || format('Código do rolo que entra inválido: %s.', v_entrada);
  elsif public.st_rolo_prefixo(v_saida) = '' or public.st_rolo_sequencial(v_saida) = '' then
    v_motivos := v_motivos || format('Código do rolo que sai inválido: %s.', v_saida);
  else
    if public.st_rolo_prefixo(v_entrada) <> public.st_rolo_prefixo(v_saida) then
      v_motivos := v_motivos || format('Componente diferente: sai %s, entra %s.', public.st_rolo_prefixo(v_saida), public.st_rolo_prefixo(v_entrada));
    elsif ltrim(public.st_rolo_sequencial(v_entrada), '0') = ltrim(public.st_rolo_sequencial(v_saida), '0') then
      v_motivos := v_motivos || 'O rolo que entra é o mesmo que sai.';
    end if;
    select posicao into v_outra from public.st_setup_itens
     where setup_id = p_setup_id and rolo = v_entrada and (v_item.id is null or id <> v_item.id) limit 1;
    if found then
      v_motivos := v_motivos || format('O rolo %s já está montado na %s %s.', v_entrada, rotulo_pos, v_outra);
    end if;
  end if;

  -- 5. SN Inicial na faixa da OP
  select sn_ini, sn_fim into v_ordem from public.sf_ordens where pmo = v_setup.pmo and op = v_setup.op;
  v_faixa := public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_sn);
  if v_faixa = false then
    v_motivos := v_motivos || format('O SN %s não pertence à faixa da OP.', v_sn);
  end if;

  v_resultado := case when cardinality(v_motivos) = 0 then 'APROVADO' else 'REPROVADO' end;

  insert into public.st_trocas (setup_id, item_id, posicao, feeder, rolo_saida, rolo_entrada, sn_inicial,
                                resultado, motivos, operador, operador_nome)
  values (p_setup_id, v_item.id, v_pos, v_fee, v_saida, v_entrada, v_sn, v_resultado, v_motivos,
          auth.uid(), public.st_nome_usuario())
  returning id into v_troca;

  if v_resultado = 'APROVADO' then
    update public.st_setup_itens set rolo = v_entrada, atualizado_por = auth.uid(), atualizado_em = now()
     where id = v_item.id;
  end if;

  return jsonb_build_object('troca_id', v_troca, 'resultado', v_resultado, 'motivos', to_jsonb(v_motivos), 'sem_faixa', v_faixa is null);
end $func$;

-- ---------- importar estrutura ----------
create or replace function public.st_importar_estrutura(p_pmo text, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_pmo text := btrim(coalesce(p_pmo, ''));
  v_novos int := 0; v_atual int := 0; v_iguais int := 0;
  r record;
  v_existente text;
begin
  if not tem_permissao('setup', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if not exists (select 1 from public.sf_ordens where pmo = v_pmo) then raise exception 'PMO_INEXISTENTE'; end if;
  perform pg_advisory_xact_lock(hashtext('st-estrutura/' || v_pmo)::bigint);
  for r in select public.st_norm(e->>'componente') as componente, public.st_norm(e->>'processo') as processo
           from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e loop
    if r.componente = '' then raise exception 'COMPONENTE_INVALIDO'; end if;
    if r.processo not in ('SMD', 'PTH') then raise exception 'PROCESSO_INVALIDO'; end if;
    select processo into v_existente from public.st_estrutura where pmo = v_pmo and componente = r.componente;
    if not found then
      insert into public.st_estrutura (pmo, componente, processo, origem, criado_por)
      values (v_pmo, r.componente, r.processo, 'importacao', auth.uid());
      v_novos := v_novos + 1;
    elsif v_existente <> r.processo then
      update public.st_estrutura set processo = r.processo where pmo = v_pmo and componente = r.componente;
      v_atual := v_atual + 1;
    else
      v_iguais := v_iguais + 1;
    end if;
  end loop;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'iguais', v_iguais);
end $func$;

-- ---------- permissões ----------
grant execute on function public.st_listar_ordens() to authenticated;
grant execute on function public.st_abrir_setup(text, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.st_incluir_item(uuid, text, text, text) to authenticated;
grant execute on function public.st_remover_item(uuid) to authenticated;
grant execute on function public.st_editar_item(uuid, text, text) to authenticated;
grant execute on function public.st_liberar_setup(uuid) to authenticated;
grant execute on function public.st_trocar_rolo(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.st_importar_estrutura(text, jsonb) to authenticated;
revoke all on function public.st_nome_usuario() from public, anon, authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Escrever os testes SQL**

`supabase/tests/setup_st_test.sql` (roda depois das migrações 0111 e 0112, num banco com stubs). Cada bloco `do $t$ … $t$` falha com `raise exception 'FALHOU: …'` se a expectativa não bater.
```sql
-- Stubs mínimos do Supabase/ShopFloor
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('teste.uid', true), '')::uuid $f$;
create table public.usuarios (id uuid primary key, nome text not null default '');
create table public.sf_ordens (pmo text, op text, cliente text default '', descricao text default '', status text default '', sn_ini text default '', sn_fim text default '', unique (pmo, op));
create function public.tem_permissao(m text, p text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',') like '%,' || m || '.' || p || ',%'
$f$;
insert into public.usuarios values ('00000000-0000-0000-0000-000000000001', 'Operador Teste');
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim) values
  ('PMOG13', '9001', 'CLIENTE', '2690010001', '2690010100'),
  ('PMOG13', '9002', 'CLIENTE', '', '');
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
\i /tmp/0111.sql
\i /tmp/0112.sql
```
Em seguida, acrescentar ao mesmo arquivo os blocos de teste abaixo. Todos rodam com `select set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);` definido antes, a menos que o bloco troque as permissões.

1. **Helpers:**
```sql
select set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
do $t$ begin
  if st_rolo_prefixo('capj41-0001') <> 'CAPJ41' then raise exception 'FALHOU: prefixo'; end if;
  if st_rolo_sequencial('CAPJ41-0001-22') <> '0001-22' then raise exception 'FALHOU: sequencial'; end if;
  if st_rolo_prefixo('CAPJ41') <> '' then raise exception 'FALHOU: sem separador'; end if;
  if st_face('bot e top') <> 'TOP E BOT' then raise exception 'FALHOU: face'; end if;
  if st_sn_na_faixa('2690010001', '2690010100', '2690010050') is not true then raise exception 'FALHOU: faixa dentro'; end if;
  if st_sn_na_faixa('2690010001', '2690010100', '2690010101') is not false then raise exception 'FALHOU: faixa fora'; end if;
  if st_sn_na_faixa('', '', '123') is not null then raise exception 'FALHOU: sem faixa'; end if;
end $t$;
```
2. **Estrutura:**
```sql
do $t$ declare r jsonb; begin
  r := st_importar_estrutura('PMOG13', '[{"componente":"capj41","processo":"SMD"},{"componente":"RESR85","processo":"SMD"},{"componente":"BAR180","processo":"PTH"}]');
  if r->>'novos' <> '3' then raise exception 'FALHOU: importar novos %', r; end if;
  r := st_importar_estrutura('PMOG13', '[{"componente":"CAPJ41","processo":"SMD"},{"componente":"BAR180","processo":"SMD"}]');
  if r->>'iguais' <> '1' or r->>'atualizados' <> '1' then raise exception 'FALHOU: reimportar %', r; end if;
  update st_estrutura set processo = 'PTH' where componente = 'BAR180';
  begin perform st_importar_estrutura('PMOX', '[]'); raise exception 'FALHOU: pmo inexistente passou';
  exception when others then if sqlerrm not like '%PMO_INEXISTENTE%' then raise; end if; end;
end $t$;
```
3. **Abrir setup + faixa + face sobreposta:**
```sql
do $t$ declare r jsonb; begin
  r := st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'TOP', '2690010001');
  if (r->>'criado')::boolean is not true then raise exception 'FALHOU: criar %', r; end if;
  r := st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'top', '2690010001');
  if (r->>'criado')::boolean is not false then raise exception 'FALHOU: reabrir %', r; end if;
  begin perform st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'TOP E BOT', '2690010001'); raise exception 'FALHOU: face sobreposta passou';
  exception when others then if sqlerrm not like '%FACE_SOBREPOSTA%' then raise; end if; end;
  begin perform st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'BOT', '999'); raise exception 'FALHOU: sn fora passou';
  exception when others then if sqlerrm not like '%SN_FORA_DA_FAIXA%' then raise; end if; end;
  r := st_abrir_setup('PMOG13', '9002', 'SMD', '1', 'YSM10', 'TOP', 'QUALQUER');
  if (r->>'sem_faixa')::boolean is not true then raise exception 'FALHOU: sem faixa %', r; end if;
end $t$;
```
4. **Montagem:**
```sql
do $t$ declare s uuid; r jsonb; begin
  select id into s from st_setups where op = '9001';
  r := st_incluir_item(s, '36', 'zsy-1', 'CAPJ41-L1R1');
  if r->>'componente' <> 'CAPJ41' then raise exception 'FALHOU: incluir %', r; end if;
  begin perform st_incluir_item(s, '37', 'ZSY-2', 'XXX99-1'); raise exception 'FALHOU: fora da estrutura';
  exception when others then if sqlerrm not like '%COMPONENTE_FORA_DA_ESTRUTURA%' then raise; end if; end;
  begin perform st_incluir_item(s, '37', 'ZSY-2', 'BAR180-1'); raise exception 'FALHOU: outro processo';
  exception when others then if sqlerrm not like '%COMPONENTE_OUTRO_PROCESSO%' then raise; end if; end;
  begin perform st_incluir_item(s, '36', 'ZSY-9', 'RESR85-1'); raise exception 'FALHOU: posição com outro feeder';
  exception when others then if sqlerrm not like '%POSICAO_COM_OUTRO_FEEDER%' then raise; end if; end;
  begin perform st_incluir_item(s, '38', 'ZSY-1', 'RESR85-1'); raise exception 'FALHOU: feeder em outra posição';
  exception when others then if sqlerrm not like '%FEEDER_EM_OUTRA_POSICAO%' then raise; end if; end;
  begin perform st_incluir_item(s, '38', 'ZSY-3', 'CAPJ41-L1R1'); raise exception 'FALHOU: rolo repetido';
  exception when others then if sqlerrm not like '%ROLO_JA_MONTADO%' then raise; end if; end;
  begin perform st_incluir_item(s, '38', 'ZSY-3', 'RESR85'); raise exception 'FALHOU: rolo inválido';
  exception when others then if sqlerrm not like '%ROLO_INVALIDO%' then raise; end if; end;
  perform st_incluir_item(s, '38', 'ZSY-3', 'RESR85-L2R7');
end $t$;
```
5. **Liberar e trocar rolo:**
```sql
do $t$ declare s uuid; r jsonb; begin
  select id into s from st_setups where op = '9001';
  begin perform st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R2', '2690010010'); raise exception 'FALHOU: troca sem liberar';
  exception when others then if sqlerrm not like '%SETUP_NAO_LIBERADO%' then raise; end if; end;
  perform st_liberar_setup(s);
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R2', '2690010010');
  if r->>'resultado' <> 'APROVADO' then raise exception 'FALHOU: aprovada %', r; end if;
  if (select rolo from st_setup_itens where setup_id = s and posicao = '36') <> 'CAPJ41-L1R2' then raise exception 'FALHOU: rolo montado não atualizou'; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R3', '2690010010');
  if r->>'resultado' <> 'REPROVADO' or (r->'motivos'->>0) not like 'O rolo montado na posição 36 é CAPJ41-L1R2%' then raise exception 'FALHOU: rolo antigo %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R2', 'RESR85-L9', '2690010010');
  if r->>'resultado' <> 'REPROVADO' or (r->'motivos'->>0) not like 'Componente diferente%' then raise exception 'FALHOU: componente %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R2', 'CAPJ41-L1R2', '2690010010');
  if (r->'motivos'->>0) <> 'O rolo que entra é o mesmo que sai.' then raise exception 'FALHOU: mesmo rolo %', r; end if;
  r := st_trocar_rolo(s, '99', 'ZSY-1', 'CAPJ41-L1R2', 'CAPJ41-L1R4', '2690019999');
  if cardinality(array(select jsonb_array_elements_text(r->'motivos'))) <> 2 then raise exception 'FALHOU: dois motivos %', r; end if;
  if (select count(*) from st_trocas where setup_id = s) <> 5 then raise exception 'FALHOU: toda tentativa grava'; end if;
  if (select rolo from st_setup_itens where setup_id = s and posicao = '36') <> 'CAPJ41-L1R2' then raise exception 'FALHOU: reprovada mudou o rolo'; end if;
end $t$;
```
6. **Cópia e permissões:**
```sql
do $t$ declare s uuid; nova jsonb; n uuid; begin
  select id into s from st_setups where op = '9001';
  nova := st_abrir_setup('PMOG13', '9002', 'SMD', '1', 'YSM10', 'BOT', 'X');
  begin perform st_abrir_setup('PMOG13', '9002', 'SMD', '2', 'YSM10', 'TOP', 'X', s); raise exception 'FALHOU: cópia incompatível';
  exception when others then if sqlerrm not like '%COPIA_INCOMPATIVEL%' then raise; end if; end;
end $t$;
-- cópia compatível: outra OP, mesma máquina e face do 9001 (TOP)
insert into public.sf_ordens (pmo, op, sn_ini, sn_fim) values ('PMOG13', '9003', '', '');
do $t$ declare s uuid; nova jsonb; n uuid; begin
  select id into s from st_setups where op = '9001';
  nova := st_abrir_setup('PMOG13', '9003', 'SMD', '1', 'YSM10', 'TOP', 'X', s);
  n := (nova->>'setup_id')::uuid;
  if (select count(*) from st_setup_itens where setup_id = n and rolo is null) <> 2 then raise exception 'FALHOU: cópia sem rolos'; end if;
  begin perform st_incluir_item(n, '36', 'ZSY-1', 'RESR85-A'); raise exception 'FALHOU: componente diferente da posição';
  exception when others then if sqlerrm not like '%COMPONENTE_DIFERENTE_DA_POSICAO%' then raise; end if; end;
  if (st_incluir_item(n, '36', 'ZSY-1', 'CAPJ41-NOVO')->>'atualizou')::boolean is not true then raise exception 'FALHOU: preencher rolo da cópia'; end if;
  begin perform st_liberar_setup(n); raise exception 'FALHOU: liberar com rolo faltando';
  exception when others then if sqlerrm not like '%FALTA_ROLO%' then raise; end if; end;
end $t$;
select set_config('teste.perms', 'setup.visualizar,setup.lancar', false);
do $t$ declare s uuid; i uuid; begin
  select id into s from st_setups where op = '9001';
  select id into i from st_setup_itens where setup_id = s and posicao = '36';
  begin perform st_editar_item(i, '40', 'ZSY-1'); raise exception 'FALHOU: editar sem admin';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
  begin perform st_remover_item(i); raise exception 'FALHOU: remover de setup liberado sem admin';
  exception when others then if sqlerrm not like '%SETUP_LIBERADO%' then raise; end if; end;
end $t$;
select set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
do $t$ declare s uuid; i uuid; begin
  select id into s from st_setups where op = '9001';
  select id into i from st_setup_itens where setup_id = s and posicao = '36';
  perform st_editar_item(i, '36', 'ZSY-NOVO');
  if (select tipo from st_alteracoes where item_id = i order by data_hora desc limit 1) <> 'troca_feeder' then raise exception 'FALHOU: histórico da edição'; end if;
end $t$;
select 'TODOS OS TESTES DO SETUP PASSARAM' as resultado;
```

`supabase/tests/rodar-setup-test.sh`:
```bash
#!/usr/bin/env bash
# Testes SQL do módulo Setup num Postgres descartável (Docker). Uso: supabase/tests/rodar-setup-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-setup-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0111_setup_tabelas.sql "$NOME":/tmp/0111.sql
docker cp supabase/migrations/0112_setup_funcoes.sql "$NOME":/tmp/0112.sql
docker cp supabase/tests/setup_st_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
```

- [ ] **Step 3: Rodar os testes SQL**

Run: `chmod +x supabase/tests/rodar-setup-test.sh && supabase/tests/rodar-setup-test.sh`
Expected: última linha `TODOS OS TESTES DO SETUP PASSARAM`, sem `ERROR`. Se algum bloco falhar, corrigir **a função** (não o teste), exceto erro de digitação óbvio no próprio teste.

- [ ] **Step 4: Teste de concorrência** (dois bipes do mesmo rolo ao mesmo tempo). Acrescentar ao fim de `rodar-setup-test.sh`, antes do `trap` disparar:
```bash
# Concorrência: duas sessões incluem o MESMO rolo em posições diferentes; só uma pode vencer.
docker exec "$NOME" psql -U postgres -q -c "select set_config('teste.uid','00000000-0000-0000-0000-000000000001',false)" >/dev/null
SID=$(docker exec "$NOME" psql -U postgres -tAq -c "select id from st_setups where op='9002' and face='TOP'")
for p in 50 51; do
  docker exec "$NOME" psql -U postgres -q -c "select set_config('teste.uid','00000000-0000-0000-0000-000000000001',false), set_config('teste.perms','setup.lancar,setup.administrar',false); select st_incluir_item('$SID','$p','F$p','CAPJ41-CONCORRENTE');" >/dev/null 2>&1 &
done
wait
N=$(docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from st_setup_itens where rolo='CAPJ41-CONCORRENTE'")
[ "$N" = "1" ] && echo "CONCORRÊNCIA OK" || { echo "CONCORRÊNCIA FALHOU: $N"; exit 1; }
```
Run: `supabase/tests/rodar-setup-test.sh`
Expected: `TODOS OS TESTES DO SETUP PASSARAM` e `CONCORRÊNCIA OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0112_setup_funcoes.sql supabase/tests
git commit -m "feat(setup): funções atômicas de montagem, troca de rolo e importação, com testes SQL

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Repositório e actions

**Files:**
- Create: `src/modules/setup/infra/setup-repository.ts`, `src/modules/setup/application/setup-actions.ts`, `src/modules/setup/application/cadastros-actions.ts`

**Interfaces:**
- Consumes: funções SQL (Task 5), `mensagemErroSetup` (Task 2), `getSessao`, `podeNoModulo`, `registrarLog`, `createServerSupabase`.
- Produces (tipos exportados do repositório):
  ```ts
  interface OrdemSetup { pmo: string; op: string; cliente: string; descricao: string; status: string; snIni: string; snFim: string }
  interface Equipamento { id: string; processo: Processo; linha: string; equipamento: string; posicoes: number | null; ativo: boolean }
  interface ItemEstruturaCadastro { componente: string; processo: Processo; origem: 'importacao' | 'manual'; criadoEm: string }
  interface SetupResumo { id: string; pmo: string; op: string; processo: Processo; linha: string; equipamento: string; face: Face; snAbertura: string; estado: EstadoSetup; criadoEm: string; liberadoEm: string | null; totalItens: number; semRolo: number }
  interface ItemSetup { id: string; posicao: string; feeder: string; componente: string; rolo: string | null; atualizadoEm: string }
  interface Troca { id: string; setupId: string; pmo: string; op: string; linha: string; equipamento: string; face: Face; posicao: string; feeder: string; roloSaida: string; roloEntrada: string; snInicial: string; resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; operadorNome: string; dataHora: string }
  interface Alteracao { id: string; tipo: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; usuarioNome: string; dataHora: string }
  ```
- Funções do repositório (`server-only`):
  - `listarOrdensSetup(): Promise<OrdemSetup[]>`
  - `listarEquipamentos(apenasAtivos?: boolean): Promise<Equipamento[]>`
  - `listarEstrutura(pmo: string): Promise<ItemEstruturaCadastro[]>`
  - `listarPmosComEstrutura(): Promise<{ pmo: string; total: number }[]>`
  - `buscarSetupPorChave(k: { pmo; op; processo; linha; equipamento; face }): Promise<SetupResumo | null>`
  - `carregarSetup(id: string): Promise<{ setup: SetupResumo; itens: ItemSetup[] } | null>`
  - `listarSetupsParaCopiar(k: { pmo; processo; linha; equipamento; face; excetoOp: string }): Promise<SetupResumo[]>`
  - `listarSetups(f: FiltroSetups): Promise<SetupResumo[]>`
  - `listarTrocas(f: FiltroTrocas, pagina: number, tamanho: number): Promise<{ linhas: Troca[]; total: number }>`
  - `listarAlteracoes(setupId: string): Promise<Alteracao[]>`
  - `inserirEquipamento`, `alternarEquipamento(id, ativo)`, `inserirComponente(pmo, componente, processo)`, `removerComponente(pmo, componente)`
  - `chamarRpc<T>(nome: string, params: Record<string, unknown>): Promise<T>`: lança o erro do Postgres.
- Actions (`setup-actions.ts`, todas `async`, retornam `{ ok: true, … } | { ok: false, erro: string }`):
  - `abrirSetup(entrada: { pmo; op; processo; linha; equipamento; face; snAbertura; copiarDe?: string })` → `{ ok: true; setupId: string; criado: boolean; semFaixa: boolean }`
  - `carregarSetupAction(id)` → `{ ok: true; setup: SetupResumo; itens: ItemSetup[] }`
  - `setupsParaCopiar(k)` → `{ ok: true; setups: SetupResumo[] }`
  - `incluirItem(setupId, posicao, feeder, rolo)` → `{ ok: true; componente: string; atualizou: boolean }`
  - `removerItem(itemId)`, `editarItem(itemId, posicao, feeder)`, `liberarSetup(setupId)` → `{ ok: true }`
  - `buscarSetupLiberado(k)` → `{ ok: true; setup: SetupResumo | null; itens: ItemSetup[]; ultimasTrocas: Troca[] }`
  - `trocarRolo(entrada: { setupId; posicao; feeder; roloSaida; roloEntrada; snInicial })` → `{ ok: true; resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; semFaixa: boolean }`
  - `consultarSetups(f)`, `consultarTrocas(f, pagina)`, `consultarAlteracoes(setupId)`
- Actions (`cadastros-actions.ts`):
  - `cadastrarEquipamentoAction(_prev, formData)` → `{ ok: true } | { erro: string }` (padrão `useActionState` do sf-defeitos)
  - `alternarEquipamentoAction(id, ativo)`
  - `adicionarComponenteAction(pmo, componente, processo)`, `removerComponenteAction(pmo, componente)`
  - `estruturaAtualAction(pmo)` → `{ ok: true; itens: ItemEstruturaCadastro[] }`
  - `importarEstruturaAction(pmo, itens: {componente; processo}[])` → `{ ok: true; novos; atualizados; iguais }`

- [ ] **Step 1: Repositório** — `setup-repository.ts`:
```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { Face } from '../domain/face'
import type { EstadoSetup, Processo } from '../domain/tipos'

export interface OrdemSetup { pmo: string; op: string; cliente: string; descricao: string; status: string; snIni: string; snFim: string }
export interface Equipamento { id: string; processo: Processo; linha: string; equipamento: string; posicoes: number | null; ativo: boolean }
export interface ItemEstruturaCadastro { componente: string; processo: Processo; origem: 'importacao' | 'manual'; criadoEm: string }
export interface SetupResumo {
  id: string; pmo: string; op: string; processo: Processo; linha: string; equipamento: string; face: Face
  snAbertura: string; estado: EstadoSetup; criadoEm: string; liberadoEm: string | null; totalItens: number; semRolo: number
}
export interface ItemSetup { id: string; posicao: string; feeder: string; componente: string; rolo: string | null; atualizadoEm: string }
export interface Troca {
  id: string; setupId: string; pmo: string; op: string; linha: string; equipamento: string; face: Face
  posicao: string; feeder: string; roloSaida: string; roloEntrada: string; snInicial: string
  resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; operadorNome: string; dataHora: string
}
export interface Alteracao { id: string; tipo: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; usuarioNome: string; dataHora: string }
export interface ChaveSetup { pmo: string; op: string; processo: Processo; linha: string; equipamento: string; face: Face }
export interface FiltroSetups { cliente?: string; pmo?: string; op?: string; processo?: string; linha?: string; equipamento?: string; face?: string; estado?: string }
export interface FiltroTrocas { setupId?: string; de?: string; ate?: string; pmo?: string; op?: string; linha?: string; equipamento?: string; resultado?: string; posicao?: string; rolo?: string; sn?: string }

type Row = Record<string, unknown>
const SETUP_COLS = 'id,pmo,op,processo,linha,equipamento,face,sn_abertura,estado,criado_em,liberado_em,st_setup_itens(rolo)'

function mapSetup(r: Row): SetupResumo {
  const itens = (r.st_setup_itens ?? []) as { rolo: string | null }[]
  return {
    id: r.id as string, pmo: r.pmo as string, op: r.op as string, processo: r.processo as Processo,
    linha: r.linha as string, equipamento: r.equipamento as string, face: r.face as Face,
    snAbertura: r.sn_abertura as string, estado: r.estado as EstadoSetup, criadoEm: r.criado_em as string,
    liberadoEm: (r.liberado_em as string | null) ?? null, totalItens: itens.length, semRolo: itens.filter((i) => i.rolo === null).length,
  }
}
const mapItem = (r: Row): ItemSetup => ({
  id: r.id as string, posicao: r.posicao as string, feeder: r.feeder as string, componente: r.componente as string,
  rolo: (r.rolo as string | null) ?? null, atualizadoEm: r.atualizado_em as string,
})
const mapTroca = (r: Row): Troca => {
  const s = (r.st_setups ?? {}) as Row
  return {
    id: r.id as string, setupId: r.setup_id as string, pmo: s.pmo as string, op: s.op as string, linha: s.linha as string,
    equipamento: s.equipamento as string, face: s.face as Face, posicao: r.posicao as string, feeder: r.feeder as string,
    roloSaida: r.rolo_saida as string, roloEntrada: r.rolo_entrada as string, snInicial: r.sn_inicial as string,
    resultado: r.resultado as Troca['resultado'], motivos: (r.motivos as string[]) ?? [], operadorNome: r.operador_nome as string,
    dataHora: r.data_hora as string,
  }
}

export async function chamarRpc<T>(nome: string, params: Record<string, unknown>): Promise<T> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc(nome, params)
  if (error) throw new Error(error.message)
  return data as unknown as T
}

export async function listarOrdensSetup(): Promise<OrdemSetup[]> {
  const rows = await chamarRpc<Row[]>('st_listar_ordens', {})
  return (rows ?? []).map((r) => ({
    pmo: r.pmo as string, op: r.op as string, cliente: (r.cliente as string) ?? '', descricao: (r.descricao as string) ?? '',
    status: (r.status as string) ?? '', snIni: (r.sn_ini as string) ?? '', snFim: (r.sn_fim as string) ?? '',
  }))
}

export async function listarEquipamentos(apenasAtivos = false): Promise<Equipamento[]> {
  const supabase = await createServerSupabase()
  let q = supabase.from('st_equipamentos').select('id,processo,linha,equipamento,posicoes,ativo').order('processo').order('linha').order('equipamento')
  if (apenasAtivos) q = q.eq('ativo', true)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string, processo: r.processo as Processo, linha: r.linha as string, equipamento: r.equipamento as string,
    posicoes: (r.posicoes as number | null) ?? null, ativo: r.ativo as boolean,
  }))
}

export async function listarEstrutura(pmo: string): Promise<ItemEstruturaCadastro[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_estrutura').select('componente,processo,origem,criado_em').eq('pmo', pmo.trim()).order('processo').order('componente')
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({ componente: r.componente as string, processo: r.processo as Processo, origem: r.origem as ItemEstruturaCadastro['origem'], criadoEm: r.criado_em as string }))
}

export async function listarPmosComEstrutura(): Promise<{ pmo: string; total: number }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_estrutura').select('pmo')
  if (error) throw error
  const cont = new Map<string, number>()
  for (const r of (data ?? []) as Row[]) cont.set(r.pmo as string, (cont.get(r.pmo as string) ?? 0) + 1)
  return [...cont.entries()].map(([pmo, total]) => ({ pmo, total })).sort((a, b) => a.pmo.localeCompare(b.pmo))
}

export async function buscarSetupPorChave(k: ChaveSetup): Promise<SetupResumo | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_setups').select(SETUP_COLS)
    .eq('pmo', k.pmo).eq('op', k.op).eq('processo', k.processo).eq('linha', k.linha).eq('equipamento', k.equipamento).eq('face', k.face)
    .maybeSingle()
  if (error) throw error
  return data ? mapSetup(data as Row) : null
}

export async function carregarSetup(id: string): Promise<{ setup: SetupResumo; itens: ItemSetup[] } | null> {
  const supabase = await createServerSupabase()
  const [{ data: s, error: e1 }, { data: itens, error: e2 }] = await Promise.all([
    supabase.from('st_setups').select(SETUP_COLS).eq('id', id).maybeSingle(),
    supabase.from('st_setup_itens').select('id,posicao,feeder,componente,rolo,atualizado_em').eq('setup_id', id),
  ])
  if (e1) throw e1
  if (e2) throw e2
  if (!s) return null
  const lista = ((itens ?? []) as Row[]).map(mapItem)
  // Ordena posição numérica quando dá ("2" antes de "10"), senão texto.
  lista.sort((a, b) => a.posicao.localeCompare(b.posicao, 'pt-BR', { numeric: true }) || a.feeder.localeCompare(b.feeder, 'pt-BR', { numeric: true }))
  return { setup: mapSetup(s as Row), itens: lista }
}

export async function listarSetupsParaCopiar(k: Omit<ChaveSetup, 'op'> & { excetoOp: string }): Promise<SetupResumo[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_setups').select(SETUP_COLS)
    .eq('pmo', k.pmo).eq('processo', k.processo).eq('linha', k.linha).eq('equipamento', k.equipamento).eq('face', k.face)
    .neq('op', k.excetoOp).order('criado_em', { ascending: false }).limit(20)
  if (error) throw error
  return ((data ?? []) as Row[]).map(mapSetup)
}

export async function listarSetups(f: FiltroSetups): Promise<SetupResumo[]> {
  const supabase = await createServerSupabase()
  let q = supabase.from('st_setups').select(SETUP_COLS).order('criado_em', { ascending: false }).limit(500)
  if (f.pmo) q = q.ilike('pmo', `%${f.pmo.trim()}%`)
  if (f.op) q = q.ilike('op', `%${f.op.trim()}%`)
  if (f.processo) q = q.eq('processo', f.processo)
  if (f.linha) q = q.eq('linha', f.linha)
  if (f.equipamento) q = q.eq('equipamento', f.equipamento)
  if (f.face) q = q.eq('face', f.face)
  if (f.estado) q = q.eq('estado', f.estado)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Row[]).map(mapSetup)
}

export async function listarTrocas(f: FiltroTrocas, pagina: number, tamanho: number): Promise<{ linhas: Troca[]; total: number }> {
  const supabase = await createServerSupabase()
  let q = supabase.from('st_trocas')
    .select('id,setup_id,posicao,feeder,rolo_saida,rolo_entrada,sn_inicial,resultado,motivos,operador_nome,data_hora,st_setups!inner(pmo,op,linha,equipamento,face)', { count: 'exact' })
    .order('data_hora', { ascending: false })
  if (f.setupId) q = q.eq('setup_id', f.setupId)
  if (f.de) q = q.gte('data_hora', `${f.de}T00:00:00-03:00`)
  if (f.ate) q = q.lte('data_hora', `${f.ate}T23:59:59-03:00`)
  if (f.pmo) q = q.ilike('st_setups.pmo', `%${f.pmo.trim()}%`)
  if (f.op) q = q.ilike('st_setups.op', `%${f.op.trim()}%`)
  if (f.linha) q = q.eq('st_setups.linha', f.linha)
  if (f.equipamento) q = q.eq('st_setups.equipamento', f.equipamento)
  if (f.resultado) q = q.eq('resultado', f.resultado)
  if (f.posicao) q = q.eq('posicao', f.posicao.trim().toUpperCase())
  if (f.rolo) {
    const r = f.rolo.trim().toUpperCase().replace(/[%_\\]/g, (c) => `\\${c}`)
    q = q.or(`rolo_saida.ilike.%${r}%,rolo_entrada.ilike.%${r}%`)
  }
  if (f.sn) q = q.ilike('sn_inicial', `%${f.sn.replace(/[^A-Za-z0-9]/g, '')}%`)
  const { data, error, count } = await q.range(pagina * tamanho, pagina * tamanho + tamanho - 1)
  if (error) throw error
  return { linhas: ((data ?? []) as Row[]).map(mapTroca), total: count ?? 0 }
}

export async function listarAlteracoes(setupId: string): Promise<Alteracao[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_alteracoes').select('id,tipo,antes,depois,usuario_nome,data_hora').eq('setup_id', setupId).order('data_hora', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string, tipo: r.tipo as string, antes: (r.antes as Record<string, unknown> | null) ?? null,
    depois: (r.depois as Record<string, unknown> | null) ?? null, usuarioNome: r.usuario_nome as string, dataHora: r.data_hora as string,
  }))
}

export async function inserirEquipamento(e: { processo: Processo; linha: string; equipamento: string; posicoes: number | null }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_equipamentos').insert(e)
  if (error) return { ok: false, erro: error.code === '23505' ? 'Esse equipamento já está cadastrado.' : 'Não foi possível cadastrar.' }
  return { ok: true }
}

export async function alternarEquipamento(id: string, ativo: boolean): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_equipamentos').update({ ativo }).eq('id', id)
  if (error) throw error
}

export async function inserirComponente(pmo: string, componente: string, processo: Processo, criadoPor: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_estrutura').insert({ pmo, componente, processo, origem: 'manual', criado_por: criadoPor })
  if (error) return { ok: false, erro: error.code === '23505' ? 'Esse componente já está na estrutura.' : 'Não foi possível adicionar.' }
  return { ok: true }
}

export async function removerComponente(pmo: string, componente: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_estrutura').delete().eq('pmo', pmo).eq('componente', componente)
  if (error) throw error
}
```

- [ ] **Step 2: Actions de operação** — `setup-actions.ts`:
```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Permissao } from '@/modules/auth/domain/perfil'
import { mensagemErroSetup } from '../domain/mensagens'
import { normalizarFace } from '../domain/face'
import {
  buscarSetupPorChave, carregarSetup, chamarRpc, listarAlteracoes, listarSetups, listarSetupsParaCopiar, listarTrocas,
  type Alteracao, type ChaveSetup, type FiltroSetups, type FiltroTrocas, type ItemSetup, type SetupResumo, type Troca,
} from '../infra/setup-repository'

type Falha = { ok: false; erro: string }

async function exigir(perm: Permissao): Promise<Falha | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', perm)) return { ok: false, erro: 'Você não tem permissão para esta ação.' }
  return null
}
const falha = (e: unknown): Falha => ({ ok: false, erro: mensagemErroSetup(e instanceof Error ? e.message : String(e)) })

export async function abrirSetup(entrada: ChaveSetup & { snAbertura: string; copiarDe?: string }): Promise<{ ok: true; setupId: string; criado: boolean; semFaixa: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ setup_id: string; criado: boolean; sem_faixa: boolean }>('st_abrir_setup', {
      p_pmo: entrada.pmo, p_op: entrada.op, p_processo: entrada.processo, p_linha: entrada.linha,
      p_equipamento: entrada.equipamento, p_face: entrada.face, p_sn_abertura: entrada.snAbertura, p_copiar_de: entrada.copiarDe ?? null,
    })
    return { ok: true, setupId: r.setup_id, criado: r.criado, semFaixa: r.sem_faixa }
  } catch (e) { return falha(e) }
}

export async function localizarSetup(k: ChaveSetup): Promise<{ ok: true; setup: SetupResumo | null } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  const face = normalizarFace(k.face); if (!face) return { ok: false, erro: 'Face inválida.' }
  try { return { ok: true, setup: await buscarSetupPorChave({ ...k, face }) } } catch (e) { return falha(e) }
}

export async function carregarSetupAction(id: string): Promise<{ ok: true; setup: SetupResumo; itens: ItemSetup[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try {
    const r = await carregarSetup(id)
    return r ? { ok: true, ...r } : { ok: false, erro: 'Setup não encontrado.' }
  } catch (e) { return falha(e) }
}

export async function setupsParaCopiar(k: Omit<ChaveSetup, 'op'> & { excetoOp: string }): Promise<{ ok: true; setups: SetupResumo[] } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try { return { ok: true, setups: await listarSetupsParaCopiar(k) } } catch (e) { return falha(e) }
}

export async function incluirItem(setupId: string, posicao: string, feeder: string, rolo: string): Promise<{ ok: true; componente: string; atualizou: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ componente: string; atualizou: boolean }>('st_incluir_item', { p_setup_id: setupId, p_posicao: posicao, p_feeder: feeder, p_rolo: rolo })
    return { ok: true, componente: r.componente, atualizou: r.atualizou }
  } catch (e) { return falha(e) }
}

export async function removerItem(itemId: string): Promise<{ ok: true } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try { await chamarRpc('st_remover_item', { p_item_id: itemId }); return { ok: true } } catch (e) { return falha(e) }
}

export async function editarItem(itemId: string, posicao: string, feeder: string): Promise<{ ok: true } | Falha> {
  const negado = await exigir('administrar'); if (negado) return negado
  try { await chamarRpc('st_editar_item', { p_item_id: itemId, p_posicao: posicao, p_feeder: feeder }); return { ok: true } } catch (e) { return falha(e) }
}

export async function liberarSetup(setupId: string): Promise<{ ok: true } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try { await chamarRpc('st_liberar_setup', { p_setup_id: setupId }); return { ok: true } } catch (e) { return falha(e) }
}

export async function trocarRolo(entrada: { setupId: string; posicao: string; feeder: string; roloSaida: string; roloEntrada: string; snInicial: string }): Promise<{ ok: true; resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; semFaixa: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; sem_faixa: boolean }>('st_trocar_rolo', {
      p_setup_id: entrada.setupId, p_posicao: entrada.posicao, p_feeder: entrada.feeder,
      p_rolo_saida: entrada.roloSaida, p_rolo_entrada: entrada.roloEntrada, p_sn_inicial: entrada.snInicial,
    })
    return { ok: true, resultado: r.resultado, motivos: r.motivos ?? [], semFaixa: r.sem_faixa }
  } catch (e) { return falha(e) }
}

export async function ultimasTrocas(setupId: string): Promise<{ ok: true; trocas: Troca[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try {
    const r = await listarTrocas({ setupId }, 0, 10)
    return { ok: true, trocas: r.linhas }
  } catch (e) { return falha(e) }
}

export async function consultarSetups(f: FiltroSetups): Promise<{ ok: true; setups: SetupResumo[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try { return { ok: true, setups: await listarSetups(f) } } catch (e) { return falha(e) }
}

export async function consultarTrocas(f: FiltroTrocas, pagina: number, tamanho = 100): Promise<{ ok: true; linhas: Troca[]; total: number } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try { return { ok: true, ...(await listarTrocas(f, pagina, tamanho)) } } catch (e) { return falha(e) }
}

export async function consultarAlteracoes(setupId: string): Promise<{ ok: true; alteracoes: Alteracao[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try { return { ok: true, alteracoes: await listarAlteracoes(setupId) } } catch (e) { return falha(e) }
}
```

- [ ] **Step 3: Actions de cadastro** — `cadastros-actions.ts`:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { normalizarTexto } from '../domain/codigo-rolo'
import { mensagemErroSetup } from '../domain/mensagens'
import type { Processo } from '../domain/tipos'
import {
  alternarEquipamento, chamarRpc, inserirComponente, inserirEquipamento, listarEstrutura, removerComponente,
  type ItemEstruturaCadastro,
} from '../infra/setup-repository'

type Falha = { ok: false; erro: string }
const SEM = 'Você não tem permissão para esta ação.'

async function admin() {
  const sessao = await getSessao()
  return sessao && podeNoModulo(sessao.perfil, 'setup', 'administrar') ? sessao : null
}
const processoValido = (p: string): p is Processo => p === 'SMD' || p === 'PTH'

export async function cadastrarEquipamentoAction(_prev: { ok: true } | { erro: string } | undefined, formData: FormData): Promise<{ ok: true } | { erro: string }> {
  if (!(await admin())) return { erro: SEM }
  const processo = String(formData.get('processo') ?? '')
  const linha = normalizarTexto(String(formData.get('linha') ?? ''))
  const equipamento = normalizarTexto(String(formData.get('equipamento') ?? ''))
  const posicoesTxt = String(formData.get('posicoes') ?? '').trim()
  const posicoes = posicoesTxt === '' ? null : Number(posicoesTxt)
  if (!processoValido(processo) || !linha || !equipamento) return { erro: 'Preencha processo, linha e máquina/bloco.' }
  if (posicoes !== null && (!Number.isInteger(posicoes) || posicoes <= 0)) return { erro: 'Nº de posições inválido.' }
  const r = await inserirEquipamento({ processo, linha, equipamento, posicoes })
  if (!r.ok) return { erro: r.erro }
  await registrarLog({ entidade: 'st_equipamento', acao: 'criar', descricao: `Equipamento ${processo} · Linha ${linha} · ${equipamento}` })
  revalidatePath('/configuracoes/setup-equipamentos')
  return { ok: true }
}

export async function alternarEquipamentoAction(id: string, ativo: boolean): Promise<{ ok: true } | Falha> {
  if (!(await admin())) return { ok: false, erro: SEM }
  try { await alternarEquipamento(id, ativo) } catch { return { ok: false, erro: 'Não foi possível alterar.' } }
  revalidatePath('/configuracoes/setup-equipamentos')
  return { ok: true }
}

export async function estruturaAtualAction(pmo: string): Promise<{ ok: true; itens: ItemEstruturaCadastro[] } | Falha> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'visualizar')) return { ok: false, erro: SEM }
  try { return { ok: true, itens: await listarEstrutura(pmo) } } catch { return { ok: false, erro: 'Não foi possível carregar a estrutura.' } }
}

export async function adicionarComponenteAction(pmo: string, componente: string, processo: string): Promise<{ ok: true } | Falha> {
  const sessao = await admin(); if (!sessao) return { ok: false, erro: SEM }
  const codigo = normalizarTexto(componente)
  if (!pmo.trim() || !codigo || !processoValido(processo)) return { ok: false, erro: 'Informe o código e o processo.' }
  const r = await inserirComponente(pmo.trim(), codigo, processo, sessao.usuarioId)
  if (!r.ok) return r
  await registrarLog({ entidade: 'st_estrutura', acao: 'criar', descricao: `Estrutura ${pmo}: + ${codigo} (${processo})` })
  revalidatePath('/configuracoes/setup-estrutura')
  return { ok: true }
}

export async function removerComponenteAction(pmo: string, componente: string): Promise<{ ok: true } | Falha> {
  if (!(await admin())) return { ok: false, erro: SEM }
  try { await removerComponente(pmo, componente) } catch { return { ok: false, erro: 'Não foi possível remover.' } }
  await registrarLog({ entidade: 'st_estrutura', acao: 'excluir', descricao: `Estrutura ${pmo}: − ${componente}` })
  revalidatePath('/configuracoes/setup-estrutura')
  return { ok: true }
}

export async function importarEstruturaAction(pmo: string, itens: { componente: string; processo: Processo }[]): Promise<{ ok: true; novos: number; atualizados: number; iguais: number } | Falha> {
  if (!(await admin())) return { ok: false, erro: SEM }
  if (itens.length === 0) return { ok: false, erro: 'Nenhum componente para importar.' }
  try {
    const r = await chamarRpc<{ novos: number; atualizados: number; iguais: number }>('st_importar_estrutura', { p_pmo: pmo, p_itens: itens })
    await registrarLog({ entidade: 'st_estrutura', acao: 'importar', descricao: `Estrutura ${pmo} importada: ${r.novos} novos, ${r.atualizados} atualizados`, dados: r })
    revalidatePath('/configuracoes/setup-estrutura')
    return { ok: true, ...r }
  } catch (e) {
    return { ok: false, erro: mensagemErroSetup(e instanceof Error ? e.message : String(e)) }
  }
}
```

- [ ] **Step 4: Tipos e lint**

Run: `npx tsc --noEmit && npx eslint src/modules/setup`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/modules/setup/infra src/modules/setup/application
git commit -m "feat(setup): repositório e actions do módulo Setup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Menu, layouts e páginas

**Files:**
- Modify: `src/shared/ui/app-shell.tsx`
- Create:
  - `src/app/(app)/setup/layout.tsx`, `src/app/(app)/setup/page.tsx`
  - `src/app/(app)/setup/abas-setup.tsx`
  - `src/app/(app)/setup/operar/layout.tsx`, `src/app/(app)/setup/operar/page.tsx`
  - `src/app/(app)/setup/consultas/layout.tsx`, `src/app/(app)/setup/consultas/page.tsx`

**Interfaces:**
- Produces:
  - rotas `/setup/operar/montar`, `/setup/operar/abastecimento`, `/setup/consultas/setups`, `/setup/consultas/trocas`, `/configuracoes/setup-equipamentos`, `/configuracoes/setup-estrutura`;
  - componente `AbasSetup({ tabs })`.

- [ ] **Step 1: Layout do módulo** — `setup/layout.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'visualizar')) redirect('/home')
  return <>{children}</>
}
```
`setup/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
export default function SetupPage() { redirect('/setup/operar/montar') }
```

- [ ] **Step 2: Abas** — `setup/abas-setup.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function AbasSetup({ tabs }: { tabs: { rotulo: string; href: string }[] }) {
  const pathname = usePathname()
  return (
    <nav className="mb-4 flex gap-1 border-b border-border print:hidden">
      {tabs.map((t) => {
        const ativa = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link key={t.href} href={t.href}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              ativa ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
```
`setup/operar/layout.tsx`:
```tsx
import { AbasSetup } from '../abas-setup'

const ABAS = [
  { rotulo: 'Montar Setup', href: '/setup/operar/montar' },
  { rotulo: 'Abastecimento', href: '/setup/operar/abastecimento' },
]

export default function OperarSetupLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col"><AbasSetup tabs={ABAS} />{children}</div>
}
```
`setup/operar/page.tsx`: `redirect('/setup/operar/montar')`. O mesmo par em `consultas/` com as abas `Setups` (`/setup/consultas/setups`) e `Trocas de rolo` (`/setup/consultas/trocas`), e `consultas/page.tsx` redirecionando pra `/setup/consultas/setups`.

- [ ] **Step 3: Menu** — `app-shell.tsx`:
  1. Importar `Cpu`, `PackageSearch`, `Boxes` e `Server` do `lucide-react`.
  2. Declarar, logo depois de `SHOPFLOOR`:
```ts
const SETUP: FolhaModular[] = [
  { chave: 'setup-operar', rotulo: 'Operação', href: '/setup/operar', icone: Cog, modulo: 'setup', perm: 'lancar' },
  { chave: 'setup-consultas', rotulo: 'Consultas', href: '/setup/consultas', icone: PackageSearch, modulo: 'setup', perm: 'visualizar' },
]
```
  3. Declarar, logo depois de `CONFIG_SHOPFLOOR`:
```ts
const CONFIG_SETUP: FolhaModular[] = [
  { chave: 'setup-estrutura', rotulo: 'Estrutura da PMO', href: '/configuracoes/setup-estrutura', icone: Boxes, modulo: 'setup', perm: 'administrar' },
  { chave: 'setup-equipamentos', rotulo: 'Linhas e Máquinas', href: '/configuracoes/setup-equipamentos', icone: Server, modulo: 'setup', perm: 'administrar' },
]
```
  4. `CONFIG_TODOS` passa a ser `[...CONFIG_TOPO, ...CONFIG_RECEBIMENTO, ...CONFIG_SHOPFLOOR, ...CONFIG_SETUP, ...CONFIG_BASE]`.
  5. `tituloPagina` inclui `...SETUP`.
  6. **Seção SETUP:** copiar exatamente o padrão da seção ShopFloor (`shopfloorVisivel`, `shopfloorAtivo`, `shopfloorAberto` e o bloco JSX com `rotuloGrupo('Fluxo de Processos')`).
     - Criar `setupVisivel = SETUP.filter(pode)`, `setupAtivo = pathname.startsWith('/setup')` e `const [setupAberto, setSetupAberto] = useState(setupAtivo)`.
     - Renderizar **logo depois** da seção ShopFloor, com `rotuloGrupo('Setup')`, botão com ícone `Cpu` e texto `Setup`.
  7. **Config:** criar `configSetup = podeConfig ? CONFIG_SETUP.filter(pode) : []`, somar `configSetup.length` em `temConfig`, e renderizar um sub-accordion **"Ajustes Setup"** igual ao "Ajustes ShopFloor", com estado `configSetupAtivo`/`configSetupAberto` (`pathname.startsWith('/configuracoes/setup-')`).

- [ ] **Step 4: Páginas provisórias** (substituídas nas Tasks 8–11). Criar cada uma com gate e um texto:
  - `setup/operar/montar/page.tsx` (`lancar`)
  - `setup/operar/abastecimento/page.tsx` (`lancar`)
  - `setup/consultas/setups/page.tsx` (`visualizar`)
  - `setup/consultas/trocas/page.tsx` (`visualizar`)
  - `configuracoes/setup-equipamentos/page.tsx` (`administrar`)
  - `configuracoes/setup-estrutura/page.tsx` (`administrar`)

Exemplo:
```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'

export default async function MontarSetupPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'lancar')) return <SemPermissao descricao="Você não tem permissão para montar setup." />
  return <p className="text-sm text-muted-foreground">Em construção.</p>
}
```

- [ ] **Step 5: Build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/setup" src/shared/ui/app-shell.tsx && npm run build`
Expected: build OK, com as rotas `/setup/...` listadas.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ui/app-shell.tsx "src/app/(app)/setup" "src/app/(app)/configuracoes/setup-equipamentos" "src/app/(app)/configuracoes/setup-estrutura"
git commit -m "feat(setup): menu, abas e rotas do módulo Setup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Cadastros — Linhas e Máquinas / Estrutura da PMO

**Files:**
- Create:
  - `src/app/(app)/configuracoes/setup-equipamentos/page.tsx` (substitui o provisório)
  - `src/app/(app)/configuracoes/setup-equipamentos/equipamentos-lista.tsx`
  - `src/app/(app)/configuracoes/setup-estrutura/page.tsx` (substitui o provisório)
  - `src/app/(app)/configuracoes/setup-estrutura/estrutura-tela.tsx`

**Interfaces:**
- Consumes:
  - de `setup-repository`: `listarEquipamentos`, `listarOrdensSetup`, `listarPmosComEstrutura`;
  - de `cadastros-actions`: `cadastrarEquipamentoAction`, `alternarEquipamentoAction`, `estruturaAtualAction`, `adicionarComponenteAction`, `removerComponenteAction`, `importarEstruturaAction`;
  - `lerComposicaoXlsx`, `lerComposicao`, `compararEstrutura` (Task 3).

- [ ] **Step 1: Equipamentos**

`page.tsx`: gate `administrar` → `const equipamentos = await listarEquipamentos()` → `<EquipamentosLista equipamentos={equipamentos} />`.

`equipamentos-lista.tsx` ('use client'), seguindo `configuracoes/sf-defeitos/defeitos-lista.tsx` + `defeitos-form.tsx`:
- **Tabela** (desktop) e cards (mobile): colunas `Processo`, `Linha`, `Máquina/Bloco` (rótulo `Bloco X` quando PTH), `Posições` (ou `—`) e `Ativo` (um `Switch` que chama `alternarEquipamentoAction(id, !ativo)` e mostra `toast.error` com `position: 'bottom-center'` se falhar).
- **Botão "Novo equipamento"** abre um `Dialog` com form `useActionState(cadastrarEquipamentoAction, undefined)`:
  - radio `processo` SMD/PTH (padrão SMD);
  - `linha` (Input, required);
  - `equipamento` (Input, required; label muda pra "Bloco" se PTH, controlado por `useState`);
  - `posicoes` (Input type number, opcional, só no SMD).
- **Resposta:** `toast.success('Equipamento cadastrado', { position: 'bottom-center' })` e fecha o dialog, com o mesmo `useEffect` do `DefeitoForm`.

- [ ] **Step 2: Estrutura da PMO**

`page.tsx`: gate `administrar` → `const [ordens, pmos] = await Promise.all([listarOrdensSetup(), listarPmosComEstrutura()])` → `<EstruturaTela pmos={[...new Set(ordens.map((o) => o.pmo))].sort()} comEstrutura={pmos} />`.

`estrutura-tela.tsx` ('use client'):
- **Topo:**
  - `Select` de PMO: lista das PMOs do ShopFloor, mostrando `(N componentes)` quando existe em `comEstrutura`.
  - Ao escolher, `estruturaAtualAction(pmo)` preenche `itens`.
- **Resumo da PMO escolhida:** chips "SMD: n" e "PTH: n".
  - Busca local por código.
  - Tabela `Componente | Processo | Origem | Adicionado em | ações` (botão remover com `useConfirmacao` → `removerComponenteAction` → recarrega).
- **Adicionar à mão:** Input `componente` (maiúsculas), radio SMD/PTH, botão "Adicionar" → `adicionarComponenteAction` → toast → recarrega.
- **Importar composição do ERP:** `<input type="file" accept=".xlsx">`.
  1. `const linhas = await lerComposicaoXlsx(file)` → `const lido = lerComposicao(linhas)`.
  2. Se `lido.erro`, `toast.error(lido.erro)`.
  3. Se `lido.pmo` for diferente da PMO selecionada (ou nenhuma selecionada): trocar a seleção pra `lido.pmo` se ela existir na lista. Se não existir: `toast.error('A PMO ' + lido.pmo + ' do arquivo não existe no ShopFloor.')` e parar.
  4. Carregar a estrutura atual da PMO e montar `previa = compararEstrutura(atual, lido.componentes)`.
  5. Mostrar a prévia num `Dialog` largo (`sm:max-w-[min(56rem,calc(100%-2rem))]`) com seções recolhíveis (título + contagem):
     - **Novos** (verde);
     - **Processo alterado** (âmbar, "SMD → PTH");
     - **Já existentes**;
     - **Ignorados** (código, linha e motivo);
     - **Duplicados no arquivo**;
     - **Só no cadastro (não vieram no arquivo — não serão removidos)**.
  6. Botão **"Importar N componentes"** (N = novos + processo alterado; desabilitado se 0) → `importarEstruturaAction(pmo, lido.componentes.map(({ componente, processo }) => ({ componente, processo })))` → `toast.success('Importado: X novos, Y atualizados')` → fecha e recarrega.

- [ ] **Step 3: Tipos, lint e build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/configuracoes/setup-equipamentos" "src/app/(app)/configuracoes/setup-estrutura" && npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/configuracoes/setup-equipamentos" "src/app/(app)/configuracoes/setup-estrutura"
git commit -m "feat(setup): cadastro de linhas e máquinas e estrutura da PMO com importação da composição do ERP

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Operação — Montar Setup

**Files:**
- Create: `src/app/(app)/setup/operar/montar/page.tsx` (substitui o provisório), `src/app/(app)/setup/operar/montar/montar-setup.tsx`, `src/app/(app)/setup/selecao-setup.tsx` (cabeçalho reutilizado no Abastecimento)

**Interfaces:**
- Consumes: `listarOrdensSetup`, `listarEquipamentos(true)`, actions `abrirSetup`, `localizarSetup`, `setupsParaCopiar`, `carregarSetupAction`, `incluirItem`, `removerItem`, `liberarSetup`; `PainelResultado`, `tocarErro`, `rotulosPosicao`, `FACES`, `separarRolo`.
- Produces: `SelecaoSetup` (client):
  ```tsx
  interface ValorSelecao { pmo: string; op: string; processo: Processo | ''; linha: string; equipamento: string; face: Face | '' }
  function SelecaoSetup(props: { ordens: OrdemSetup[]; equipamentos: Equipamento[]; valor: ValorSelecao; onChange: (v: ValorSelecao) => void; desabilitado?: boolean }): JSX.Element
  ```

- [ ] **Step 1: `selecao-setup.tsx`** ('use client')
  - **OP:** combobox com Popover + input de filtro, igual ao do Fluxo (`src/app/(app)/shopfloor/fluxo/fluxo-form.tsx`, trecho do `PopoverTrigger`/`PopoverContent` e "Filtrar por PMO / OP / cliente…"). Lista `${pmo}/${op} · ${cliente}`; ao escolher, preenche `pmo` e `op` e limpa o resto.
  - **Processo:** dois botões `SMD` / `PTH`. Ao trocar, limpa `linha` e `equipamento`.
  - **Linha:** `Select` com as linhas distintas de `equipamentos.filter(e => e.processo === processo)`.
  - **Máquina/Bloco:** `Select` com os equipamentos da linha. Rótulo por `rotulosPosicao(processo).equipamento`; no PTH mostrar `Bloco A`.
  - **Face:** `Select` com `FACES`.
  - Mostrar a descrição da OP e a faixa de SN (`snIni – snFim`, ou "OP sem faixa de SN cadastrada" em âmbar).
  - Layout em grade responsiva `grid gap-3 sm:grid-cols-2 lg:grid-cols-5`.

- [ ] **Step 2: `page.tsx`**: gate `lancar` → `const [ordens, equipamentos] = await Promise.all([listarOrdensSetup(), listarEquipamentos(true)])` → `<MontarSetup ordens={ordens} equipamentos={equipamentos} podeAdministrar={podeNoModulo(sessao.perfil, 'setup', 'administrar')} />`.

- [ ] **Step 3: `montar-setup.tsx`** ('use client'). Estados:
  - `selecao: ValorSelecao`
  - `setup: SetupResumo | null`, `itens: ItemSetup[]`
  - `buscando`, `snAbertura`, `copias: SetupResumo[] | null`
  - `posicao`, `feeder`, `rolo`
  - `resultado: ResultadoAcao | null`
  - `enviando` (`useTransition`)

  **Fluxo:**
  1. Quando `selecao` fica completa (os 6 campos), chama `localizarSetup(selecao)`:
     - **encontrou:** `carregarSetupAction(id)` → `setSetup` / `setItens`;
     - **não encontrou:** `setSetup(null)` e mostra o bloco **Novo setup**.
  2. **Bloco Novo setup** (quando `setup === null` e a seleção está completa):
     - Input `SN de Abertura` (autoFocus).
     - Botão **"Montar do zero"** → `abrirSetup({ ...selecao, snAbertura })`.
     - Botão **"Copiar de uma OP anterior"** → `setupsParaCopiar({ pmo, processo, linha, equipamento, face, excetoOp: op })` → lista `OP · data · N posições · estado` com botão "Copiar" em cada → `abrirSetup({ ...selecao, snAbertura, copiarDe: id })`.
     - **Sucesso:** `carregarSetupAction(setupId)`. Se `semFaixa`, mostra `resultado` tipo `aviso` com título "OP sem faixa de SN — SN aceito sem conferência" (sem som).
     - **Erro:** `resultado` tipo `aviso` com `r.erro` + `tocarErro()`.
  3. **Setup carregado:**
     - **Cabeçalho:** `OP · Linha · Máquina · Face · SN de Abertura`, badge `Em montagem` (âmbar) ou `Liberado` (verde), contador `N posições · M sem rolo`.
     - **Bipe** (só com `estado === 'montagem'`, ou `podeAdministrar`):
       - três Inputs com os rótulos de `rotulosPosicao(processo)`, classe `h-11 text-lg uppercase`, `autoComplete="off"`;
       - Enter no 1º foca o 2º, Enter no 2º foca o 3º, Enter no 3º chama `enviar()` (usar `useRef` pros três inputs);
       - `enviar()`: se já está enviando, retorna; faz `incluirItem(setup.id, posicao, feeder, rolo)`.
         - **ok:** `resultado = { tipo: 'ok', titulo: r.atualizou ? 'Rolo bipado na posição copiada' : 'Posição cadastrada', chips: [{ rotulo: rotulos.posicao, valor: posicao }, { rotulo: rotulos.feeder, valor: feeder }, { rotulo: 'Componente', valor: r.componente, mono: true }, { rotulo: 'Rolo', valor: rolo, mono: true }] }`; limpa os três; recarrega os itens (`carregarSetupAction`); foca Posição.
         - **erro:** `resultado = { tipo: 'aviso', titulo: r.erro, chips: [...] }` + `tocarErro()`; limpa só o rolo e foca Rolo.
       - Antes de chamar o servidor: se `!separarRolo(rolo).valido`, mostra o aviso de `ROLO_INVALIDO` sem chamar.
     - **`<PainelResultado resultado={resultado} />`** acima dos inputs, como no Lançamento.
     - **Tabela de itens:** colunas `rotulos.posicao | rotulos.feeder | Componente | Rolo montado | ações`.
       - Linha sem rolo: badge âmbar "falta bipar o rolo".
       - Ação remover (em montagem, ou admin): `useConfirmacao` → `removerItem`.
       - Clicar numa linha "falta bipar" preenche Posição e Feeder e foca Rolo.
     - **Botão "Liberar setup"** (em montagem): habilitado com `itens.length > 0 && semRolo === 0`. Confirma ("Depois de liberado, só um administrador altera posições e feeders.") → `liberarSetup` → recarrega → `toast.success('Setup liberado', { position: 'bottom-center' })`.
     - **Edição admin** (setup liberado e `podeAdministrar`): em cada linha, botão "Editar" abre `Dialog` com Inputs posição/feeder → `editarItem` → recarrega. O histórico é gravado no banco.

- [ ] **Step 4: Tipos, lint e build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/setup" && npm run build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/setup"
git commit -m "feat(setup): tela Montar Setup com cópia de OP anterior, bipe de posição/feeder/rolo e liberação

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Operação — Abastecimento

**Files:**
- Create: `src/app/(app)/setup/operar/abastecimento/page.tsx` (substitui o provisório), `src/app/(app)/setup/operar/abastecimento/abastecimento.tsx`

**Interfaces:**
- Consumes: `SelecaoSetup` (Task 9), `localizarSetup`, `carregarSetupAction`, `trocarRolo`, `ultimasTrocas`, `PainelResultado`, `tocarErro`, `rotulosPosicao`.

- [ ] **Step 1: `page.tsx`**: gate `lancar` → `Promise.all([listarOrdensSetup(), listarEquipamentos(true)])` → `<Abastecimento ordens equipamentos />`.

- [ ] **Step 2: `abastecimento.tsx`** ('use client')
  1. `SelecaoSetup` no topo. Com seleção completa, `localizarSetup`:
     - não achou → mensagem "Não há setup dessa OP nessa máquina e face.";
     - achou mas `estado !== 'liberado'` → mensagem âmbar "O setup ainda está em montagem. Libere em Montar Setup.";
     - liberado → guarda `setup` e carrega `ultimasTrocas(setup.id)`.
  2. **Cinco Inputs grandes** (`h-11 text-lg uppercase`, `autoComplete="off"`), com refs e Enter avançando:
     - Posição/Posto → Feeder/Locação → Rolo que sai → Rolo que entra → SN Inicial.
     - Enter no último chama `enviar()`.
  3. **`enviar()`:**
     - Guarda contra reentrância (`useTransition` + `if (enviando) return`).
     - Chama `trocarRolo({ setupId, posicao, feeder, roloSaida, roloEntrada, snInicial })`.
     - **`!r.ok`:** `resultado = { tipo: 'aviso', titulo: r.erro }` + `tocarErro()`.
     - **APROVADO:**
       - `resultado = { tipo: 'ok', titulo: 'Troca aprovada — pode seguir', chips: [{ rotulo: rotulos.posicao, valor: posicao }, { rotulo: rotulos.feeder, valor: feeder }, { rotulo: 'Saiu', valor: roloSaida, mono: true }, { rotulo: 'Entrou', valor: roloEntrada, mono: true }, { rotulo: 'SN Inicial', valor: snInicial, mono: true }], dica: r.semFaixa ? 'OP sem faixa de SN: SN aceito sem conferência.' : undefined }`;
       - limpa os 5 campos e foca Posição.
     - **REPROVADO:**
       - `resultado = { tipo: 'reprova', titulo: 'Troca reprovada — confira o componente', detalhe: r.motivos.join(' '), chips: [...] }` + `tocarErro()`;
       - **não** limpa os campos (o operador corrige) e foca Rolo que sai.
     - **Sempre:** recarrega `ultimasTrocas`.
  4. **`<PainelResultado resultado={resultado} />`** acima dos inputs.
  5. **Últimas trocas:** tabela compacta `Hora | Posição/Feeder | Saiu → Entrou | SN | Resultado (badge verde/vermelho) | Operador`, com os motivos em texto pequeno embaixo nas reprovadas.
  6. **Layout:** no `lg`, duas colunas (bipe à esquerda, painel + últimas trocas à direita), como a relayout do Lançamento. Mobile e tablet em coluna única.

- [ ] **Step 3: Tipos, lint e build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/setup" && npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/setup/operar/abastecimento"
git commit -m "feat(setup): tela de Abastecimento com conferência da troca de rolo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Consultas — Setups e Trocas de rolo

**Files:**
- Create:
  - `src/app/(app)/setup/consultas/setups/page.tsx`, `setups-consulta.tsx`
  - `src/app/(app)/setup/consultas/trocas/page.tsx`, `trocas-consulta.tsx`
  - `src/modules/setup/domain/csv-trocas.ts` + teste `src/modules/setup/domain/__tests__/csv-trocas.test.ts`

**Interfaces:**
- Consumes: `consultarSetups`, `carregarSetupAction`, `consultarAlteracoes`, `consultarTrocas`, `listarEquipamentos`.
- Produces: `trocasParaCsv(trocas: Troca[]): string` (`;` + BOM, igual ao CSV da folha da caixa).

- [ ] **Step 1: Teste do CSV** — `csv-trocas.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { trocasParaCsv } from '../csv-trocas'

describe('trocasParaCsv', () => {
  it('gera ; com BOM, cabeçalho e motivos juntos', () => {
    const csv = trocasParaCsv([{
      id: '1', setupId: 's', pmo: 'PMOG13', op: '9001', linha: '1', equipamento: 'YSM10', face: 'TOP',
      posicao: '36', feeder: 'ZSY-1', roloSaida: 'CAPJ41-A', roloEntrada: 'CAPJ41-B', snInicial: '2690010010',
      resultado: 'REPROVADO', motivos: ['Motivo 1.', 'Motivo; 2.'], operadorNome: 'Ana', dataHora: '2026-09-17T12:00:00Z',
    }])
    expect(csv.startsWith('﻿Data/hora;PMO;OP;Linha;Máquina/Bloco;Face;Posição;Feeder;Rolo que saiu;Rolo que entrou;SN Inicial;Resultado;Motivos;Operador\n')).toBe(true)
    expect(csv).toContain(';REPROVADO;"Motivo 1. Motivo; 2.";Ana')
  })
})
```

- [ ] **Step 2: Implementação** — `csv-trocas.ts`:
```ts
import type { Troca } from '../infra/setup-repository'

const CAMPO = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const DATA = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

export function trocasParaCsv(trocas: Troca[]): string {
  const cab = ['Data/hora', 'PMO', 'OP', 'Linha', 'Máquina/Bloco', 'Face', 'Posição', 'Feeder', 'Rolo que saiu', 'Rolo que entrou', 'SN Inicial', 'Resultado', 'Motivos', 'Operador']
  const linhas = trocas.map((t) => [DATA(t.dataHora), t.pmo, t.op, t.linha, t.equipamento, t.face, t.posicao, t.feeder, t.roloSaida, t.roloEntrada, t.snInicial, t.resultado, t.motivos.join(' '), t.operadorNome].map(CAMPO).join(';'))
  return '﻿' + [cab.join(';'), ...linhas].join('\n') + '\n'
}
```
Nota: `csv-trocas.ts` fica no **domínio** e importa só o **tipo** `Troca` (`import type`), o que é seguro no cliente mesmo o repositório sendo `server-only`, porque `import type` é apagado na compilação. Se o lint reclamar, mover a interface `Troca` pra `domain/tipos.ts` e reexportar no repositório.

Run: `npx vitest run src/modules/setup/domain/__tests__/csv-trocas.test.ts` → PASS.

- [ ] **Step 3: Setups** — `page.tsx` (gate `visualizar`) → `<SetupsConsulta equipamentos={await listarEquipamentos()} />`.

`setups-consulta.tsx` ('use client'):
- **Filtros:** PMO, OP (Input), Processo, Linha, Máquina/Bloco, Face e Estado (Select com "Todos"). O Enter em qualquer campo consulta (form com `onSubmit`); botões **Consultar** e **Limpar filtros** (limpar zera todos os estados).
- **Resultado** (`consultarSetups(f)`): tabela `OP | PMO | Processo | Linha | Máquina/Bloco | Face | Estado | Posições (sem rolo) | Criado em | Liberado em`.
- **Clicar numa linha** abre um `Dialog` largo:
  - cabeçalho do setup;
  - busca rápida local (posição, feeder, componente, rolo), destacando com `<mark>`;
  - tabela dos itens (`carregarSetupAction`);
  - seção **Histórico de alterações** (`consultarAlteracoes`): `Data | Tipo (rótulos: troca_feeder → "Troca de feeder", troca_posicao → "Troca de posição", correcao → "Correção", inclusao → "Inclusão", remocao → "Remoção") | Antes → Depois (posição/feeder) | Usuário`, ou "Nenhuma alteração".

- [ ] **Step 4: Trocas** — `page.tsx` (gate `visualizar`) → `<TrocasConsulta equipamentos={await listarEquipamentos()} />`.

`trocas-consulta.tsx` ('use client'):
- **Filtros:** De/Até (date, padrão = hoje e hoje), PMO, OP, Linha, Máquina/Bloco, Resultado (Todos/Aprovado/Reprovado), Posição, Rolo e SN Inicial. Enter consulta; botões **Consultar** e **Limpar filtros**.
- **Paginação:** 100 por página (`consultarTrocas(f, pagina)`), com "Anterior/Próxima" e `N trocas · página X de Y`.
- **Tabela:** `Data/hora | OP | Linha · Máquina · Face | Posição/Feeder | Saiu → Entrou | SN | Resultado (badge) | Operador`. Reprovadas mostram os motivos em texto pequeno vermelho embaixo.
- **Botão "Exportar CSV":**
  1. busca **todas** as páginas do filtro (em lotes de 1000, até 20 000 linhas; acima disso, avisa pra reduzir o período);
  2. gera `trocasParaCsv`;
  3. baixa com `Blob` + `URL.createObjectURL` + link `a.download = 'trocas-de-rolo.csv'`, como o CSV da folha da caixa.

- [ ] **Step 5: Tipos, lint, testes e build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/setup" src/modules/setup && npx vitest run src/modules/setup && npm run build`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/setup/consultas" src/modules/setup/domain
git commit -m "feat(setup): consultas de setups (com histórico de alterações) e de trocas de rolo com exportação CSV

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Verificação final e roteiro de smoke

**Files:**
- Create: `docs/superpowers/plans/2026-09-17-modulo-setup-smoke.md`

- [ ] **Step 1: Verificação completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && supabase/tests/rodar-setup-test.sh && npm run build`
Expected:
- tipos sem erro;
- lint sem **erros** (avisos antigos toleráveis);
- todos os testes passando;
- `TODOS OS TESTES DO SETUP PASSARAM` e `CONCORRÊNCIA OK`;
- build OK com as 6 rotas novas.

- [ ] **Step 2: Conferência de segurança**

Run: `git diff main --stat` e `git diff main -- . ':(exclude)package-lock.json' | grep -n -i -E "password|secret|service_role_key|eyJ" || echo "sem segredos"`
Expected: `sem segredos`. Nenhum `*.txt` do legado ou `.xlsx` no diff.

- [ ] **Step 3: Roteiro de smoke** — criar `docs/superpowers/plans/2026-09-17-modulo-setup-smoke.md` com:
  1. **Preparação no Dev:**
     - aplicar 0110, 0111 e 0112 (SQL Editor, nessa ordem);
     - conferir que o perfil de teste tem Setup (visualizar/lançar/administrar) em Configurações → Perfis;
     - escolher uma OP de teste do Dev e anotar a faixa de SN.
  2. **Cadastros:**
     - conferir Linhas e Máquinas (4 SMD + 12 PTH);
     - importar `composicao_produto_com_preco_PMOG13.xlsx` (a PMOG13 precisa existir no Dev; senão, cadastrar uma OP de teste com PMO PMOG13);
     - conferir a prévia (75 componentes: 6 PTH, 69 SMD; ignorados com motivo) e importar;
     - adicionar e remover um componente à mão.
  3. **Montar do zero** (SMD, Linha 1, YSM10, TOP):
     - SN de Abertura fora da faixa → recusa;
     - dentro → cria;
     - bipar 3 posições com rolos `CAPJ41-TESTE1`, `RESR85-TESTE1`, `CIRB26-TESTE1`;
     - testar as recusas: componente fora da estrutura, PTH num setup SMD, posição com outro feeder, feeder em outra posição, rolo repetido, rolo sem hífen;
     - liberar.
  4. **Copiar de OP anterior** (outra OP da mesma PMO, mesma máquina e face):
     - posições vêm com "falta bipar o rolo";
     - rolo de outro componente → recusa;
     - completar e liberar.
  5. **Abastecimento:**
     - troca certa → aprovada, painel verde, rolo montado atualiza;
     - rolo que sai antigo → reprovada com o motivo "O rolo montado na posição…";
     - componente diferente;
     - mesmo rolo;
     - SN fora da faixa;
     - posição inexistente;
     - conferir as últimas trocas e o som.
  6. **Edição admin:** num setup liberado, trocar o feeder de uma posição → aparece no histórico de alterações. Com usuário **sem** administrar, o botão não aparece.
  7. **Consultas:** filtros de Setups e Trocas, busca rápida, CSV abrindo no Excel com acentos.
  8. **Permissões:** usuário só com Setup (sem ShopFloor) vê as OPs; usuário sem Setup não vê o menu e é redirecionado.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-17-modulo-setup-smoke.md
git commit -m "docs(setup): roteiro de smoke do módulo Setup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review (feito ao escrever)

**Cobertura do spec:**

| Seção do spec | Tasks |
|---|---|
| Decisões 1–13 | 1 (módulo/permissões), 3/5/8 (estrutura/importação/processo), 5/9 (setup por OP, cópia, rolo montado, SN, face), 5/10 (reprovação só registra), 5/9/11 (edição admin + histórico), 4 (PTH genérico) |
| Menu | 7 |
| Modelo de dados | 4 |
| Regras | 2, 3, 5 |
| Telas | 8–11 |
| Testes | 2, 3, 5, 11, 12 |

- **Decisão 12 (começar do zero):** não há migração de dados, então nenhuma task.

**Consistência de nomes:** as funções SQL (Task 5) batem com as chamadas no repositório e nas actions (Task 6), e os códigos de erro batem com `mensagens.ts` (Task 2). Os tipos `SetupResumo`, `ItemSetup` e `Troca` são usados nas Tasks 9–11 com os mesmos campos.

**Pontos conscientes:**
- A regra da face sobreposta vale **entre setups da mesma OP e máquina**. Dentro de um setup a face é única, então não há sobreposição a checar por item.
