# Justificativa de divergência — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development.

**Objetivo:** numa linha com divergência, um selo **?** que vira **✅** depois que alguém escreve o
porquê e o que foi alinhado. Aparece na grade de Processos e no card "Divergência de quantidade"
do Fluxo.

**Spec:** `docs/superpowers/specs/2026-10-08-justificativa-divergencia-design.md` — leia antes.

**Arquitetura:** a regra "qual selo mostrar" mora numa **função pura só**, e as duas telas chamam.
Duas telas decidindo o mesmo estado por caminhos diferentes é a família de defeito que já custou
seis correções neste projeto.

## Restrições globais

- **Tudo em PT-BR**: identificadores, comentários, mensagens, textos de tela.
- ⚠️ `--maxWorkers=2` é **obrigatório** no vitest desta máquina (4 núcleos; sem isso exit 137).
- ⚠️ `next build` **RODA** nesta worktree (`node_modules` é diretório real):
  `NODE_OPTIONS="--max-old-space-size=4096" npx next build`.
- ⚠️ **`'use server'` só exporta funções async.** Exportar um tipo de lá quebra o `next build` **em
  silêncio**. Tipos vão para `domain/`.
- ⚠️ **`tem_permissao` sempre com 2 argumentos.** A de 1 argumento checa permissão GLOBAL e anula o
  RBAC por módulo. Aqui o módulo é **`recebimento`**.
- Migração **idempotente**; `$func$` se houver função (o SQL Editor recusa `$$`, inclusive em
  comentário); `notify pgrst, 'reload schema';` no fim.
- ⚠️ **Não rode nada contra Dev nem Prod.** O projeto tem harness com Postgres descartável em
  `supabase/tests/` (`rodar-recebimento-test.sh`) — esse pode.
- `git add` com caminhos explícitos — **nunca** `git add -A` nem `git add .`.
- Commit termina com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- ⚠️ `.superpowers/` está no `.gitignore` de propósito. **NÃO** use `git add -f`.

---

### Task 1: Domínio — o estado da divergência

**Arquivos:** `src/modules/recebimento/domain/divergencia.ts` (criar) e o teste.

**Leia antes:** `domain/etapa-processo.ts`, em especial `temDivergencia` (linha ~69) — **reaproveite-a**,
não escreva outra. Ela já trata vírgula decimal, texto vazio e nulo, porque o campo `divergencia` é
**texto livre** no banco e já recebeu valor digitado no passado.

**Interface produzida:**

```ts
export type EstadoDivergencia = 'sem' | 'pendente' | 'justificada'
/** 'sem' = não há divergência (nenhum selo) · 'pendente' = ? · 'justificada' = ✅ */
export function estadoDaDivergencia(divergencia: unknown, justificativa: unknown): EstadoDivergencia
```

- [ ] **Passo 1: testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { estadoDaDivergencia } from '../divergencia'

describe('estadoDaDivergencia', () => {
  it('sem divergência: nenhum selo, mesmo com texto guardado', () => {
    // A divergência SOME quando a quantidade é corrigida, e o texto fica. Ver a spec.
    for (const d of ['0', '', '   ', null, undefined, '0,0']) {
      expect(estadoDaDivergencia(d, 'o fornecedor dividiu a entrega'), String(d)).toBe('sem')
    }
  })
  it('divergência sem justificativa: pendente', () => {
    for (const j of ['', '   ', null, undefined]) {
      expect(estadoDaDivergencia('-42', j), String(j)).toBe('pendente')
    }
  })
  it('divergência com justificativa: justificada', () => {
    expect(estadoDaDivergencia('-42', 'faltou, o fornecedor manda na semana que vem')).toBe('justificada')
  })
  it('divergência positiva também vale', () => {
    expect(estadoDaDivergencia('58', null)).toBe('pendente')
    expect(estadoDaDivergencia('58', 'veio a mais, combinado abater no próximo')).toBe('justificada')
  })
  it('vírgula decimal é divergência', () => {
    expect(estadoDaDivergencia('1,5', null)).toBe('pendente')
    expect(estadoDaDivergencia('-0,5', null)).toBe('pendente')
  })
  it('texto que não é número não conta como divergência', () => {
    expect(estadoDaDivergencia('N/A', null)).toBe('sem')
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar** reaproveitando `temDivergencia`
- [ ] **Passo 4: verde** + `npx tsc --noEmit` + eslint
- [ ] **Passo 5: commit**

---

### Task 2: Migração — os três campos

**Arquivo:** criar `supabase/migrations/0142_divergencia_justificativa.sql` (confira o livre; a
branch irmã `feat/alertas-resumo-diario` está usando a 0141).

```sql
alter table public.processos_recebimento
  add column if not exists divergencia_justificativa text not null default '',
  add column if not exists divergencia_justificada_por uuid references public.usuarios(id),
  add column if not exists divergencia_justificada_em timestamptz;
```

Mais `comment on column` em cada um, explicando **o que** guardam e, no primeiro, que ele
**sobrevive** ao sumiço da divergência (ver a spec).

⚠️ **Não mexa nas policies.** A tabela já tem RLS, e a gravação usa a mesma permissão de `editar`
que o `processos_update` exige. Confira isso lendo as policies e **diga no relatório** qual é a
regra que vai valer para a escrita.

⚠️ **Nenhum backfill**: o default `''` já deixa todo o histórico como "pendente" nas linhas que têm
divergência — que é a verdade (ninguém justificou nada ainda).

- [ ] **Passos:** escrever · reler conferindo a idempotência instrução por instrução · commit

---

### Task 3: Aplicação — gravar a justificativa

**Arquivos:** `src/modules/recebimento/application/justificar-divergencia.ts` (criar) e teste.

**Leia antes:** `application/transicoes-processo.ts` — é o molde de como este módulo faz ação com
permissão, log e `revalidatePath`.

```ts
export async function salvarJustificativaDivergencia(
  id: string, texto: string,
): Promise<{ ok: true } | { ok: false; erro: string }>
```

**O que faz:** confere a sessão e `podeNoModulo(perfil, 'recebimento', 'editar')`; apara o texto;
grava os três campos (`texto`, o `usuarioId` **da sessão** e `now()`); registra no log de auditoria
(`acao: 'justificar_divergencia'`); `revalidatePath` da tela do processo.

⚠️ **O autor vem da SESSÃO, nunca do cliente.** Um id vindo do formulário permitiria assinar em nome
de outra pessoa.

⚠️ **Texto vazio é permitido** e significa apagar a justificativa: grava `''`, e o selo volta a `?`.
Nesse caso, grave também o autor e o instante — quem apagou também é informação.

⚠️ Há um **limite** a definir para o texto (sugestão: 1000 caracteres, como o `LIMITE_EXPLICACAO`
dos alertas é 500). Corte por **ponto de código**, não por unidade UTF-16, senão um emoji na borda
sai pela metade. Veja `cortarExplicacao` em `modules/alertas/domain/mensagens.ts`.

- [ ] **Passos 1 a 5.** Testes: sem sessão recusa · sem permissão recusa · grava os três campos
      juntos · o autor é o da sessão (afirme o **valor**, não só que gravou) · texto vazio apaga ·
      texto acima do limite é cortado na fronteira certa. ⚠️ Prove que os mocks pegam.

---

### Task 4: Tela — o selo e o diálogo na grade de Processos

**Arquivos:** `src/app/(app)/recebimento/processos/processos-grid.tsx`, um componente novo para o
diálogo, e teste.

**Leia a grade inteira antes** (435 linhas) — ela tem paginação, ordenação e filtros por coluna com
estado próprio. Siga os padrões dela.

**O selo** fica **ao lado do valor da divergência**, na mesma célula — não em coluna nova. Estado
vindo de `estadoDaDivergencia`:

- `'sem'` → nada
- `'pendente'` → **?**, com `title` dizendo "Sem justificativa — clique para explicar"
- `'justificada'` → **✅ verde**, com `title` trazendo o começo do texto

**O diálogo:** uma caixa de texto, o nome de quem escreveu por último e quando (se houver), botões
salvar e cancelar. Reaproveite o componente de diálogo que o projeto já usa.

⚠️ **Sem permissão de editar, o selo MOSTRA o estado mas a caixa é só leitura.** Esconder o selo
tiraria informação de quem tem direito de ver.

- [ ] **Passos 1 a 5.** Testes: os três estados · sem divergência não tem selo · abrir mostra o
      texto anterior e o autor · salvar chama a action com o **texto exato** · salvar vazio volta
      para `?` · sem permissão a caixa não aceita digitação.

⚠️ **Prove que as asserções negativas não são vacuosas** (sabote o portão e confirme que o teste
falha). Nesta base já houve asserção negativa passando vazia porque o elemento nunca era renderizado.

---

### Task 5: Tela — o selo no card do Fluxo

**Arquivos:** `src/app/(app)/recebimento/fluxo/fluxo-form.tsx` (por volta da linha 181, onde o
`temDivergencia(i.divergencia)` já desenha o aviso âmbar), e teste.

O selo entra **à esquerda** do identificador do item (`RESI33 #499`), usando **a mesma**
`estadoDaDivergencia` da Task 1.

⚠️ **A decisão de qual selo mostrar não pode ser reimplementada aqui.** Se esta tela chamar a função
e a grade também, as duas concordam por construção. Se cada uma decidir por conta, elas divergem no
dia em que a regra mudar — e ninguém percebe, porque são telas diferentes.

**Clicar aqui abre o mesmo diálogo?** Sim, se a permissão permitir — é o mesmo componente da Task 4.
Se for muito custoso pelo contexto do card, **pare e pergunte** em vez de fazer só leitura por conta
própria.

- [ ] **Passos 1 a 5.**

---

### Task 6: As duas telas concordam

**Conferência, e provavelmente sem código novo.** Escreva um teste que monte **o mesmo processo** e
renderize nas duas telas, afirmando que o selo é o mesmo nos três estados.

É o teste que pega a regressão do dia em que alguém mexer na regra em um lugar só.

**Se já estiver tudo certo, NÃO MEXA** — diga no relatório. Commit só com o teste é resultado bom.

---

## Depois das tarefas

1. Revisão de branch inteira (modelo mais capaz).
2. 0142 no Dev → `docker compose restart rest` → smoke: achar um processo com divergência, escrever,
   ver virar ✅, reabrir e editar, conferir o nome; e ver o mesmo selo no Fluxo.
3. A migração é **aditiva** (três colunas com default) — a ordem em relação ao app é indiferente.
