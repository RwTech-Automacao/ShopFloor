# Alerta de placas paradas antes do Almoxarifado — desenho

Data: 2026-10-29. Branch: `feat/alerta-almox-parado` (da `main` `1f2b76d`). Status: rascunho para revisão do usuário.

## Problema

Uma caixa, um lote ou uma peça que já está **pronta** no posto anterior mas ainda **não deu entrada no
Almoxarifado** está parada na produção. Hoje ninguém é avisado. O usuário quer um alerta no ShopFloor que
notifique quando isso passa de X horas. X inicial: **2 h**; o grupo ainda vai dizer o valor ideal, então o
limite é configurável na regra e a pergunta não bloqueia a entrega.

## Decisões do usuário (29/10/2026)

1. **Um alerta por OP.** A mensagem lista cada caixa, lote ou grupo de peças avulsas parado, com código,
   quantidade de placas e há quanto tempo. O item mais antigo vem em destaque.
2. **Horas de expediente.** Só conta o tempo dentro dos turnos da regra (o editor de turnos que já existe,
   `alerta_regra_intervalos`). Regra sem turno cadastrado conta relógio corrido.
3. **Peças avulsas entram.** OP individual cujo posto anterior não é NQA dá entrada peça a peça; vira uma
   linha "Peças avulsas" com a idade da peça mais antiga.

## O que "parado" significa

Um item está parado quando é **pendência do Almoxarifado** (a definição de `sf_almox_pendencias`, 0158 — caixa
fechada no posto anterior, lote aprovado no NQA individual, ou peça avulsa que cumpriu o gate do posto
anterior) e o tempo de expediente decorrido desde `em` passa do limite da regra. Nada de regra nova de
"pronto": reaproveita o que a tela do Almoxarifado já mostra, para os dois nunca divergirem.

Placas: as quantidades da mensagem são em placas (`pecas`, 0161–0166), como o resto do sistema.

## Componentes

### Banco (migração 0167)

- **Tipo de regra novo** (`parado_almox`), módulo `shopfloor`: entra nos `check` `alerta_regras_tipo_valido` e
  `alerta_regras_modulo_tipo`, como o `emb` entrou na 0150. Campo novo `limite_horas` (numérico, > 0,
  obrigatório só neste tipo, teto de 72 h). Sem postos (a regra olha o Almoxarifado da rota de cada OP), com
  filtro de PMOs como as outras.
- **Cálculo interno sem permissão.** `sf_almox_pendencias()` chama `tem_permissao`, e o cron roda como
  serviço, sem usuário: chamá-la direto devolve `SEM_PERMISSAO`. O cálculo passa para uma função interna
  (`sf_almox_pendencias_base`, sem checagem, sem grant para `authenticated`) e a pública vira casca:
  checa a permissão e delega. A interna também devolve `em_mais_antiga` das peças avulsas (hoje `em` é o
  `max`; o alerta precisa do `min`). O contrato da pública não muda, então a tela do Almoxarifado segue igual.
- **Chave da ocorrência.** A trava atual é uma ocorrência viva por `(regra_id, posto, coalesce(defeito,''))`
  (índice `alerta_ocorrencias_viva_defeito`, 0115). Para uma por OP, a coluna nova `chave text` guarda
  `PMO/OP` e o índice é recriado com `coalesce(chave, '')`. As ocorrências existentes ficam com `chave` nula e
  o comportamento delas não muda. As colunas `pmo`/`op` da ocorrência já existem.
- **`alerta_avaliar`.** A função é um bloco único e foi reescrita inteira a cada tipo novo; a versão vigente é
  a da 0151. A 0167 copia essa versão e acrescenta o ramo do tipo novo, sem tocar nos outros. Entrada nova:
  o app passa `p_parados` (jsonb), na mesma divisão da 0139: **o app faz a conta de horário, o banco
  só decide abrir, atualizar, normalizar e enfileirar.**

### App (TypeScript puro onde der)

- `domain/horas-de-turno.ts`: dado um instante inicial, um instante final e os turnos da regra, devolve os
  minutos de expediente decorridos. Só **segunda a sexta** (é a semana da fábrica e a do cron). Turno vazio =
  relógio corrido. Função pura, testada nas fronteiras (início do turno, fim, almoço, virada de dia, fim de
  semana).
- `domain/parados.ts`: a partir das pendências e da regra, escolhe os itens acima do limite e agrupa por OP.
- `domain/mensagens.ts`: `textoAlertaParado`, `textoNormalizouParado`, no padrão das mensagens existentes,
  com corte para o limite do Discord (`cortarUtf16`) e a lista de itens com `listaComCorte`.
- `domain/regra.ts` e `ui/regra-form.tsx`: o tipo aparece no formulário com os campos "Limite (horas)", turnos e
  PMOs; a lista mostra a frase própria na coluna "Limite" ("Parado há mais de 2 h de expediente").
- `application/enviar-alertas.ts` / `infra/regras-repository.ts`: no ciclo do cron, para cada regra do tipo,
  lê as pendências pela função interna, calcula as horas de turno e entrega `p_parados` ao `alerta_avaliar`.

## Ocorrência e mensagem

- **Abre** quando a OP tem pelo menos um item acima do limite. A mensagem lista os itens acima do limite,
  mais antigo primeiro.
- **Item novo** que cruza o limite depois entra na mesma ocorrência e **não** gera mensagem sozinho; quem
  repete o aviso é o lembrete da regra (se configurado), já com a lista atualizada. É o mesmo comportamento
  das outras regras.
- **Normaliza sozinha**, com o aviso "normalizou", quando nenhum item da OP passa do limite.
- **Resolver, reabertura, responsáveis e canais**: tudo como nas regras atuais.
- Exemplo de mensagem:
  `⚠️ Almoxarifado: OP 8563 / PRT797 com 2 itens parados`
  `• CX[3][500] · 500 placas · 3 h 10 min de expediente`
  `• CX[4][500] · 500 placas · 2 h 05 min de expediente`
  Lote: código do lote. Peças avulsas: `Peças avulsas · 37 peças · a mais antiga há 3 h`.

## Erros e bordas

- Banco indisponível: o `avaliar` já responde 503 e o cron registra; nada novo.
- OP finalizada ou sem posto Almoxarifado na rota: não entra (já é assim em `sf_almox_pendencias`).
- Posto Almoxarifado criado depois da OP: a regra só vê o que a rota tem; não inventa pendência.
- Piso de segurança como o do fim de EMB: a regra só enxerga pendências a partir de `criado_em` da regra,
  para não disparar uma avalanche histórica no primeiro ciclo; e há um teto de ocorrências por rodada.
  (A decisão do número exato do teto fica para o plano.)

## Testes

- Unidade: horas de turno (fronteiras, almoço, fim de semana, sem turno), seleção e agrupamento, mensagens
  (corte em 2000, lista longa, as três espécies de item).
- SQL (harness `supabase/tests/`, Postgres descartável, cada migração duas vezes): pendência base sem
  permissão; `em_mais_antiga` das avulsas; abrir, atualizar e normalizar a ocorrência por OP; a trava
  `chave`; compatibilidade das ocorrências antigas com o índice novo.
- **Medição antes de pedir deploy**, numa OP grande e nova (sem estatística), pelo mesmo motivo do incidente de
  22/10: a consulta roda a cada 5 minutos sobre todas as OPs ativas.

## Deploy (ordem)

Migração 0167 no RDS **antes** do app (o app novo manda tipo e `p_parados` que o banco velho recusa);
`restart rest`; depois o app. O app antigo roda com o banco novo (coluna e parâmetro aditivos). Nada sobe sem
o aval do usuário. Compels continua desligado e não é afetado.

## Fora do escopo

- Mudar a tela de Lançamento ou a do Almoxarifado.
- Alerta por posto intermediário (só o Almoxarifado, como pedido).
- Cadastro do limite por OP ou por cliente: o limite é da regra.

## Pontos a confirmar no plano

- Valor do limite: 2 h até o grupo responder.
- Semana: contar só segunda a sexta (assumido pela semana da fábrica e do cron); a função de turnos não tem
  hoje noção de dia da semana, então isso é lógica nova.
- Número do teto de ocorrências por rodada e do teto de itens listados na mensagem.
