# Ocultar processos incompletos nas Etiquetas — Design

## Objetivo

Na tela de Etiquetas, dar um **toggle "Ocultar incompletos"** que esconde da lista de
resultados os processos que **não podem gerar etiqueta** (inelegíveis), deixando o usuário
focar só nos que geram — sem perder a visão de que há itens escondidos.

## Contexto atual

- A busca principal enche `resultados` (`ProcessoEtiquetaLista[]`).
- `linhasVisiveis = aplicarSubFiltro(resultados, subFiltro, ACESSORES)` — os resultados com o
  **sub-filtro** (chips por coluna) aplicado. Tabela (desktop) e cards (mobile) iteram essa
  mesma lista.
- Cada processo já tem uma **elegibilidade** calculada em `elegibilidades: Map<id,
  {elegivel, motivo}>` via `elegivelParaEtiqueta(processo)`. Inelegível = não gera etiqueta
  (campos incompletos etc.).
- A **seleção** só guarda ids elegíveis; `selecionarTodosElegiveis` já ignora inelegíveis.
- Cabeçalho dos resultados: botões "Selecionar todos (elegíveis)" / "Limpar seleção" + o
  contador "X selecionado(s) de Y visível(is)".

## Decisões (aprovadas)

1. **Toggle "Ocultar incompletos"** no cabeçalho, junto dos botões de seleção. **Desligado por
   padrão** — ao buscar, aparecem todos; o usuário liga quando quiser focar.
2. **Estado durante a sessão:** o toggle fica como o usuário deixou (não reseta a cada nova
   busca). Reload zera (sem persistência entre sessões — fora de escopo).
3. **Contador reflete os ocultos:** quando ligado e havendo ocultos, o texto vira
   **"X selecionado(s) de Y visível(is) · Z incompleto(s) oculto(s)"**. Desligado, continua
   como hoje. Isso evita a impressão de que a busca não achou tudo.
4. **Puramente client-side e visual:** é mais uma camada de filtro em cima do sub-filtro; a
   seleção e a lógica de gerar **não mudam**. Sem servidor, sem migração.
5. **Vale pros dois modos** (tabela e cards) de graça, porque ambos iteram `linhasVisiveis`.

## Arquitetura

- Novo estado `ocultarIncompletos: boolean` (`useState(false)`).
- Renomear o memo atual de `linhasVisiveis` para **`subFiltradas`** (resultados + sub-filtro).
- **`linhasVisiveis`** passa a ser derivado: se `ocultarIncompletos`, é
  `subFiltradas.filter((p) => elegibilidades.get(p.id)?.elegivel)`; senão, é `subFiltradas`.
  (Precisa ficar **depois** de `elegibilidades` na ordem de declaração.)
- **`ocultos = subFiltradas.length − linhasVisiveis.length`** (0 quando o toggle está off).
- **Controle:** um checkbox rotulado "Ocultar incompletos" (nativo, `accent-enterplak`, no
  mesmo estilo dos checkboxes de seleção da tela), no cabeçalho.
- Todo o resto (tabela, cards, sub-filtro, seleção, gerar) continua consumindo
  `linhasVisiveis` sem mudança.

## Interações (por que não conflita)

- **Sub-filtro (chips):** o toggle filtra o conjunto **já** sub-filtrado — compõem
  naturalmente. Os valores dos chips continuam vindo de `resultados` (todos), como hoje.
- **Seleção:** ocultar inelegíveis não remove nada da seleção (ela só tem elegíveis). Ligar/
  desligar o toggle é reversível e não perde estado.
- **Lista vazia:** se ao ocultar não sobrar nenhum elegível, cai no estado vazio já existente
  ("Nenhum processo…"). Aceitável.

## Fora de escopo

- Mudar a regra de elegibilidade (`elegivelParaEtiqueta`).
- Persistir a preferência entre sessões (reload zera).
- Qualquer mudança no servidor / na geração de etiquetas.

## Testes

- **Sem TDD** — é um filtro de apresentação sobre lógica pura já testada (`aplicarSubFiltro`,
  `elegivelParaEtiqueta`). Garantia por tsc + lint + build + smoke.
- **Smoke:** buscar algo com mistura de completos e incompletos → ligar o toggle esconde os
  incompletos (tabela e cards) e o contador mostra "Z incompleto(s) oculto(s)"; desligar volta
  todos; a seleção sobrevive ao liga/desliga; "Gerar" segue usando só os selecionados.
