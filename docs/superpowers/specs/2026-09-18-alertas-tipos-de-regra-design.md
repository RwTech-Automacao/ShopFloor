# Alertas — tipos de regra, destinatários do ShopFloor e filtro de PMO

**Base:** `docs/superpowers/specs/2026-09-17-alertas-taxa-aprovacao-design.md` (em produção, lançamento escondido).
**Branch:** `feat/shopfloor-alertas-tipos`. **Migração:** `0115_alertas_tipos.sql` (a 0113 já está no Dev, na demo e vai pro RDS; nada de editar a 0113).

## 1. Decisões (usuário, 18/09)

| # | Decisão |
|---|---|
| 1 | Três tipos de regra: **Taxa de aprovação** (a atual), **Tempo médio por peça** e **Defeito repetido**. |
| 2 | O tipo é escolhido **antes** de abrir o formulário (tela de escolha com os 3 cartões). O tipo não muda depois de criado. |
| 3 | **Tempo médio por peça** = cadência do posto: intervalo médio entre bipes consecutivos do posto na janela. Alerta quando a média fica **acima** do limite. |
| 4 | **Defeito repetido** = o mesmo código de defeito aparece N ou mais vezes (bipes **reprovados**) no posto dentro de uma janela de minutos. **Cada defeito** que passar de N abre a **sua** ocorrência e o seu aviso. Não usa mínimo de bipes. |
| 5 | **Destinatários**: só usuários ativos com `shopfloor.administrar`. |
| 6 | **PMOs**: a regra pode ser associada a **várias PMOs**; nenhuma marcada = todas. A conta considera só bipes das PMOs escolhidas (vale para os 3 tipos). |

## 2. Campos por tipo

| Campo | Taxa de aprovação | Tempo médio por peça | Defeito repetido |
|---|---|---|---|
| Postos | ✓ | ✓ | ✓ |
| Limite | `taxa_minima` (%) | `limite_tempo_seg` (segundos; tela em mm:ss) | `limite_ocorrencias` (N, inteiro ≥ 2) |
| Janela | `tempo` / `bipes` / `op` | `tempo` / `op` | só `tempo` |
| Mínimo de bipes | ✓ | ✓ (mínimo de **intervalos** válidos) | — (nulo) |
| Ignorar pausas acima de | — | `pausa_max_min` (padrão 30, 1–240) | — |
| Lembrete, canais, destinatários, PMOs | ✓ | ✓ | ✓ |

Limites de janela iguais aos atuais: `tempo` ≤ 10080 min; `bipes` com teto de 30 dias; `op` = OP do último bipe do posto, ignorado se o último bipe tem mais de 2 h. Com filtro de PMO, "último bipe do posto" considera só as PMOs da regra.

## 3. Cálculos

- **Taxa de aprovação:** igual à versão atual, + filtro de PMO.
- **Tempo médio por peça:** bipes do posto na janela (qualquer status, só PMOs da regra), ordenados por `data_hora`; intervalos entre bipes consecutivos; descarta intervalos > `pausa_max_min`; média dos restantes (segundos). Precisa de ao menos `minimo_bipes` intervalos válidos para avaliar. **Abaixo** = média > `limite_tempo_seg` (dispara). **Normalizou** = média ≤ limite (com o mínimo).
- **Defeito repetido:** bipes do posto na janela com `lower(status) = 'reprovado'` e código de defeito preenchido, agrupados por código; cada código com contagem ≥ N é "abaixo" (dispara) para aquele código; um código que tinha ocorrência viva e volta a < N na janela normaliza. Descrição do defeito vem do catálogo (`sf_defeitos`) quando existir.

## 4. Dados (0115)

- `alerta_regras` ganha: `tipo text not null default 'aprovacao' check (tipo in ('aprovacao','tempo','defeito'))`, `limite_tempo_seg int`, `limite_ocorrencias int`, `pausa_max_min int`, `pmos text[] not null default '{}'`. `taxa_minima` e `minimo_bipes` passam a aceitar nulo, com `check` por tipo (cada tipo exige os seus campos e proíbe/ignora os dos outros; `janela_tipo` permitido por tipo como na tabela acima). Regras existentes viram `aprovacao`.
- `alerta_ocorrencias` ganha `defeito text` (código; nulo nos outros tipos) e os valores medidos do tipo (`valor_abertura`/`valor_ultimo` genéricos ou colunas específicas — a implementação escolhe e documenta, mantendo as colunas atuais funcionando para `aprovacao`). O índice único de ocorrência viva passa a `(regra_id, posto, coalesce(defeito,''))`.
- `alerta_envios.dados` (jsonb) carrega o que o texto de cada tipo precisa.
- `alerta_destinatarios()` passa a devolver só usuários ativos com `tem_permissao` de `shopfloor.administrar` (avaliado **para o usuário listado**, não para quem chama); o enfileiramento (`alerta_avaliar`, `alerta_resolver_interno`) e a reserva (`alerta_reservar_envios`) passam a exigir a mesma condição.
- `alerta_previa` aceita o tipo e os parâmetros novos.

## 5. Telas

- **Nova regra:** diálogo com 3 cartões (título + uma frase) → formulário do tipo. Editar abre direto o formulário do tipo da regra.
- Formulário mostra só os campos do tipo; "ⓘ" em cada campo de cálculo explicando o que é e como entra na conta (padrão atual).
- Tempo em **mm:ss** na tela (ex.: `2:00`), guardado em segundos.
- **PMOs** no fim do formulário: lista de marcar com busca; texto "Nenhuma marcada = todas as PMOs".
- **Prévia** por tipo: taxa por posto / tempo médio por posto / defeitos acima de N por posto.
- **Lista de regras:** coluna **Tipo**; coluna de limite formatada por tipo ("≥ 90%", "≤ 2:00/peça", "≥ 5 vezes"); coluna PMOs ("Todas" ou a lista).
- **Ocorrências:** mostra o defeito (código + descrição) quando houver e o valor medido formatado por tipo.

## 6. Mensagens

- Tempo: `🔴 {posto} lento: {m:ss} por peça {janela} (limite {m:ss}) · {n} peças` / normalizou `🟢 {posto} normalizou: {m:ss} por peça`.
- Defeito: `🔴 Defeito {código} ({descrição}) repetido no {posto}: {n} vezes {janela} (limite {N})` / normalizou `🟢 Defeito {código} normalizou no {posto}`.
- Lembrete e Resolvido seguem o padrão atual.

## 7. Fora de escopo

Escolher defeitos específicos por regra; janela por bipes para tempo/defeito; resumo por turno.

## 8. Testes

SQL (Docker, runner atual): cálculo do tempo médio (pausa descartada, mínimo de intervalos, filtro PMO), defeito repetido (dois códigos acima de N → duas ocorrências; normalização por código; índice único com defeito), filtro de PMO nos 3 tipos, destinatários só `shopfloor.administrar` (inclusive perda de permissão antes da entrega), migração da regra existente para `aprovacao`, checks por tipo. Vitest: validação por tipo, textos por tipo, formatação mm:ss, formulário por tipo e tela de escolha.
