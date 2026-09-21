# Smoke — Alertas: tipos de regra, destinatários do ShopFloor e filtro de PMO

Spec: `docs/superpowers/specs/2026-09-18-alertas-tipos-de-regra-design.md`.
Plano: `docs/superpowers/plans/2026-09-18-alertas-tipos-de-regra.md`.
Base (bots, vínculo, cron): `docs/superpowers/plans/2026-09-17-alertas-smoke.md`.

Pré-requisito: os bots e o vínculo do roteiro de 17/09 já funcionam no ambiente; você está em
`ALERTAS_LIBERADO_PARA` (ou `*`).

## 1. Aplicar a 0115

- [ ] **Dev** (SQL Editor): cole `supabase/migrations/0115_alertas_tipos.sql` inteiro e rode.
- [ ] **Demo** (SQL Editor): o mesmo.
- [ ] **RDS** (só na promoção): rode antes a consulta "quem vai parar de receber?" do README
      (`tools/alertas/README.md` §6b) e depois:
      ```bash
      PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=... user=postgres sslmode=require" \
        -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql
      cd ~/supabase/docker && docker compose restart rest
      ```
- [ ] Conferências do README §6b: regras antigas = `aprovacao`; índice `alerta_ocorrencias_viva_defeito`;
      1 assinatura de `alerta_previa`/`alerta_taxas`/`alerta_listar_ocorrencias`.
- [ ] Suba o app (Preview da branch ou `pm2 restart shopfloor --update-env`).

## 2. Regras antigas continuam iguais

- [ ] A lista de regras mostra as antigas com **Tipo = Taxa de aprovação**, **Limite = ≥ NN%** e
      **PMOs = Todas**.
- [ ] Editar uma antiga abre direto o formulário de taxa (sem os cartões), com os valores de antes.
- [ ] **Avaliar agora** não manda nada novo para regras que estavam estáveis.

## 3. Escolha do tipo

- [ ] **Nova regra** mostra 3 cartões: Taxa de aprovação, Tempo médio por peça, Defeito repetido.
- [ ] Escolher um abre o formulário daquele tipo; **Trocar tipo** volta aos cartões.
- [ ] Cada campo de cálculo tem o **ⓘ** com a explicação (passe o mouse / toque).

## 4. Tempo médio por peça

- [ ] Nova regra de tempo num posto com movimento: limite **0:30** (baixo, para disparar), janela
      últimos 60 min, mínimo de bipes 5, pausas acima de 30 min.
- [ ] Apague o campo **Ignorar pausas acima de**: fica vazio (opcional) e salva normal — nenhuma
      pausa é descartada da média (o almoço entra na conta). Deixe 30 preenchido de novo para o
      resto do roteiro.
- [ ] **Ver prévia** mostra `Posto: m:ss por peça (N intervalos, M peças)`.
- [ ] Salve → a lista mostra **≤ 0:30/peça**.
- [ ] **Avaliar agora** → chega `🔴 {posto} lento: m:ss por peça na última hora (limite 0:30) · N peças`
      + `Regra: ...`, com o botão **Resolvido**.
- [ ] Edite a regra para limite **60:00** → **Avaliar agora** → chega `🟢 {posto} normalizou: m:ss por peça`.
- [ ] Digitar `2:75` no limite → toast embaixo "Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00)."

## 5. Defeito repetido

- [ ] Nova regra de defeito num posto com reprovas recentes: repetições **2**, últimos 60 min.
- [ ] **Ver prévia** lista `Posto: 2040 (Componente Faltando) — N vezes` para cada defeito com 2 ou
      mais (ou "nenhum defeito repetido 2 vezes ou mais").
- [ ] **Avaliar agora** → uma mensagem **por defeito**:
      `🔴 Defeito 2040 (Componente Faltando) repetido no {posto}: N vezes na última hora (limite 2)`.
- [ ] Aba **Ocorrências**: coluna **Defeito** com `2040 (Componente Faltando)`; "Ao abrir"/"Última" em
      `N vezes`.
- [ ] Suba o limite para um número alto (ex.: 99) → **Avaliar agora** → cada defeito manda
      `🟢 Defeito ... normalizou no {posto}`.

## 6. Filtro de PMO

- [ ] Numa regra (qualquer tipo), marque uma PMO na lista (use a busca) → a lista de regras mostra a
      PMO na coluna **PMOs**; nenhuma marcada mostra **Todas**.
- [ ] **Ver prévia** com e sem a PMO marcada num posto que roda mais de uma PMO: os números mudam.

## 7. Destinatários só do ShopFloor

- [ ] A lista de destinatários do formulário só mostra quem tem **administrar** no ShopFloor.
- [ ] Tire o `shopfloor.administrar` do perfil de alguém que é destinatário de uma regra e reabra a
      regra: aparece "N destinatário(s) inativo(s) ou sem permissão de administrar o ShopFloor
      removido(s) da regra — salve para confirmar."
- [ ] Com uma ocorrência aberta, tire a permissão da pessoa **antes** do próximo cron: ela não recebe o
      lembrete/normalizou; apertar **Resolvido** numa mensagem antiga responde "Você não é
      destinatário desta regra." Devolva a permissão no fim.

## 8. Lançamento escondido

- [ ] Com `ALERTAS_LIBERADO_PARA` sem o seu e-mail, a tela continua escondida (igual a 17/09).
