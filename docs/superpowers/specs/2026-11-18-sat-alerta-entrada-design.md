# SAT — aviso de entrada como regra dos Alertas

Data: 18/11/2026 · Branch: `feat/sat-alerta-entrada` · Aprovado pelo usuário em 18/11.

## Problema

Hoje cada NF registrada no SAT (e cada correção/troca de NF) manda um aviso direto no canal geral do Discord
(`SAT_DISCORD_CANAL_ID`, senão `DISCORD_CANAL_ID`), para todo mundo, sem configuração. O usuário quer o mesmo aviso
("toda entrada, como hoje"), mas configurável e só para quem precisa.

## Decisões

1. **Tipo de regra novo nos Alertas: `sat_entrada` ("Entrada no SAT")**, do módulo novo de alerta `sat`, no molde do
   fim de EMB do Recebimento (`docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md`): mesma tabela de
   regras (`alerta_regras.modulo = 'sat'`), mesmos destinatários (pessoas por Discord/Telegram/e-mail ou um canal do
   Discord), mesma fila (`alerta_ocorrencias`/`alerta_envios`), mesmo cron de envio e botão de testar.
2. **Tela SAT → Alertas** (`/sat/alertas`, item no acordeão do SAT), o MESMO componente das telas de Alertas do
   ShopFloor e do Recebimento; permissão `sat.administrar` (no menu e no banco).
3. **Dispara** a cada NF registrada (um aviso por nota: empresa, CNPJ, NF, situação e motivos, números de série) e a
   cada correção ou troca de NF — os mesmos textos de hoje (`mensagemNota`, `mensagemMudancaNf`).
4. **Só os destinatários das regras ativas recebem.** Sem regra ativa, ninguém recebe.
5. **Sai o aviso direto** no canal geral (`avisarSat`, `SAT_DISCORD_CANAL_ID`).
6. A gravação nunca depende do aviso: falhar ao enfileirar não desfaz a entrada.
7. Trava de liberação no molde do Recebimento: `ALERTAS_SAT_LIBERADO_PARA` (vazia/ausente = tela fechada em produção,
   como `ALERTAS_RECEBIMENTO_LIBERADO_PARA`), se o padrão do módulo de Alertas exigir.

## Banco (migração nova, número livre seguinte)

- `alerta_regras`: aceitar `modulo = 'sat'` e o tipo `sat_entrada` (atualizar o check `alerta_regras_modulo_tipo` e
  qualquer check de `tipo`/`modulo` nas tabelas de ocorrências/envios).
- Função security definer que enfileira um aviso de SAT para cada regra ativa `sat_entrada` (ocorrência + envios
  aos destinatários), chamada pelas funções do SAT (`sat_registrar_nf`, `sat_corrigir_nf`, `sat_trocar_nf`) **ou**
  pela action depois de gravar — escolher o que o módulo de Alertas já faz para avisos por evento (o fim de EMB).
- RLS e permissões no padrão `(select tem_permissao('sat','administrar'))` para ler/gravar regras do módulo `sat`.

## Testes

SQL (harness): regra `sat_entrada` aceita só no módulo `sat`; registrar/corrigir/trocar NF com regra ativa gera um
aviso por nota para cada destinatário; sem regra, nenhum; regra desativada, nenhum; reaplicar a migração não muda nada.
TS: o módulo `sat` e o tipo `sat_entrada` na cobertura de `modulo.test.ts`; a tela `/sat/alertas` com
`sat.administrar`; as actions do SAT não chamam mais o Discord direto; o texto do aviso igual ao de hoje.
