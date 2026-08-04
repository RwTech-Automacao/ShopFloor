# Confirmação de conserto ao aprovar (postos sem manutenção) — Design

> **Data:** 2026-08-04 · **Módulo:** ShopFloor · **Branch:** `feat/shopfloor-confirma-conserto`
> **Tipo:** fluxo de Lançamento + 1 tabela de auditoria (migração **0072**).

## Contexto
Postos que **coletam defeito na reprova** mas **consertam no próprio posto** (não vão pra Manutenção)
hoje deixam a peça ser re-bipada como **Aprovado** sem nenhuma checagem de que o defeito relatado foi
mesmo resolvido. O usuário quer uma **confirmação** nesse momento: ao aprovar uma peça que tinha reprova
com defeito naquele posto, o sistema pergunta *"o defeito relatado foi mesmo consertado?"* e só grava a
aprovação após confirmar (com auditoria de quem confirmou).

## Decisões (brainstorm)
- **Gatilho:** perfil com `reprova !== 'nenhum'` **e** `exigeManutencao === false` (perfil-driven; ex.: Inspeção).
- **Mostra:** os defeitos da **última reprova** da peça naquele posto.
- **Cancelar:** aborta a aprovação (nada é gravado).
- **Auditoria:** grava quem confirmou + quando + o defeito → **migração 0072**.

## Design

### Regra do gatilho (domínio)
`perfilPedeConfirmacaoConserto(p) = p.reprova !== 'nenhum' && !p.exigeManutencao`.

### Quando dispara
No Lançamento, ao **Enviar com status = Aprovado** num posto que atende o gatilho:
1. Busca o **registro mais recente** da peça `(pmo, op, numero_serie_norm, posto)`.
2. Se esse último registro é **Reprovado** → pega os defeitos daquela reprova (todas as linhas reprovadas
   do mesmo evento = mesmo `data_hora` mais recente) e **abre o diálogo de confirmação** listando-os.
   - **Confirma** → grava o Aprovado (fluxo `lancar` atual) **+** insere a auditoria.
   - **Cancela** → aborta (não grava nada).
3. Se o último registro **não** é reprova (peça nova, ou já aprovada) → aprova direto, sem diálogo.

### Migração 0072 — `sf_conserto_confirmado`
```
id uuid pk, data_hora timestamptz default now(), colaborador text, pmo text, op text,
numero_serie text, numero_serie_norm text, posto text,
codigo_defeito text, posicao text, tipo_defeito text, created_at timestamptz default now()
```
RLS: select `tem_permissao('visualizar')`; insert `tem_permissao('lancar')`. **Uma linha por defeito confirmado.**

### Camadas
- **Domínio** `perfil-posto.ts`: `perfilPedeConfirmacaoConserto(p)` (+ teste).
- **Repo** `lancamento-repository.ts` (ou repo do módulo): `buscarUltimaReprovaDoPosto(pmo, op, snNorm, posto)`
  → `{ defeitos: {codigo,posicao,tipo}[]; dataHora } | null` (null se o último registro não é reprova).
- **Action** `lancar-action.ts` (ou nova): `verificarConserto(pmo, op, numeroSerie, posto)` → defeitos p/ confirmar
  (ou null); e ao confirmar, gravar a auditoria (insert em `sf_conserto_confirmado`) junto do `lancar`.
- **Client** `lancamento-form.tsx`: no Enviar com Aprovado + perfil-gatilho, chama `verificarConserto`; se houver
  defeitos, abre `useConfirmacao` (já existe) com a lista; confirma → `lancar` + auditoria; cancela → aborta.

## Critérios de sucesso
- Peça reprovada com defeito num posto sem-manutenção, ao ser aprovada, dispara o diálogo com os defeitos da
  última reprova; confirmar grava aprovado + auditoria; cancelar não grava.
- Peça sem reprova anterior no posto aprova direto (sem diálogo).
- Postos com manutenção **não** disparam (têm reparo próprio).
- build + lint + testes verdes. Migração aplicada no **Dev** primeiro.

## Riscos
- **Critério "última reprova"**: usar o registro mais recente do posto; se for reprova, é o que vale (a peça
  voltou pra consertar). Determinístico com desempate por `id`/`created_at`.
- **Atomicidade auditoria×aprovado**: grava aprovado (RPC atual) e depois insere a auditoria; se a auditoria
  falhar, a aprovação já ocorreu (auditoria é secundária) — logar e seguir; não bloquear o chão de fábrica.
- **Sem push** (usuário testando); migração 0072 aplicada no Dev.
