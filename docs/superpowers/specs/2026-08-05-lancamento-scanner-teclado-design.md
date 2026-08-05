# Lançamento scanner+teclado (dinâmica reprovado/aprovado) — Design

> **Data:** 2026-08-05 · **Módulo:** ShopFloor · **Branch:** `feat/shopfloor-lancamento-scanner`
> **Tipo:** redesenho de interação da tela de Lançamento. **Sem migração** (usa faixa da OP + catálogo de defeitos que já existem).

## Objetivo
Operar o Lançamento **só com scanner e teclado — zero mouse** (a bancada terá só scanner + teclado). O status
Aprovado/Reprovado deixa de ser um select clicável: passa a ser **implícito pelo que o operador bipa** no
campo de ação, com um **modal de confirmação por segundo bipe**.

## Escopo
**Dentro:** postos de **teste/inspeção com coleta de defeito** (`perfil.reprova === 'defeitos'`, `temStatus`).
**Fora (mantêm o fluxo atual):** SPI (`reprova === 'posicoes'`), NQA (deriva de visual/funcional), Burn-in
(entrada/saída), Integração e Embalagem (painéis próprios). Integração com a **confirmação de conserto**
(branch `feat/shopfloor-confirma-conserto`) fica para depois.

## Fluxo (foco encadeado, sem mouse)
1. **Entrou na tela** → foco automático no campo **"Bipe o SN para carregar a OP"** (cabeçalho por bipe, que já existe).
2. **Bipa** → resolve a OP pela faixa e carrega o contexto → foco pula para **Colaborador**.
3. Digita o nome → **Enter/Tab** → **Posto** (Select **navegável por teclado**: type-ahead + setas + Enter).
4. **Enter/Tab** → **campo de ação** ("Bipe a peça ou o código do defeito").
5. No **campo de ação**, o valor decide o status (desambiguação):
   - Valor **é um defeito do catálogo** (`sf_defeitos`) → **REPROVADO** (esse é o 1º defeito).
   - senão, valor **está na faixa de SN da OP** → **APROVADO**.
   - senão → erro **"Não reconhecido (nem SN da faixa, nem defeito do catálogo)."**
   O campo aceita **digitar (autocomplete do catálogo) OU bipar** (o scanner "digita" o valor).

### Caminho APROVADO
- Abre **modal de confirmação**: mostra o SN e pede **"Bipe o SN de novo para confirmar"**.
- 2º bipe **igual** → grava **Aprovado** (via `lancar`). 2º bipe **diferente** → erro no modal, pede de novo (não grava). Esc/limpar cancela.
- Após gravar → fecha modal, foco volta ao **campo de ação** (próxima peça); Colaborador e Posto **persistem**.

### Caminho REPROVADO
- Abre **modal de reprova** já com o 1º defeito bipado. No modal:
  - Lista de **defeitos** — cada linha: **código** (autocomplete do catálogo **ou** bipar; o **tipo** vem do catálogo) + **posição** (digitada). **Enter adiciona** outra linha; dá pra bipar **vários**.
  - Campo **"Bipe o SN da peça"**.
- Confirmar (bipar o SN + Enter) → grava **Reprovado** com todos os defeitos (código+posição+tipo). Cancela/Esc aborta.
- Após gravar → fecha modal, foco volta ao campo de ação; Colaborador/Posto persistem.

## Regras/decisões
- **Desambiguação SN×defeito:** casa contra o catálogo de defeitos (código normalizado, igual à busca do catálogo); se casar → reprova. Senão testa `serieDentroDaFaixa` → aprova. SN é numérico na faixa; defeito tem texto → não colidem.
- **Tipo do defeito:** vem do catálogo (o operador não escolhe) — some o select de tipo.
- **Posto:** Select operável por teclado (base-ui já suporta type-ahead/setas/Enter); garantir foco e avanço por Enter/Tab.
- **Persistência:** Colaborador e Posto ficam entre peças (só troca no "Atualizar cabeçalho"/nova OP). O campo de ação limpa a cada peça.
- **Gravação:** reusa `lancar` (status Aprovado/Reprovado + defeitos), sem mudar o backend.

## Fora de escopo / depois
- SPI, NQA, Burn-in, Integração, Embalagem: fluxo atual.
- Integração com confirmação-de-conserto (aprovar peça com reprova anterior) — quando as branches se juntarem.
- Barcodes impressos de defeito/posto: o campo aceita bipar, mas imprimir/gerir as folhas é operação (fora do código).

## Critérios de sucesso
- Dá pra fazer um ciclo completo (carregar OP → colaborador → posto → aprovar OU reprovar) **sem tocar no mouse**.
- Aprovar = 2 bipes do SN (o 2º confirma; divergente barra). Reprovar = bipar defeito(s)+posição + bipar SN.
- Foco encadeia sozinho (SN-OP → colaborador → posto → ação → modal → volta pra ação).
- Postos fora do escopo seguem funcionando igual. Build/lint/test verdes. Sem migração.

## Riscos
- **Foco programático** (encadear + devolver após o modal) é a parte sensível — validar no smoke com scanner real.
- **Select de posto por teclado**: se o base-ui Select não navegar 100% por teclado, cair para um autocomplete de texto (mesmo padrão dos defeitos).
- **Desambiguação**: se algum código de defeito for puramente numérico e cair na faixa, haveria conflito — hoje os códigos têm texto, então não ocorre; validar no smoke.
- É a **tela crítica** (chão de fábrica) — implementar com cuidado e review; manter os postos fora do escopo intactos.
