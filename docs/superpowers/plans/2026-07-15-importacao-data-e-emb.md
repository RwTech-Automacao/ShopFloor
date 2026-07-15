# Importação: data de chegada digitada + Nº EMB do nome do arquivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No wizard de importação, a **data de chegada** passa a ser digitada e o **Nº EMB** vem dos 8 primeiros caracteres do nome do arquivo — ambos aplicados a todas as linhas e fora do mapeamento de colunas.

**Architecture:** Dois campos "digitados" (`data_chegada`, `numero_emb`) saem da tabela de mapeamento e viram inputs no Passo 2. Uma função de domínio nova (`prepararLinhasImportacao`) monta as linhas e injeta esses valores **depois** da checagem de linha vazia. Sem migração e sem tocar em Server Action/RPC — a RPC já grava as duas colunas.

**Tech Stack:** Next.js 16 (client component), TypeScript strict, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **SEM migração** e **sem alterar** `importar-planilha.ts` (Server Action), `importacao-repository.ts` nem a RPC `importar_processos` (0008). Os valores entram nas linhas no cliente; as chaves das linhas já são os nomes das colunas do banco.
- **`data_chegada` e `numero_emb` saem do mapeamento** (viram campos digitados), mas continuam na **prévia** e na **validação** (`validarLinha` recebe a lista COMPLETA de campos).
- **Obrigatoriedade vem do que já existe:** `campo.obrigatorioImportacao` (switch "Obrigatório na importação" em Configurações → Campos). Para campo digitado, "falta" = **valor vazio**; para mapeável, "falta" = **coluna não mapeada**.
- **REGRA CRÍTICA:** os valores fixos são aplicados **DEPOIS** da checagem de linha vazia, e a checagem de vazio olha **só os campos mapeáveis**. Se entrarem antes, nenhuma linha seria vazia e as **linhas em branco do fim da planilha viram processos** (a planilha real do Comercial tem dezenas). Isto vira **teste**.
- **Nº EMB** = `nomeArquivo.slice(0, 8).trim()` — ex.: `EMB341EA - ESTADOS UNIDOS.xlsx` → `EMB341EA`. Editável.
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`; `npm run test` (TDD no domínio).

---

### Task 1: Domínio — campos digitados, Nº EMB e preparo das linhas (TDD)

**Files:**
- Modify: `src/modules/recebimento/domain/mapeamento.ts`
- Modify: `src/modules/recebimento/domain/validacao-linha.ts`
- Modify: `src/modules/recebimento/domain/__tests__/mapeamento.test.ts`
- Modify: `src/modules/recebimento/domain/__tests__/validacao-linha.test.ts`

**Interfaces:**
- Consumes: `CampoImportavel`, `linhaMapaVazia`, `validarLinha`, `LinhaValidada` (todos já existem).
- Produces:
  - `CAMPOS_DIGITADOS: readonly string[]` (`['data_chegada','numero_emb']`)
  - `numeroEmbDoArquivo(nomeArquivo: string): string`
  - `prepararLinhasImportacao(params): { validadas: LinhaValidada[]; vazias: number }`

- [ ] **Step 1: Escrever os testes de `mapeamento.ts` (que falham)**

Em `src/modules/recebimento/domain/__tests__/mapeamento.test.ts`, adicionar ao import existente e acrescentar os blocos:

```ts
import { CAMPOS_DIGITADOS, numeroEmbDoArquivo } from '../mapeamento'
```

```ts
describe('numeroEmbDoArquivo', () => {
  it('pega os 8 primeiros caracteres do nome do arquivo', () => {
    expect(numeroEmbDoArquivo('EMB341EA - ESTADOS UNIDOS.xlsx')).toBe('EMB341EA')
  })
  it('devolve o que houver quando o nome tem menos de 8 caracteres', () => {
    expect(numeroEmbDoArquivo('ABC')).toBe('ABC')
  })
  it('apara espaços nas pontas', () => {
    expect(numeroEmbDoArquivo('EMB34   - x.xlsx')).toBe('EMB34')
  })
})

describe('CAMPOS_DIGITADOS', () => {
  it('contém data_chegada e numero_emb (não são mapeados de coluna)', () => {
    expect(CAMPOS_DIGITADOS).toContain('data_chegada')
    expect(CAMPOS_DIGITADOS).toContain('numero_emb')
  })
})
```

- [ ] **Step 2: Escrever os testes de `prepararLinhasImportacao` (que falham)**

Em `src/modules/recebimento/domain/__tests__/validacao-linha.test.ts`, adicionar ao import existente e acrescentar o bloco:

```ts
import { prepararLinhasImportacao } from '../validacao-linha'
import type { CampoImportavel } from '../mapeamento'
```

```ts
describe('prepararLinhasImportacao', () => {
  const campos: CampoImportavel[] = [
    { campo: 'numero_nf', rotulo: 'NF', tipo: 'texto', listaChave: null, obrigatorioImportacao: false },
    { campo: 'data_chegada', rotulo: 'Data Chegada', tipo: 'data', listaChave: null, obrigatorioImportacao: false },
    { campo: 'numero_emb', rotulo: 'Nº EMB', tipo: 'texto', listaChave: null, obrigatorioImportacao: false },
  ]
  const base = {
    campos,
    mapeamento: { numero_nf: 'NF' },
    valoresFixos: { data_chegada: '2026-07-15', numero_emb: 'EMB341EA' },
    itensPorLista: {},
  }

  it('descarta linha em branco MESMO com valores fixos (não vira processo)', () => {
    const r = prepararLinhasImportacao({ ...base, linhasBrutas: [{ NF: '' }, { NF: '123' }] })
    expect(r.vazias).toBe(1)
    expect(r.validadas).toHaveLength(1)
  })

  it('aplica os valores fixos nas linhas válidas', () => {
    const r = prepararLinhasImportacao({ ...base, linhasBrutas: [{ NF: '123' }] })
    expect(r.validadas[0].valores.data_chegada).toBe('2026-07-15')
    expect(r.validadas[0].valores.numero_emb).toBe('EMB341EA')
    expect(r.validadas[0].erros).toEqual([])
  })

  it('ignora coluna mapeada para campo digitado — o valor fixo é a fonte', () => {
    const r = prepararLinhasImportacao({
      ...base,
      mapeamento: { numero_nf: 'NF', data_chegada: 'DataCol' },
      linhasBrutas: [{ NF: '123', DataCol: '01/01/2020' }],
    })
    expect(r.validadas[0].valores.data_chegada).toBe('2026-07-15')
  })

  it('valor fixo nulo vira null quando o campo é opcional', () => {
    const r = prepararLinhasImportacao({
      ...base,
      valoresFixos: { data_chegada: null, numero_emb: null },
      linhasBrutas: [{ NF: '123' }],
    })
    expect(r.validadas[0].valores.data_chegada).toBeNull()
    expect(r.validadas[0].erros).toEqual([])
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test -- mapeamento validacao-linha`
Expected: FAIL (`CAMPOS_DIGITADOS` / `numeroEmbDoArquivo` / `prepararLinhasImportacao` não existem).

- [ ] **Step 4: Implementar em `mapeamento.ts`**

No fim de `src/modules/recebimento/domain/mapeamento.ts`, adicionar:

```ts
/**
 * Campos que NÃO são mapeados de coluna: o usuário digita/edita o valor uma vez
 * no wizard e ele vale para TODAS as linhas da planilha. Os itens de uma
 * importação chegam juntos, então data de chegada e Nº EMB são os mesmos para
 * todos — mapear coluna para eles criaria duas fontes para o mesmo dado.
 */
export const CAMPOS_DIGITADOS: readonly string[] = ['data_chegada', 'numero_emb']

/**
 * Nº EMB a partir do nome do arquivo importado: os 8 primeiros caracteres
 * ('EMB341EA - ESTADOS UNIDOS.xlsx' → 'EMB341EA'). Nome mais curto devolve o que
 * houver, e espaços nas pontas são aparados. É só o pré-preenchimento — o campo
 * é editável no wizard.
 */
export function numeroEmbDoArquivo(nomeArquivo: string): string {
  return nomeArquivo.slice(0, 8).trim()
}
```

- [ ] **Step 5: Implementar em `validacao-linha.ts`**

1. Trocar o import de `mapeamento` para trazer também `CAMPOS_DIGITADOS`:

```ts
import { CAMPOS_DIGITADOS, type CampoImportavel } from './mapeamento'
```

2. No fim do arquivo, adicionar:

```ts
/**
 * Monta e valida todas as linhas da importação.
 *
 * Os `valoresFixos` (campos digitados no wizard — data de chegada e Nº EMB) são
 * aplicados SOMENTE às linhas não-vazias e SEMPRE **depois** da checagem de
 * vazio: como esses valores são iguais em toda linha, aplicá-los antes faria
 * nenhuma linha ser considerada vazia, e as linhas em branco do fim da planilha
 * (dezenas, nas planilhas reais) virariam processos.
 *
 * A checagem de vazio olha só os campos vindos da planilha (`campos` menos
 * `CAMPOS_DIGITADOS`); a validação final usa a lista completa, para os campos
 * digitados também serem convertidos e checados como obrigatórios.
 */
export function prepararLinhasImportacao({
  linhasBrutas,
  campos,
  mapeamento,
  valoresFixos,
  itensPorLista,
}: {
  linhasBrutas: Record<string, unknown>[]
  campos: CampoImportavel[]
  mapeamento: Record<string, string>
  valoresFixos: Record<string, string | null>
  itensPorLista: Record<string, string[]>
}): { validadas: LinhaValidada[]; vazias: number } {
  const camposMapeaveis = campos.filter((campo) => !CAMPOS_DIGITADOS.includes(campo.campo))
  const validadas: LinhaValidada[] = []
  let vazias = 0

  for (const linha of linhasBrutas) {
    const linhaMapa: Record<string, unknown> = {}
    for (const campo of camposMapeaveis) {
      const coluna = mapeamento[campo.campo]
      linhaMapa[campo.campo] = coluna ? linha[coluna] : null
    }

    if (linhaMapaVazia(linhaMapa, camposMapeaveis)) {
      vazias += 1
      continue
    }

    for (const [campo, valor] of Object.entries(valoresFixos)) {
      linhaMapa[campo] = valor
    }
    validadas.push(validarLinha(linhaMapa, campos, itensPorLista))
  }

  return { validadas, vazias }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test -- mapeamento validacao-linha`
Expected: PASS (todos, incluindo os novos).

- [ ] **Step 7: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros. (O wizard ainda usa `validarLinha`/`linhaMapaVazia` diretamente — segue compilando; a troca é na Task 2.)

```bash
git add src/modules/recebimento/domain/mapeamento.ts src/modules/recebimento/domain/validacao-linha.ts src/modules/recebimento/domain/__tests__/mapeamento.test.ts src/modules/recebimento/domain/__tests__/validacao-linha.test.ts
git commit -m "feat(importacao): domínio de campos digitados (data/EMB) e preparo das linhas (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wizard — campos digitados no Passo 2 e resumo no Passo 4

**Files:**
- Modify: `src/app/(app)/recebimento/importar/wizard-importacao.tsx`

**Interfaces:**
- Consumes: `CAMPOS_DIGITADOS`, `numeroEmbDoArquivo` (`domain/mapeamento`), `prepararLinhasImportacao` + `LinhaValidada` (`domain/validacao-linha`).

- [ ] **Step 1: Ajustar os imports**

Em `src/app/(app)/recebimento/importar/wizard-importacao.tsx`, trocar os imports de domínio (linhas 25-30) por:

```tsx
import {
  sugerirMapeamento,
  numeroEmbDoArquivo,
  CAMPOS_DIGITADOS,
  type CampoImportavel,
} from '@/modules/recebimento/domain/mapeamento'
import {
  prepararLinhasImportacao,
  type LinhaValidada,
} from '@/modules/recebimento/domain/validacao-linha'
```

E adicionar aos imports de UI (junto de `@/components/ui/button`):

```tsx
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
```

- [ ] **Step 2: Estado dos valores digitados + listas derivadas**

Em `WizardImportacao`, logo **depois** de `const [importando, startImportacao] = useTransition()` (linha 67), inserir:

```tsx
  // Valores digitados uma vez no wizard e aplicados a TODAS as linhas (os itens
  // de uma planilha chegam juntos). Chaves = nome da coluna no banco.
  const [valoresDigitados, setValoresDigitados] = useState<Record<string, string>>({
    data_chegada: '',
    numero_emb: '',
  })

  /** Campos que o usuário mapeia de coluna (os digitados saem da tabela). */
  const camposMapeaveis = useMemo(
    () => campos.filter((campo) => !CAMPOS_DIGITADOS.includes(campo.campo)),
    [campos],
  )
  /** Campos digitados presentes na configuração (para rótulo e obrigatoriedade). */
  const camposDigitados = useMemo(
    () => campos.filter((campo) => CAMPOS_DIGITADOS.includes(campo.campo)),
    [campos],
  )
  /** Os valores digitados no formato que vai para as linhas ('' vira null). */
  const valoresFixos = useMemo(
    () => ({
      data_chegada: valoresDigitados.data_chegada || null,
      numero_emb: valoresDigitados.numero_emb.trim() || null,
    }),
    [valoresDigitados],
  )

  function onMudarValorFixo(campo: string, valor: string) {
    setValoresDigitados((atual) => ({ ...atual, [campo]: valor }))
  }
```

- [ ] **Step 3: Pré-preencher o Nº EMB e sugerir mapeamento só dos mapeáveis**

Em `processarArquivo`, no bloco de sucesso (linhas 94-100), substituir:

```tsx
      setArquivoNome(file.name)
      setFormato(extensao)
      setColunas(colunasLidas)
      setLinhasBrutas(linhas)
      setMapeamento(sugerirMapeamento(colunasLidas, campos))
      setResultado(null)
      setPasso(2)
```

por:

```tsx
      setArquivoNome(file.name)
      setFormato(extensao)
      setColunas(colunasLidas)
      setLinhasBrutas(linhas)
      // Só os mapeáveis: não faz sentido sugerir coluna para campo digitado.
      setMapeamento(sugerirMapeamento(colunasLidas, camposMapeaveis))
      // Nº EMB vem do nome do arquivo (editável no passo 2).
      setValoresDigitados((atual) => ({ ...atual, numero_emb: numeroEmbDoArquivo(file.name) }))
      setResultado(null)
      setPasso(2)
```

- [ ] **Step 4: Trava de obrigatórios (campo digitado vs mapeável)**

Substituir o `camposFaltando` (linhas 118-121) por:

```tsx
  const camposFaltando = useMemo(
    () =>
      campos.filter((campo) => {
        if (!campo.obrigatorioImportacao) return false
        // Campo digitado: falta = valor em branco. Mapeável: falta = sem coluna.
        return CAMPOS_DIGITADOS.includes(campo.campo)
          ? !valoresFixos[campo.campo as keyof typeof valoresFixos]
          : !mapeamento[campo.campo]
      }),
    [campos, mapeamento, valoresFixos],
  )
```

- [ ] **Step 5: Usar `prepararLinhasImportacao` no preparo das linhas**

Substituir o `useMemo` de linhas validadas (linhas 123-142) por:

```tsx
  const { linhasValidadas, linhasVazias } = useMemo(() => {
    if (passo < 3) return { linhasValidadas: [] as LinhaValidada[], linhasVazias: 0 }
    const { validadas, vazias } = prepararLinhasImportacao({
      linhasBrutas,
      campos,
      mapeamento,
      valoresFixos,
      itensPorLista,
    })
    return { linhasValidadas: validadas, linhasVazias: vazias }
  }, [passo, linhasBrutas, campos, mapeamento, valoresFixos, itensPorLista])
```

- [ ] **Step 6: Passar as novas props para os passos 2 e 4**

Na renderização do `passo === 2` (linhas 170-182), substituir por:

```tsx
      {passo === 2 && (
        <PassoMapear
          campos={camposMapeaveis}
          camposDigitados={camposDigitados}
          valoresDigitados={valoresDigitados}
          onMudarValorFixo={onMudarValorFixo}
          colunas={colunas}
          mapeamento={mapeamento}
          camposFaltando={camposFaltando}
          onMudarMapeamento={(campo, coluna) =>
            setMapeamento((atual) => ({ ...atual, [campo]: coluna }))
          }
          onVoltar={() => setPasso(1)}
          onProximo={() => setPasso(3)}
        />
      )}
```

Na renderização do `passo === 4` (linhas 197-206), substituir por:

```tsx
      {passo === 4 && (
        <PassoImportar
          arquivoNome={arquivoNome}
          totalLinhas={linhasBrutas.length}
          camposDigitados={camposDigitados}
          valoresDigitados={valoresDigitados}
          importando={importando}
          resultado={resultado}
          onVoltar={() => setPasso(3)}
          onImportar={onImportar}
        />
      )}
```

- [ ] **Step 7: `PassoMapear` — bloco dos dados da importação**

Substituir a interface `PassoMapearProps` por:

```tsx
interface PassoMapearProps {
  campos: CampoImportavel[]
  camposDigitados: CampoImportavel[]
  valoresDigitados: Record<string, string>
  onMudarValorFixo: (campo: string, valor: string) => void
  colunas: string[]
  mapeamento: Record<string, string>
  camposFaltando: CampoImportavel[]
  onMudarMapeamento: (campo: string, coluna: string) => void
  onVoltar: () => void
  onProximo: () => void
}
```

Substituir a assinatura de `PassoMapear` por:

```tsx
function PassoMapear({
  campos,
  camposDigitados,
  valoresDigitados,
  onMudarValorFixo,
  colunas,
  mapeamento,
  camposFaltando,
  onMudarMapeamento,
  onVoltar,
  onProximo,
}: PassoMapearProps) {
```

E inserir o bloco **logo depois** do `<p className="text-sm text-muted-foreground">…</p>` inicial (o texto "Confira a coluna…", linhas 320-323) e **antes** do `<Table>`:

```tsx
      {camposDigitados.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Dados desta importação</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Aplicados a todos os processos da planilha (os itens chegam juntos).
          </p>
          <div className="flex flex-wrap gap-4">
            {camposDigitados.map((campo) => (
              <div key={campo.campo} className="flex flex-col gap-1">
                <Label htmlFor={`fixo-${campo.campo}`}>
                  {campo.rotulo}
                  {campo.obrigatorioImportacao && <span className="text-red-600"> *</span>}
                </Label>
                <Input
                  id={`fixo-${campo.campo}`}
                  type={campo.tipo === 'data' ? 'date' : 'text'}
                  value={valoresDigitados[campo.campo] ?? ''}
                  onChange={(e) => onMudarValorFixo(campo.campo, e.target.value)}
                  className="w-56"
                />
              </div>
            ))}
          </div>
        </div>
      )}
```

E trocar a mensagem de campos faltando (linhas 367-372) por (agora cobre digitados e mapeáveis):

```tsx
      {camposFaltando.length > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Faltam campos obrigatórios: {camposFaltando.map((campo) => campo.rotulo).join(', ')}.
        </p>
      )}
```

- [ ] **Step 8: `PassoImportar` — mostrar data e EMB no resumo**

Substituir a interface `PassoImportarProps` por:

```tsx
interface PassoImportarProps {
  arquivoNome: string
  totalLinhas: number
  camposDigitados: CampoImportavel[]
  valoresDigitados: Record<string, string>
  importando: boolean
  resultado: ResultadoImportacao | null
  onVoltar: () => void
  onImportar: () => void
}
```

Adicionar `camposDigitados, valoresDigitados` à desestruturação de `PassoImportar` e, no card de resumo, **depois** do bloco "Linhas a importar", inserir:

```tsx
        {camposDigitados.map((campo) => (
          <div key={campo.campo}>
            <p className="mt-3 text-sm text-muted-foreground">{campo.rotulo}</p>
            <p className="font-medium">{valoresDigitados[campo.campo] || '—'}</p>
          </div>
        ))}
```

- [ ] **Step 9: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros. (Se o lint acusar `validarLinha`/`linhaMapaVazia` importados e não usados, remover do import — quem os usa agora é `prepararLinhasImportacao`, dentro do domínio.)

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/recebimento/importar/wizard-importacao.tsx"
git commit -m "feat(importacao): data de chegada digitada + Nº EMB do nome do arquivo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os novos testes de `numeroEmbDoArquivo` e `prepararLinhasImportacao` entre eles.

- [ ] **Step 2: Smoke (anotar resultado; NÃO fazer push)**

Com `npm run dev`, em `/recebimento/importar`, usando a planilha real (`EMB341EA - ESTADOS UNIDOS.xlsx`):
1. Passo 1: escolher o arquivo → vai pro Passo 2.
2. Passo 2: o bloco "Dados desta importação" mostra **Nº EMB = `EMB341EA`** (pré-preenchido) e **Data de chegada** vazia. A tabela de mapeamento **não** lista "Data Chegada" nem "Nº EMB".
3. Preencher a data → Passo 3: a prévia mostra as colunas Data Chegada e Nº EMB preenchidas em todas as linhas; as **linhas em branco continuam sendo ignoradas** ("N em branco ignoradas").
4. Passo 4: o resumo mostra Arquivo, Linhas, Data de chegada e Nº EMB.
5. Em Configurações → Campos, marcar **"Obrigatório na importação"** na **Data Chegada** → voltar ao wizard: com a data vazia, o botão "Próximo" fica **travado** e a mensagem lista "Data Chegada".

- [ ] **Step 3: NÃO fazer push**

O push é decisão do usuário (ele valida o smoke antes). Deixar os commits **locais**.

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- Data digitada aplicada a todos + sai do mapeamento → Task 1 (`CAMPOS_DIGITADOS`, `prepararLinhasImportacao`) + Task 2 (bloco, `camposMapeaveis`). ✅
- Nº EMB dos 8 primeiros chars, pré-preenchido e editável → Task 1 (`numeroEmbDoArquivo`) + Task 2 (Step 3). ✅
- Obrigatoriedade via `obrigatorioImportacao` (campo digitado = valor vazio) → Task 2 (Step 4). ✅
- Valores fixos aplicados DEPOIS da checagem de vazio → Task 1 (implementação + teste dedicado). ✅
- Prévia e resumo mostram os valores → Task 2 (Steps 5-8). ✅
- Sem migração / sem tocar em action/RPC → Global Constraints. ✅

**Consistência de tipos:** `prepararLinhasImportacao({ linhasBrutas, campos, mapeamento, valoresFixos, itensPorLista }): { validadas: LinhaValidada[]; vazias: number }` (Task 1) é consumida na Task 2 com esse shape; `CAMPOS_DIGITADOS`/`numeroEmbDoArquivo` (Task 1) na Task 2; `CampoImportavel` e `LinhaValidada` são os tipos já existentes. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅
