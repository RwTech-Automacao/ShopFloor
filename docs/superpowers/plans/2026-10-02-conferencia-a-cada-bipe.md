# Conferência a cada bipe (troca de rolo) — plano de implementação

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> (recomendada) ou `superpowers:executing-plans`, tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** no modal de troca de rolo, cada bipe é conferido na hora contra o que já foi bipado,
parando o operador no passo em que o erro nasce — em vez de só no envio, quando o rolo já voltou
para a estante.

**Arquitetura:** a conferência roda **no cliente**. O modal recebe os itens do setup (posições,
feeders e rolos montados) e confere cada passo contra eles, sem ida ao servidor. O envio final
continua passando pela `st_trocar_rolo`, que permanece a autoridade. **O número de chamadas ao
servidor não muda** — a tela não fica mais lenta.

**Pilha:** Next.js 16 (App Router) · React 19 · TypeScript · Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-conferencia-a-cada-bipe-design.md`

## Global Constraints

- **`AGENTS.md`:** esta versão do Next tem mudanças de API; leia `node_modules/next/dist/docs/`
  antes de escrever código de framework. **`npx next build` faz parte do teste** — é o único que
  pega as regras de `'use server'` (um módulo `'use server'` só pode exportar funções async).
- **Nenhuma migração.** Nada em `supabase/migrations/`. As regras já existem no banco; este
  trabalho só as torna alcançáveis antes do envio.
- **Não mudar a `st_trocar_rolo`** nem nenhuma regra de negócio. Ela continua conferindo tudo no
  envio, e é ela que vale.
- **As frases de recusa são as do servidor, copiadas palavra por palavra**, inclusive a variação
  por processo (SMD fala em *posição* e *feeder*; PTH fala em *posto* e *locação*, com o gênero
  certo). Duas fontes de texto para a mesma regra divergem com o tempo.
- Português do Brasil em tudo que o usuário lê.
- Foco tablet, piso Chrome 111+.
- Rodar teste só do que se toca, com `--exclude "**/.claude/**"` **e `--maxWorkers=2`** — com o
  padrão, esta máquina de 4 núcleos mata o processo (exit 137). **Nunca a suíte inteira.**
- `git add` com caminhos **explícitos**.

## O que fica com o servidor, e por quê

**O SN Inicial (passo 6) não é conferido no cliente.** Ele exige a faixa da OP (`sn_ini`/`sn_fim`
de `sf_ordens`), que o modal não carrega, e portar `st_sn_na_faixa` para TypeScript duplicaria
lógica de faixa — duas implementações da mesma regra divergem em silêncio.

E o custo de esperar é quase nulo: o SN é o **último** passo, então a resposta do servidor chega
logo em seguida. A conferência por passo existe para pegar o erro **enquanto o item está na mão**;
no passo 6 o envio acontece imediatamente depois.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/setup/domain/conferencia-troca.ts` (criar) | as regras dos passos 2–5 e as frases, espelhando a `st_trocar_rolo` |
| `src/modules/setup/domain/__tests__/conferencia-troca.test.ts` (criar) | os casos de cada regra, nos dois processos |
| `src/app/(app)/setup/operar/abastecimento/abastecimento.tsx` (modificar) | carrega os itens do setup e passa ao modal |
| `src/app/(app)/setup/operar/abastecimento/modal-abastecimento.tsx` (modificar) | chama a conferência no `avancar()` e limpa o campo na recusa |

---

### Task 1: as regras dos passos, no domínio

**Arquivos:**
- Criar: `src/modules/setup/domain/conferencia-troca.ts`
- Teste: `src/modules/setup/domain/__tests__/conferencia-troca.test.ts`

**Interfaces:**
- Consome: `normalizarTexto` e `separarRolo` de `src/modules/setup/domain/codigo-rolo.ts` (já
  existem; espelham o `st_norm` e o `st_rolo_prefixo` do banco).
- Produz: `conferirPasso(entrada): string | null` — devolve a frase de recusa, ou `null` quando
  passa. E o tipo `ItemDoSetup`.

**Contexto que você precisa:** as regras já existem em
`supabase/migrations/0112_setup_funcoes.sql`, na `st_trocar_rolo` (por volta das linhas 355–395).
Hoje ela acumula os motivos numa lista e devolve tudo no fim. **Copie as frases de lá, exatamente**
— inclusive a variação por processo.

- [ ] **Passo 1: escreva os testes que falham**

Crie `src/modules/setup/domain/__tests__/conferencia-troca.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { conferirPasso, type ItemDoSetup } from '../conferencia-troca'

const itens: ItemDoSetup[] = [
  { posicao: 'P1', feeder: 'F1', componente: 'CAPJ41', rolo: 'CAPJ41-0001' },
  { posicao: 'P2', feeder: 'F2', componente: 'RESX10', rolo: 'RESX10-0007' },
  { posicao: 'P3', feeder: 'F3', componente: 'CAPJ41', rolo: null },
]
const smd = { itens, pth: false }
const pth = { itens, pth: true }

describe('passo da POSIÇÃO', () => {
  it('passa quando a posição existe no setup', () => {
    expect(conferirPasso({ ...smd, campo: 'posicao', valor: 'P1', bipados: {} })).toBeNull()
  })
  it('recusa a posição que não existe, com a frase do servidor', () => {
    expect(conferirPasso({ ...smd, campo: 'posicao', valor: 'P9', bipados: {} }))
      .toBe('A posição P9 não existe nesse setup.')
  })
  it('no PTH a mesma recusa fala em posto', () => {
    expect(conferirPasso({ ...pth, campo: 'posicao', valor: 'P9', bipados: {} }))
      .toBe('O posto P9 não existe nesse setup.')
  })
  it('normaliza igual ao banco: minúsculas e espaços não mudam o resultado', () => {
    expect(conferirPasso({ ...smd, campo: 'posicao', valor: ' p1 ', bipados: {} })).toBeNull()
  })
})

describe('passo do FEEDER', () => {
  it('passa quando o feeder está naquela posição', () => {
    expect(conferirPasso({ ...smd, campo: 'feeder', valor: 'F1', bipados: { posicao: 'P1' } })).toBeNull()
  })
  it('recusa o feeder que não existe no setup', () => {
    expect(conferirPasso({ ...smd, campo: 'feeder', valor: 'F9', bipados: { posicao: 'P1' } }))
      .toBe('O feeder F9 não existe nesse setup.')
  })
  it('recusa o feeder que existe, mas em outra posição', () => {
    expect(conferirPasso({ ...smd, campo: 'feeder', valor: 'F2', bipados: { posicao: 'P1' } }))
      .toBe('O feeder F2 não está na posição P1.')
  })
  it('no PTH fala em locação e posto', () => {
    expect(conferirPasso({ ...pth, campo: 'feeder', valor: 'F2', bipados: { posicao: 'P1' } }))
      .toBe('A locação F2 não está no posto P1.')
  })
})

describe('passo do ROLO QUE SAI', () => {
  it('passa quando é o rolo montado — pela chave, não pelo texto', () => {
    // CAPJ41-1 e CAPJ41-0001 são o MESMO rolo: a chave despreza os zeros à esquerda.
    expect(conferirPasso({ ...smd, campo: 'saida', valor: 'CAPJ41-1',
      bipados: { posicao: 'P1', feeder: 'F1' } })).toBeNull()
  })
  it('recusa quando o rolo montado é outro, dizendo qual é', () => {
    expect(conferirPasso({ ...smd, campo: 'saida', valor: 'RESX10-0007',
      bipados: { posicao: 'P1', feeder: 'F1' } }))
      .toBe('O rolo montado na posição P1 é CAPJ41-0001, não RESX10-0007.')
  })
  it('posição sem rolo montado diz "(nenhum)", como o servidor', () => {
    expect(conferirPasso({ ...smd, campo: 'saida', valor: 'CAPJ41-0002',
      bipados: { posicao: 'P3', feeder: 'F3' } }))
      .toBe('O rolo montado na posição P3 é (nenhum), não CAPJ41-0002.')
  })
})

describe('passo do ROLO QUE ENTRA', () => {
  const b = { posicao: 'P1', feeder: 'F1', saida: 'CAPJ41-0001' }
  it('passa com outro rolo do mesmo componente', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'CAPJ41-0099', bipados: b })).toBeNull()
  })
  it('recusa componente diferente', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'RESX10-0050', bipados: b }))
      .toBe('Componente diferente: sai CAPJ41, entra RESX10.')
  })
  it('recusa o mesmo rolo que sai', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'CAPJ41-1', bipados: b }))
      .toBe('O rolo que entra é o mesmo que sai.')
  })
  it('recusa rolo que já está montado em outra posição', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'RESX10-0007',
      bipados: { posicao: 'P2', feeder: 'F2', saida: 'RESX10-0007' } }))
      .toBe('O rolo que entra é o mesmo que sai.')
    // e o caso de verdade: entra na P1 um rolo que está montado na P2
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'RESX10-0007', bipados: b }))
      .toBe('Componente diferente: sai CAPJ41, entra RESX10.')
  })
  it('recusa código de rolo inválido', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'SEMTRACO', bipados: b }))
      .toBe('Código do rolo que entra inválido: SEMTRACO.')
  })
})

describe('o colaborador e o SN não são conferidos aqui', () => {
  it('o colaborador passa sempre', () => {
    expect(conferirPasso({ ...smd, campo: 'colaborador', valor: 'qualquer', bipados: {} })).toBeNull()
  })
  // O SN exige a faixa da OP, que o modal não carrega — fica com o servidor, no envio.
  it('o SN passa sempre', () => {
    expect(conferirPasso({ ...smd, campo: 'sn', valor: '9999', bipados: {} })).toBeNull()
  })
})
```

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run src/modules/setup/domain/__tests__/conferencia-troca.test.ts --exclude "**/.claude/**" --maxWorkers=2`
Esperado: FALHA com `Failed to resolve import ../conferencia-troca`.

- [ ] **Passo 3: implemente**

Crie `src/modules/setup/domain/conferencia-troca.ts`. A estrutura:

```ts
import { normalizarTexto, separarRolo } from './codigo-rolo'

/** O que a conferência precisa saber de cada item montado no setup. */
export interface ItemDoSetup {
  posicao: string
  feeder: string
  componente: string
  rolo: string | null
}

export interface EntradaConferencia {
  campo: 'colaborador' | 'posicao' | 'feeder' | 'saida' | 'entrada' | 'sn'
  valor: string
  /** O que já foi bipado nos passos anteriores, como o operador digitou. */
  bipados: { posicao?: string; feeder?: string; saida?: string }
  itens: ItemDoSetup[]
  /** PTH fala em posto/locação; SMD, em posição/feeder. É a mesma distinção da st_trocar_rolo. */
  pth: boolean
}

/**
 * A regra do passo, ou `null` quando passa.
 *
 * As frases são as da `st_trocar_rolo` (0112), COPIADAS palavra por palavra — inclusive a variação
 * por processo. Se a regra mudar lá, muda aqui: duas fontes de texto para a mesma regra divergem
 * com o tempo, e aí a mensagem do passo diz uma coisa e a do envio diz outra.
 *
 * O SN não entra: ele exige a faixa da OP, que o modal não carrega, e portar `st_sn_na_faixa`
 * duplicaria lógica de faixa. Como é o ÚLTIMO passo, a resposta do servidor chega logo em seguida.
 */
export function conferirPasso(e: EntradaConferencia): string | null {
  // ... implemente cada caso usando normalizarTexto (= st_norm) e separarRolo (= st_rolo_prefixo)
}
```

Regras, na ordem em que a `st_trocar_rolo` as escreve:

1. **posicao** — não existe item com essa posição ⇒ `A posição %s não existe nesse setup.`
   (PTH: `O posto %s não existe nesse setup.`)
2. **feeder** — não existe item com esse feeder ⇒ `O feeder %s não existe nesse setup.`
   (PTH: `A locação %s não existe nesse setup.`); existe, mas não naquela posição ⇒
   `O feeder %s não está na posição %s.` (PTH: `A locação %s não está no posto %s.`)
3. **saida** — a chave do valor difere da chave do `rolo` do item ⇒
   `O rolo montado na posição %s é %s, não %s.` (PTH: `...no posto %s...`), com `(nenhum)` quando
   o item não tem rolo. **A comparação é pela CHAVE** (`separarRolo().normalizado`), não pelo
   texto: `CAPJ41-1` e `CAPJ41-0001` são o mesmo rolo.
4. **entrada** — código inválido ⇒ `Código do rolo que entra inválido: %s.`; prefixo diferente do
   que sai ⇒ `Componente diferente: sai %s, entra %s.`; mesma chave do que sai ⇒
   `O rolo que entra é o mesmo que sai.`; a chave já está montada em **outra** posição ⇒
   `O rolo %s já está montado na posição %s.` (PTH: `...no posto %s.`)
5. **colaborador** e **sn** ⇒ sempre `null`.

- [ ] **Passo 4: rode e veja passar**

Run: `npx vitest run src/modules/setup/domain/__tests__/conferencia-troca.test.ts --exclude "**/.claude/**" --maxWorkers=2`
Esperado: PASSA.

- [ ] **Passo 5: confira que as frases batem com o banco, de verdade**

```bash
grep -oE "'[A-ZÀ-Ú][^']{10,}\.'" src/modules/setup/domain/conferencia-troca.ts | sort -u
grep -oE "format\('[^']+'" supabase/migrations/0112_setup_funcoes.sql | sort -u
```
Compare as duas listas. Toda frase que você escreveu tem de existir na migração. **Diferença de
uma palavra é achado** — anote no relatório se encontrar alguma.

- [ ] **Passo 6: tipos**

Run: `npx tsc --noEmit`
Esperado: sem saída.

- [ ] **Passo 7: commit**

```bash
git add src/modules/setup/domain/conferencia-troca.ts src/modules/setup/domain/__tests__/conferencia-troca.test.ts
git commit -m "setup: as regras da troca de rolo, alcançáveis a cada passo"
```

---

### Task 2: o modal confere a cada bipe

**Arquivos:**
- Modificar: `src/app/(app)/setup/operar/abastecimento/abastecimento.tsx`
- Modificar: `src/app/(app)/setup/operar/abastecimento/modal-abastecimento.tsx`
- Teste: `src/app/(app)/setup/operar/abastecimento/__tests__/modal-abastecimento.test.tsx`

**Interfaces:**
- Consome: `conferirPasso` e `ItemDoSetup` da Task 1; `carregarSetupAction(id)` de
  `src/modules/setup/application/setup-actions.ts`, que **já existe** e devolve
  `{ ok: true; setup: SetupResumo; itens: ItemSetup[] }`.

**Contexto que você precisa — leia antes de escrever:**

**Não crie consulta nova.** A `carregarSetupAction` já devolve os itens. A página
(`abastecimento.tsx`) hoje chama só a `localizarSetup`, que traz o resumo. Acrescente a chamada da
`carregarSetupAction` **quando o setup é localizado** e passe `itens` ao modal por prop. Uma
consulta a mais por setup aberto — **nenhuma por bipe**.

**O modal já tem o gancho certo.** Existe uma função `recusar(titulo)` que mostra o painel **e
toca o som de erro** — o comentário dela diz por quê: *"Recusa que se percebe: som e painel. Recusa
calada é bipe perdido sem ninguém notar."* O operador não olha a tela; é o som que o alcança.
**Use a `recusar`, não invente outro caminho de aviso.**

**Onde entra:** na função `avancar()`, **depois** das duas guardas que já existem (envio em curso e
campo em branco) e **antes** do `irPara(passo + 1)`.

**Na recusa, limpe o campo** (decisão do usuário: *"mensagem informando o que está errado, e deixa
o campo limpo para ele bipar de novo"*). O passo **não** muda e os passos anteriores ficam.

⚠️ **Não mexa no envio nem nas duas guardas existentes.** A guarda de envio em curso usa um `ref`
síncrono de propósito — o comentário explica que o leitor manda dois Enter tão rápido que o segundo
chega antes de o React aplicar o estado.

- [ ] **Passo 1: escreva os testes que falham**

No arquivo de teste do modal, acrescente:

```tsx
it('recusa a posição que não existe no setup, sem ir ao servidor', async () => {
  // monta o modal com itens [{posicao:'P1',feeder:'F1',componente:'CAPJ41',rolo:'CAPJ41-0001'}]
  // bipa o colaborador, avança, bipa 'P9', Enter
  expect(await screen.findByText('A posição P9 não existe nesse setup.')).toBeInTheDocument()
  expect(trocarRoloMock).not.toHaveBeenCalled()
})

it('na recusa, o campo limpa e o passo NÃO avança', async () => {
  // mesma sequência
  expect(campoAtual).toHaveValue('')
  expect(screen.getByText(/2\s*\/\s*6/)).toBeInTheDocument() // continua no passo da posição
})

it('os passos anteriores não se perdem na recusa', async () => {
  // o colaborador bipado no passo 1 continua no rastro
})

it('o caminho certo atravessa os seis passos e envia uma vez só', async () => {
  // P1, F1, CAPJ41-0001, CAPJ41-0099, SN
  expect(trocarRoloMock).toHaveBeenCalledTimes(1)
})

it('o SN não é conferido no cliente — segue para o servidor', async () => {
  // um SN fora de qualquer faixa avança e chega na action
  expect(trocarRoloMock).toHaveBeenCalled()
})
```

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run "src/app/(app)/setup" --exclude "**/.claude/**" --maxWorkers=2`
Esperado: FALHA — hoje a posição inexistente avança sem reclamar.

- [ ] **Passo 3: a página carrega os itens**

Em `abastecimento.tsx`, onde hoje o setup é localizado, acrescente a carga dos itens e guarde em
estado, passando ao modal como prop `itens`. Trate a falha: se a carga dos itens falhar, **o modal
ainda tem de abrir** e funcionar como hoje (a conferência some, o servidor continua conferindo no
envio) — nunca travar o operador por causa de uma conferência que é um extra.

- [ ] **Passo 4: o modal confere**

Em `modal-abastecimento.tsx`, acrescente `itens: ItemDoSetup[]` às props e, dentro de `avancar()`:

```ts
// A conferência do passo, contra o que já foi bipado. Roda no cliente: nenhuma ida ao servidor
// entre um passo e outro, então não há espera nem janela para o bipe seguinte entrar por cima.
// O envio final continua passando pela st_trocar_rolo, que é quem vale.
const recusaDoPasso = conferirPasso({
  campo: atual.campo,
  valor: campos[atual.campo],
  bipados: { posicao: campos.posicao, feeder: campos.feeder, saida: campos.saida },
  itens,
  pth: rotulos.posicao === 'Posto',
})
if (recusaDoPasso) {
  recusar(recusaDoPasso)
  setCampos((c) => ({ ...c, [atual.campo]: '' }))
  setRefoco((n) => n + 1)
  return
}
```

⚠️ `pth` sai dos rótulos que o modal **já recebe** — não acrescente prop nova para isso. Confirme
qual é o rótulo do PTH lendo de onde `rotulos` vem na página.

- [ ] **Passo 5: rode e veja passar**

Run: `npx vitest run "src/app/(app)/setup" src/modules/setup --exclude "**/.claude/**" --maxWorkers=2`
Esperado: PASSA, incluindo os testes que já existiam.

- [ ] **Passo 6: tipos, lint e build**

```bash
npx tsc --noEmit
npx eslint "src/app/(app)/setup/operar/abastecimento" src/modules/setup
npx next build
```
Esperado: os três limpos.

- [ ] **Passo 7: commit**

```bash
git add "src/app/(app)/setup/operar/abastecimento" src/modules/setup
git commit -m "setup: o erro aparece no passo em que nasce, não só no envio"
```

---

## Depois das duas tarefas

1. Revisão da branch com `superpowers:requesting-code-review`.
2. Smoke guiado: posição que não existe · feeder de outra posição · rolo que sai errado ·
   componente diferente · rolo que entra igual ao que sai · e o caminho certo de ponta a ponta.
   **Conferir que o som toca na recusa** — é ele que alcança o operador, não a tela.
3. Conferir no tablet que o modal (agora em 65% da tela) mostra o rastro dos bipes já feitos.
