# Scanner para SPI / NQA / Burn-in — Design

> **Data:** 2026-08-06 · **Módulo:** ShopFloor (Lançamento) · **Branch:** `feat/shopfloor-scanner-spi-nqa-burnin`
> **Tipo:** fluxo do Lançamento + 2 migrações (0075 SPI perfil · 0076 comentário NQA no sf_lancar).

## Contexto
O Lançamento já opera **sem mouse** (scanner/teclado) nos postos de teste/inspeção por defeito (perfil
`inspecao`/`teste`). Faltam **SPI**, **NQA** e **Burn-in**. Cada um tem mecânica própria — este design os traz
pro modo scanner (ou ajusta), mantendo os demais postos intactos.

## Decisões (do usuário)
- **SPI:** funciona **igual aos outros testes** (fluxo scanner: bipa SN→aprova, bipa defeito→reprova com
  código+posição+SN), mas o autocomplete de defeito é uma **lista FIXA no código** (solda): *Falta de solda,
  Insuficiência de solda, Exagero de solda, Curto* (+ o que o usuário mandar). Mantém posição.
- **NQA:** **não** vira scanner — segue Visual+Funcional (status derivado). Só **ganha um campo Comentário
  (texto livre)**, **sempre visível, opcional**.
- **Burn-in:** o seletor **Evento (Entrada/Saída) vem ANTES** do campo de ação. **Entrada** = bipa SN e
  registra (como hoje). **Saída** = fluxo scanner (bipa SN 2×→aprova; bipa defeito→reprova), catálogo geral.

## Design

### SPI → scanner com lista fixa
- **Migração 0075:** `update sf_posto_perfis set reprova='defeitos' where chave='spi'` — assim o backend guarda
  o **código do defeito** (hoje `posicoes` só guarda posição) e o SPI flui pelo mesmo caminho dos outros.
- **Domínio:** lista fixa `DEFEITOS_SPI = ['FALTA DE SOLDA','INSUFICIÊNCIA DE SOLDA','EXAGERO DE SOLDA','CURTO']`
  (em MAIÚSCULAS, padrão do catálogo). Um seletor de defeitos por posto: `defeitosDoPosto(perfil) = perfil.chave==='spi' ? DEFEITOS_SPI : catálogoGeral`.
- **Frontend:** `ehScanner` passa a incluir SPI (após a migração, SPI é `reprova='defeitos'`, então já cai no
  scanner). O **autocomplete do campo de ação** e o **catálogo do ReprovarModal** usam `defeitosDoPosto` — SPI →
  lista fixa; demais → catálogo. `classificarAcao` recebe a lista do posto (SPI reconhece só os defeitos de solda).
- `tipo_defeito` dos defeitos de SPI: como não estão no catálogo, o fallback `'Peça'` já cobre (backend exige
  tipo não-vazio). Mantém posição no ReprovarModal.

### NQA → comentário livre
- **Migração 0076:** `alter table sf_registros add column observacao text not null default ''` + recriar
  `sf_lancar` com `p_observacao text default ''` e gravá-lo no insert. (Recria a função inteira — copiar o corpo
  atual de 0033 e só acrescentar o param + a coluna no insert.)
- **Camada:** `EntradaLancamento += observacao?: string`; `chamarSfLancar`/`SfLancarArgs += p_observacao`;
  `lancar` repassa `entrada.observacao ?? ''`.
- **Frontend:** no bloco NQA, um `Input`/`Textarea` **Comentário** sempre visível (opcional); `onEnviar` do NQA
  passa `observacao`. NQA continua no fluxo antigo (`onEnviar`), não scanner.

### Burn-in → evento antes, saída scanner
- **Sem migração** (Burn-in usa `sf_burnin`, alcançado via `lancar`).
- **Frontend:** o seletor **Evento** (entrada/saída) aparece **antes** do campo de ação e entra na cadeia de
  foco (posto → evento → ação). 
  - **Entrada:** o campo de ação = bipa SN → `lancar(burninEvento='entrada')` direto (sem modal, sem status).
  - **Saída:** o campo de ação vira scanner (`classificarAcao` com o catálogo geral): SN→AprovarModal (2º bipe);
    defeito→ReprovarModal. Ao gravar, `lancar(burninEvento='saida', status, defeitos)`. Mantém o aviso de tempo
    mínimo de Burn-in (que já existe no `onEnviar`) — trazer pro caminho da saída-scanner.

### Onde muda no `lancamento-form.tsx`
- `ehScanner` reescrito: **não-scanner** = NQA (Visual/Funcional). **scanner** = teste/inspeção/SPI por defeito
  **e Burn-in na saída**. Burn-in entrada = caminho próprio (bipa e registra).
- O `defeitos` (catálogo) usado no scanner passa a ser `defeitosDoPosto(perfilDo(posto))`.
- `gravarAprovado`/`gravarReprovado` ganham o `burninEvento` quando o posto é Burn-in (saída).

## Critérios de sucesso
- **SPI:** bipa SN→aprova; bipa/autocompleta um defeito **de solda**→reprova (código+posição+SN); defeito fora da
  lista de solda não é reconhecido como reprova de SPI. Guarda o código no registro.
- **NQA:** Visual+Funcional como hoje + comentário livre gravado (opcional); status derivado inalterado.
- **Burn-in:** escolhe Evento antes; entrada bipa e registra; saída bipa SN→aprova / defeito→reprova, com aviso
  de tempo mínimo mantido.
- Demais postos (inspeção/teste, passagem, Integração, Embalagem) **intactos**. build+lint+test verdes.
  Migrações Dev-first.

## Riscos
- **Recriar `sf_lancar`** (0076) é o ponto mais sensível — copiar o corpo atual exato (0033) e só acrescentar o
  param+coluna; não alterar a lógica. Testar no smoke que os outros postos seguem gravando igual.
- **SPI perfil migration:** muda o comportamento do SPI (posicoes→defeitos) — o SPI antigo (lista de posições)
  deixa de existir; é o que o usuário quer.
- Burn-in saída-scanner + aviso de tempo mínimo: garantir que o aviso (confirm) roda antes de gravar a saída.
- Tela crítica de novo → review + smoke com scanner real.
