# Clique fantasma nas listas de seleção (touch) — design

**Card:** Corrigir bug em /configuracoes/setup-estrutura — Sprint 23/09/2026 [1h]
**Data:** 23/09/2026
**Alcance real:** todas as telas que usam `Select`, não só a da estrutura.

## O que acontece

Relato: em `/configuracoes/setup-estrutura`, no mini PC Windows com tela de toque, tocar
num item da lista de PMO **abria a janela do Windows para escolher arquivo**. No PC Linux
com mouse não reproduz.

Duas observações do usuário fecham o diagnóstico:

1. **A lista continuava visível** na tela quando a janela de arquivo abriu.
2. **A PMO selecionada mudou** para a que ele tocou.

Ou seja: **um gesto, dois efeitos**. O item foi selecionado normalmente **e** o mesmo toque
também acionou o campo de arquivo que estava atrás da lista.

É o "clique fantasma" do toque: o navegador dispara o evento `click` alguns
milissegundos depois de o dedo sair da tela e **refaz a conta de qual elemento está
naquele ponto**. A lista já tratou a seleção; o clique atrasado encontra o que está atrás e
aciona também. No caso, o `<input type="file">` do card "Importar composição do ERP"
(`estrutura-tela.tsx`), que nasce exatamente na faixa coberta pela lista.

Por que não reproduz com mouse: com mouse não existe esse `click` sintetizado depois do
gesto. É um comportamento de **ponteiro de toque**, não um erro de lógica da tela.

## Por que a correção NÃO é mover o campo de arquivo

Foi a primeira ideia e ela não se sustenta. A lista de seleção do projeto é configurada
com `alignItemWithTrigger` (abre **por cima** do próprio campo, alinhada ao item
selecionado) e `max-h-(--available-height)` — altura máxima igual à **altura disponível da
tela** (`select.tsx`, `SelectContent`).

Com muitas PMOs, a lista cobre quase a tela inteira. Não existe posição "fora da faixa da
lista": mudar a geometria só troca qual elemento vai receber o clique perdido.

## Desenho da correção

**Quando uma lista de seleção fecha, engolir UM clique que chegue nos ~350 ms seguintes
fora da própria lista — e só em telas de toque.**

Nenhum clique legítimo acontece nessa janela: o dedo acabou de sair da tela. O clique
fantasma, sim, chega exatamente aí.

### Regras

- **Só com ponteiro grosso** (`matchMedia('(pointer: coarse)')`). No desktop com mouse,
  comportamento idêntico ao de hoje — nada muda, nem para o gestor, nem para o dev.
- **Um clique só** por fechamento. Depois disso a proteção se desarma, mesmo dentro dos
  350 ms.
- **Não engole clique dentro da própria lista nem no campo que a abre**
  (`[data-slot="select-content"]` e `[data-slot="select-trigger"]`): esses são cliques
  legítimos, inclusive o de reabrir a lista.
- Intercepta na **fase de captura** do `document` e cancela o evento (`stopPropagation` +
  `preventDefault`), que é o que impede a ativação do rótulo/campo de arquivo.
- A proteção se desarma sozinha ao fim da janela, mesmo que nenhum clique chegue.

### Onde mexe

- **Arquivo novo** `src/shared/lib/clique-fantasma.ts` — uma função só, sem estado global
  além do próprio listener, testável isoladamente:
  `blindarCliqueFantasma(janelaMs = 350): void`.
- `src/components/ui/select.tsx` — hoje `Select` é um repasse direto
  (`const Select = SelectPrimitive.Root`, linha 9). Passa a ser um componente que envolve
  esse repasse e chama `blindarCliqueFantasma()` quando a lista fecha, **sempre repassando
  o `onOpenChange` de quem usa** (nenhuma tela pode perder o callback que já tinha).
  A assinatura de `onOpenChange` deve ser conferida no tipo do Base UI instalado, não
  assumida.

Nenhuma tela é alterada. Nenhuma migração. Nada no servidor.

## O que NÃO muda

- O comportamento no desktop com mouse, em nenhuma tela.
- A aparência, a posição e a animação das listas.
- A tela `/configuracoes/setup-estrutura`: o card de importação continua aparecendo
  quando uma PMO é escolhida, no mesmo lugar. O que deixa de acontecer é ele ser
  **acionado sem querer**.

## Testes

**Automatizados** (jsdom, `matchMedia` simulado como ponteiro grosso):

1. Em ponteiro grosso, o primeiro clique depois de fechar é cancelado
   (`defaultPrevented === true`).
2. O **segundo** clique na mesma janela de tempo passa normalmente.
3. Clique dentro de `[data-slot="select-content"]` ou `[data-slot="select-trigger"]` passa
   normalmente.
4. Passada a janela de tempo, o clique passa normalmente.
5. Em ponteiro fino (mouse), nenhum clique é cancelado.
6. Um `onOpenChange` passado por quem usa o `Select` continua sendo chamado, com os mesmos
   argumentos.

**Manual, e sem substituto** — no mini PC Windows com toque, em
`/configuracoes/setup-estrutura`: tocar num item da lista que esteja na mesma altura do
campo "Procurar… Nenhum arquivo selecionado" e confirmar que a **PMO muda** e a **janela de
arquivo não abre**. O clique fantasma é do navegador em toque real; jsdom não o reproduz,
e o PC Linux do dev também não.

## Riscos

- **Engolir um clique legítimo.** Só aconteceria se alguém fechasse a lista e acertasse
  outro elemento em menos de 350 ms — no toque, praticamente impossível. Mitigado por
  limitar a um clique e por não valer no desktop.
- **Confiar numa janela de tempo.** 350 ms é a faixa usual do `click` sintetizado no
  toque; se algum aparelho demorar mais, o fantasma escapa. Se acontecer, o ajuste é o
  número, não o desenho.
- **Validação depende do equipamento.** Sem o teste no aparelho com toque, a correção
  fica "provavelmente certa" — e foi exatamente assim que o bug passou despercebido até
  aparecer numa reunião.

## Fora de escopo

- Redesenhar a tela da estrutura ou mover o card de importação.
- Trocar a configuração de posicionamento das listas (`alignItemWithTrigger`).
- Aplicar a mesma proteção a outros componentes que abrem camadas (diálogos, popovers):
  não há relato, e o `Dialog` tem barreira própria. Se aparecer, a mesma função serve.
