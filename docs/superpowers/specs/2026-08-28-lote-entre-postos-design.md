# Lote entre postos — design

> Design/spec. Estende o **Lançamento Coletivo v1** (branch `feat/shopfloor-lancamento-coletivo`):
> um painel físico lançado junto (ex.: 5 placas) passa a ser **rastreado como um lote** e, nos
> postos coletivos seguintes, aparece **pré-listado** como checklist — **sem mudar o gesto de bipe**.
> Tela: ShopFloor → Operar → Lançamento.

## Contexto

O coletivo v1 (já pronto nesta branch) deixa o operador empilhar N bipes num posto coletivo
(`PERFIS_COLETIVO_OK = passagem, spi, inspecao`) e enviar tudo de uma vez (best-effort). Mas o
lote é **efêmero**: existe só como estado da tela e, ao enviar, vira N linhas soltas em
`sf_registros` compartilhando `(pmo, op)` + faixa de SN — **nada liga as N linhas como um grupo**.

Na prática da fábrica, um **painel físico** (ex.: 5 placas, SN `26333001`–`26333005`) é montado
junto e viaja junto pela linha. Hoje, em cada posto de inspeção seguinte, o operador precisa
lembrar/rebipar cada placa sem uma visão do painel inteiro. Queremos:

1. **Gravar a identidade do painel** (um `lote_id` interno) no primeiro envio coletivo.
2. Nos postos seguintes, ao bipar **uma** placa do painel, **pré-listar as irmãs ainda pendentes
   ali** como checklist — pra não esquecer nenhuma e ver o progresso.

**O gesto de aprovar/reprovar continua 100% igual a hoje.** A única novidade visual é a lista do
painel.

## Decisões travadas (do brainstorm)

- **Modelo escolhido: lote físico gravado** (o mais seguro; a lista é ancorada num bipe real e só
  mostra o grupo que realmente existe). Descartados: "fila do posto" (mostra mais do que está na
  bancada → risco de aprovar peça ausente) e "faixa contígua" (aposta que o painel é contíguo).
- **`lote_id` é interno** — nunca aparece na tela.
- **Independente da ordem dos postos** — inspeção antes de passagem, ambos coletivo, deve
  funcionar. Por isso o lote **não** é "criado no Inicial": é criado no **primeiro envio coletivo**
  desses SNs, seja qual for o posto.
- **Gatilho: bipar 1 puxa o painel** (não tocar na linha). O bipe físico confirma que o painel
  está na bancada.
- **Gesto de bipe inalterado:** aprovar = bipa o SN → modal "Confirmar aprovação" → **bipa de novo**
  (bipa 2×); reprovar = **seleciona o defeito** → modal Reprova → **bipa o SN** pra associar.
- **Enviar com pendentes → avisa** ("N ainda pendentes — enviar assim mesmo?").

## Modelo de dados (migração `0086`)

Nova tabela interna mapeando cada SN ao seu painel, por OP:

```sql
create table if not exists sf_lotes (
  pmo               text not null,
  op                text not null,
  numero_serie_norm text not null,
  lote_id           uuid not null,
  criado_em         timestamptz not null default now(),
  primary key (pmo, op, numero_serie_norm)
);
create index if not exists sf_lotes_grupo on sf_lotes (pmo, op, lote_id);
```

- Chave `(pmo, op, numero_serie_norm)` → **cada SN pertence a no máximo um lote por OP**.
- `numero_serie_norm` = a forma normalizada já usada em `sf_registros` (via `normalizarSerie` /
  `normalizar_serie` no banco) — garante casamento consistente.
- `lote_id` = identidade interna do painel. **Nunca exposta na UI.**

**RLS/gate** (segue o padrão dos outros `sf_*`):
- **Leitura:** `authenticated` (operadores precisam ler o lote). RLS select liberado.
- **Escrita:** só via a RPC de criação abaixo (SECURITY DEFINER com gate de permissão de lançar);
  sem grant de INSERT direto pra `authenticated`.

### RPC de criação do lote

```
sf_criar_lote(p_pmo text, p_op text, p_sns text[]) returns uuid
```

- **SECURITY DEFINER**, gate `tem_permissao('shopfloor','lancar')` (mesma permissão do lançar).
- Normaliza cada SN (`normalizar_serie`).
- **Idempotente e defensiva:**
  - Se **todos** os SNs já pertencem ao **mesmo** `lote_id` → retorna esse `lote_id` (no-op).
  - Se **nenhum** SN tem lote → gera `gen_random_uuid()`, insere as N linhas, retorna o novo id.
  - Caso **misto** (alguns já têm lote, outros não, ou lotes diferentes) → **não força merge**:
    mantém os mapeamentos existentes, mapeia só os órfãos ao lote já existente predominante
    (o `lote_id` do primeiro SN que já tiver um); se não houver nenhum existente, cria um novo
    e mapeia os órfãos. Nunca sobrescreve um `lote_id` já gravado.
- Retorna o `lote_id` resultante (usado só internamente; a UI ignora).

> **Por que RPC e não INSERT direto:** o gate de permissão e a normalização ficam no servidor, no
> mesmo padrão dos demais `sf_*`; a UI nunca inventa `lote_id`.

## Fluxo — criação (posto criador)

Acontece no **envio** do lote coletivo (`enviarLote` → action). Depois de resolver os N itens
(best-effort), **antes ou junto** do envio, chama `sf_criar_lote(pmo, op, sns)` com os SNs
enviados. Regras:

- Só cria/mapeia os SNs que **foram efetivamente enviados** (não os que falharam).
- Como a RPC é idempotente, reenviar o mesmo painel não duplica nada.
- No posto criador **não há pré-listagem** (os SNs ainda não têm lote quando o operador começa a
  bipar) → **comportamento v1 intacto**: bipa cada um, envia, e o envio cria o lote.

## Fluxo — consumo (posto seguinte)

1. Operador bipa a **1ª placa da mão** e a resolve **igual a hoje** (aprovar 2× / defeito+bipe).
2. Ao empilhar o **primeiro** item de um lote ainda não "puxado" nesta sessão, dispara uma leitura:

   ```
   carregarLotePendente(pmo, op, posto, sn) → { snsPendentes: string[] }
   ```

   Que:
   - Acha o `lote_id` de `sn` em `sf_lotes` (nesta OP). Se não houver → retorna vazio (SN avulso,
     sem lote) → nada muda (v1).
   - Lista todos os SNs do mesmo `lote_id`.
   - Carrega os registros da OP e, via `postoPendenteDePeca` (domínio de Fluxo, já existente),
     filtra os irmãos **ainda pendentes neste `posto`** (não feitos aqui; passaram do anterior).
   - Exclui o SN recém-resolvido e quaisquer que já estejam na lista.
   - Retorna os SNs pendentes restantes.
3. Esses SNs entram na lista como **"Pendente"** (placeholders do checklist).
4. Operador bipa as próximas do mesmo jeito → cada bipe **substitui** o placeholder correspondente
   (casado por SN normalizado) pelo item **resolvido** (Aprovado/Reprovado).
5. **Enviar** — botão mostra a contagem de **resolvidas**. Se houver placeholders "Pendente":
   diálogo de confirmação ("N ainda pendentes — enviar assim mesmo?"). Confirmando, envia as
   resolvidas (best-effort v1); as pendentes **continuam na lista** (não são descartadas).

### Reuso

`carregarLotePendente` reusa a infra da tela de Fluxo: `carregarDetalhePosto` /
`postoPendenteDePeca` (`src/modules/shopfloor/domain/fluxo-op.ts`,
`src/modules/shopfloor/infra/fluxo-repository.ts`) + a sequência de postos
(`sf_ordem_postos.ordem`). Nada de derivação nova de "pendente".

## Mudança no estado do lote (UI) — o ponto central de código

Hoje `ItemLote = { entrada: EntradaLancamento; outcome: 'aprovado'|'reprovado'|null; erro? }` e
todo item entra **já resolvido**. Passa a existir um estado **"pendente"** (placeholder, sem
`entrada` real ainda):

```ts
type ItemLote =
  | { estado: 'pendente'; sn: string }                                    // placeholder do painel
  | { estado: 'resolvido'; entrada: EntradaLancamento;
      outcome: 'aprovado' | 'reprovado' | null; erro?: string }           // como o v1 de hoje
```

- **`empilharNoLote`** muda: ao resolver um SN, se existir um placeholder **pendente** com o mesmo
  SN → **substitui** (não rejeita como duplicado); se já existir um item **resolvido** com o mesmo
  SN → rejeita como hoje ("Este SN já está no lote").
- **`enviarLote`** envia só os itens `resolvido`. Placeholders `pendente` são ignorados no envio e
  preservados na lista (junto com as falhas, via o update funcional que o v1 já usa).
- **Contagem / botão:** "Enviar (R)" onde R = itens resolvidos. Título do card mostra
  resolvidas × total do painel (ex.: "Lote — 3/5"). Placeholders aparecem com rótulo "Pendente".
- **Aviso no Enviar:** se houver ≥1 pendente, `confirmar({ titulo: 'N ainda pendentes — enviar
  assim mesmo?', ... })` antes de enviar.

O `MAX_LOTE` (15) continua valendo pro total de itens na lista (resolvidos + pendentes).

## Escopo

**Entra:**
- Migração `0086` (`sf_lotes` + `sf_criar_lote` + RLS).
- Persistência do lote no envio coletivo (posto criador).
- `carregarLotePendente` (action + reuso da infra de Fluxo).
- Pré-listagem "puxar painel" no primeiro item resolvido de um lote.
- Estado "pendente" no lote + substituição por SN + contagem/rótulos.
- Aviso ao enviar com pendentes.

**Fora de escopo:**
- Mostrar o `lote_id` na UI (é interno).
- Despaletização / dividir ou juntar painéis depois de criados (o painel físico segue junto até a
  inspeção; se despaletizar, o posto seguinte simplesmente não terá todas fisicamente — o operador
  resolve as que tiver; edge conhecido, não tratado agora).
- Auto-mostrar lotes pendentes sem bipar (descartado no brainstorm — bipe-âncora é a segurança).
- Relayout da tela (é o **próximo** brainstorm, mesma branch).
- Mexer no gesto de bipe / nos modais Aprovar/Reprovar.

## Arquivos (previsão)

- **Migração** `supabase/migrations/0086_sf_lotes.sql` (tabela + RPC + RLS).
- **Infra** `src/modules/shopfloor/infra/lote-repository.ts` (chamar `sf_criar_lote`; ler `sf_lotes`
  e cruzar com a derivação de pendentes de `fluxo-repository`).
- **Application** em `src/modules/shopfloor/application/lancar-action.ts` (ou arquivo próprio):
  `carregarLotePendente(pmo, op, posto, sn)` e a criação do lote no envio (`lancarLote` /
  `enviarLote` server-side).
- **UI** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`: novo estado "pendente" no
  lote, substituição por SN, pull no primeiro item, contagem/rótulos, aviso no Enviar.
- **Domínio** `src/modules/shopfloor/domain/lote.ts`: tipo `ItemLote` atualizado + helpers puros
  (ex.: separar resolvidos × pendentes, casar placeholder por SN) — cobríveis por teste de unidade.

## Migração e compatibilidade

- `0086` é aditiva (nova tabela + RPC). Prod segue como está até o batch merge.
- Numeração: última nesta branch é `0085`; há gaps (0079/0082/0083/0084 vivem em outras branches) —
  `0086` é a próxima livre **nesta** branch. Conferir no merge se não colide com a main.
- Sem `sf_lotes`/sem lote → tudo cai no **comportamento v1** (fallback natural; nunca quebra).

## Como saber que deu certo

- **Criação:** no posto coletivo criador, envio de 5 SNs → `sf_lotes` ganha 5 linhas com o mesmo
  `lote_id`. Reenviar não duplica.
- **Consumo:** noutro posto coletivo da mesma OP, bipar 1 das 5 e aprovar → as outras 4 (pendentes
  ali) aparecem como "Pendente" na lista. Bipar as demais → viram Aprovado/Reprovado.
- **Ordem trocada:** com inspeção antes de passagem (ambos coletivo), o painel criado na inspeção é
  pré-listado na passagem seguinte (e vice-versa).
- **Pendentes no Enviar:** clicar Enviar com placeholders → diálogo de aviso; confirmar envia as
  resolvidas e mantém as pendentes.
- **Avulso / sem lote:** bipar um SN sem lote → nenhum painel é puxado; comportamento v1 idêntico.
- `npm run lint` + `tsc` + testes verdes (helpers de `domain/lote.ts` cobertos por unidade; o resto
  é verificação por smoke).
