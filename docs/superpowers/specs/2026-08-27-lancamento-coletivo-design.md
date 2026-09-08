# Lançamento Coletivo — design

## Problema / objetivo
Hoje, no Lançamento do ShopFloor, cada bipe grava **1 SN na hora** (`lancar` → RPC `sf_lancar`).
Em postos de entrada/inspeção SMT, uma placa (painel) traz **7-15 SNs que chegam juntos** —
bipar e gravar um a um é lento. O **Lançamento Coletivo** deixa o operador **bipar vários SNs**,
acumular numa lista e **enviar todos de uma vez** (manual), mantendo toda a automação de hoje.

## Decisões (fechadas com o usuário)
- **Flag por POSTO** (`sf_postos.coletivo`), configurável no **Cadastrar Posto**.
- A opção só aparece pra perfis **`passagem`, `spi`, `inspecao`** (Inicial / Inspeção SPI /
  Inspeção com defeitos) — os únicos onde faz sentido. Chavear pela **`chave`** do perfil
  (renomear o `nome` depois não quebra). Outros perfis: sem a opção.
- **Postos atuais ficam como estão** (coletivo=false, já foram usados); a feature entra em
  **postos NOVOS** cadastrados com a opção.
- **Reprova resolve na hora, item a item:** ao bipar um defeito, abre a seleção de
  defeito/posições NAQUELE SN (como hoje) e ele entra na lista já preenchido. A lista mistura
  aprovados e reprovados.
- **Máximo 15 SNs por lote** (`MAX_LOTE = 15`). Ao tentar o 16º, bloqueia com aviso.
- **Enviar = melhor esforço:** grava os que dão certo; os que falharem (duplicado, gate do
  posto anterior, etc.) **ficam na lista com o motivo**. 1 SN ruim não trava os bons.
- Dá pra **remover** uma linha antes de enviar (bipe errado). Depois de enviar, a lista fica
  só com as pendências; contexto (colaborador/posto/OP) permanece.

## Solução

### Dados
- Migração: **`alter table public.sf_postos add column if not exists coletivo boolean not null default false`**.
- `sf-postos-actions.ts` / repositório de postos: incluir `coletivo` no create/update e nas leituras.

### Cadastrar Posto (`posto-form.tsx`)
- Checkbox **"Lançamento coletivo"**, **visível só quando o perfil selecionado ∈ {`passagem`,`spi`,`inspecao`}**
  (se trocar pra outro perfil, some/zera). Grava em `sf_postos.coletivo`.

### Backend (sem RPC nova no v1)
- Nova action **`lancarLote(itens: EntradaLancamento[])`** em `application/`:
  - Valida sessão + `MAX_LOTE` (recusa > 15 — backstop).
  - Para cada item, chama a **`lancar(item)` existente** (reusa TODA a lógica/validação por SN —
    idêntico ao bipe único), capturando erro **por item**.
  - Retorna **`{ resultados: { numeroSerie: string; ok: boolean; erro?: string }[] }`** (melhor esforço).
  - *(Otimização futura, fora do v1: RPC `sf_lancar_lote` de 1 round-trip, ou carregar a ordem/perfil
    uma vez e só variar o SN — hoje `lancar` recarrega por item; aceitável p/ ≤15 e envio manual.)*

### Frontend (`lancamento-form.tsx`)
- Determinar **`ehColetivo`** = o posto atual tem `coletivo=true` (mapa posto→coletivo, vindo das props).
- Em modo coletivo, o **ponto de commit** do bipe muda: onde hoje chama `lancar()` (incl. o confirm
  de reprova), passa a **empilhar na lista do lote** (`lote: EntradaLancamento[]`) em vez de gravar.
  - Toda a resolução de aprovado/reprovado + seleção de defeito/posições acontece **igual a hoje**,
    só o destino final vira a lista.
  - Bloqueia bipe quando `lote.length >= MAX_LOTE` (aviso).
- **Lista do lote:** mostra cada SN empilhado (status + defeito/posições), com botão **remover** por linha
  e o motivo de falha quando houver.
- Botão **"Enviar (N)"** → `lancarLote(lote)` → melhor esforço: remove da lista os `ok`, mantém os que
  falharam com o `erro`; refaz o histórico + contagem do posto (uma vez, no fim).

### Layout
- Posto coletivo → área de ação = **Bipe (esq) + Lista do lote com "Enviar" (dir)**; o **histórico normal**
  continua embaixo (o que já foi gravado). Reusa a estrutura das telas especiais (Integração/Embalagem/NQA).

## Fora do escopo (v1)
- **Persistência da lista no refresh** (dá pra add depois, mesmo padrão do "Retomar" do NQA).
- Auto-send ao atingir N.
- Editar o status de um SN direto na lista (a reprova é resolvida no bipe).
- RPC `sf_lancar_lote` (otimização; v1 usa loop da action).

## Edge cases
- **Lote cheio (15):** 16º bipe bloqueado com aviso até enviar/remover.
- **Falha parcial:** itens com erro ficam na lista com o motivo (mapear os códigos do `sf_lancar`:
  DUPLICADO, SEQUENCIA, SEM_MANUTENCAO, etc. — reusar o mapa `MENSAGENS` da action).
- **SN repetido no próprio lote:** bloquear ao bipar (já está na lista) — mesma checagem de duplicidade
  local dos outros painéis.
- **Trocar de posto/OP com lote pendente:** pedir **confirmação de descarte** do lote antes de trocar
  (reusar o `useConfirmacao` já existente no form). Se confirmar, limpa a lista.
- **Perfil sem suporte:** se por algum motivo um posto não-{passagem/spi/inspecao} tiver `coletivo=true`
  (dado antigo), o form ignora (trata como normal) — defesa.

## Sem impacto em Prod até o merge; migração só adiciona coluna (aditiva, default false).
