# Retomar inspeção NQA após refresh — design

## Problema
Na tela **ShopFloor → Operar → Lançamento**, quando o posto é **NQA por caixa**
(`NqaCaixaPanel`), as amostras inspecionadas (Visual+Funcional) ficam só em memória
(`useState amostras`). Nada vai ao banco durante a inspeção — só ao **aprovar/reprovar**
a caixa. Logo, **atualizar a página / fechar a aba / cair a conexão** perde todas as
amostras já testadas e volta ao "bipe a caixa" do zero. O cabeçalho do Lançamento
(colaborador/cliente/pmo/op/posto) também é só `useState`, então no refresh zera junto.

## Escopo (decidido com o usuário)
- Recuperação **no mesmo navegador/PC** (refresh, fechar aba, queda) — NQA é feito em
  posto fixo. **localStorage**, sem migração de banco.
- **Não** cross-device / não retomável por outra pessoa em outro PC.
- UX = **banner "Retomar inspeção"** (retomada explícita), não restauração silenciosa —
  seguro para posto compartilhado (evita bipar no colaborador/OP do anterior).

## Solução

### Arquivos
- **NOVO** `src/app/(app)/shopfloor/operar/lancamento/nqa-progresso-local.ts`
  - `type NqaProgresso = { colaborador, cliente, pmo, op, posto, caixa: CaixaNqa,
    amostras: AmostraNqa[], selecionados: string[], salvoEm: number }`
  - `salvarNqaProgresso(p)`, `lerNqaProgresso(): NqaProgresso | null`, `limparNqaProgresso()`
  - Chave única `sf:nqa-progresso`. Tudo em `try/catch` — localStorage pode falhar/estar
    indisponível → degrada para o comportamento atual (sem persistência).
- **`nqa-caixa-panel.tsx`** — salvar e hidratar a inspeção.
- **`lancamento-form.tsx`** — o banner "Retomar inspeção".

### Persistência (no `NqaCaixaPanel`)
- **Salva** enquanto `caixa != null` (inspeção em andamento): a cada mudança de
  `caixa` / `amostras` / `selecionados`, grava o blob (com colaborador/cliente/pmo/op/posto
  vindos das props + `salvoEm = Date.now()`). *(cliente não é prop hoje — passar como prop
  nova a partir do pai, ou incluir no blob a partir do pai no momento de salvar; ver plano.)*
- **Limpa** ao aprovar/reprovar a caixa com sucesso e no `resetInspecao()` ("Trocar caixa").
- **Hidrata** no mount: inicia `caixa/amostras/selecionados` a partir da chave **somente se**
  o contexto salvo (`pmo/op/posto`) bate com as props atuais (garante restaurar a caixa certa).

### Banner (no `lancamento-form.tsx`)
- No mount, lê `lerNqaProgresso()`. Mostra o banner **apenas quando não há contexto
  selecionado** (`!colaborador && !op` — cara de pós-refresh) **e** há progresso salvo.
- Conteúdo: *"Retomar inspeção NQA — Caixa {numeroCaixa} de {colaborador} · {N} amostras"*
  com **[Retomar]** e **[Descartar]**.
- **Retomar:** seta `colaborador/cliente/pmo/op/posto` do blob → `ordemSel` resolve e
  `ehNqaCaixa` vira `true` → painel reaparece e hidrata da mesma chave. Esconde o banner.
- **Descartar:** `limparNqaProgresso()` + esconde o banner.

## Fora de escopo
- Não persiste os campos meio-digitados da amostra atual (visual/funcional/sn/obs) — se
  refrescar no meio de UMA amostra, perde só ela.
- Sem cross-device.

## Edge cases
- Caixa finalizada por outra pessoa nesse meio tempo → ao Aprovar/Reprovar a action já
  retorna erro (`jaInspecionada`). Sem tratamento extra.
- localStorage indisponível/erro/quota → `try/catch` em toda leitura/escrita; a tela
  funciona igual a hoje (só não persiste).
- OP não existe mais na lista ao Retomar → `ordemSel` fica null e o painel não aparece;
  o banner descarta na prática (aceitável, raro).

## Sem migração de banco (Prod segue na versão atual).
