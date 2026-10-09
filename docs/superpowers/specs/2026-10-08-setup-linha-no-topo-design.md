# Montar setup: a linha nova entra no topo — desenho

**O pedido.** Na tela de Montar setup, ao acrescentar uma linha ela vai para o fim da lista. O
usuário quer que a **mais recente apareça em primeiro**, para conferir o que acabou de bipar sem
precisar procurar.

## O que eu encontrei, e que muda o desenho

**A lista não está em ordem de inserção hoje — está ordenada por posição, de propósito.**
`carregarSetup` (`src/modules/setup/infra/setup-repository.ts`) faz:

```ts
lista.sort((a, b) => a.posicao.localeCompare(b.posicao, 'pt-BR', { numeric: true })
                  || a.feeder.localeCompare(b.feeder, 'pt-BR', { numeric: true }))
```

O `numeric: true` existe para `"2"` vir antes de `"10"`. A linha nova aparece no fim porque as
posições costumam ser bipadas em ordem crescente, não porque alguém escolheu pôr no fim.

As duas ordens servem a propósitos diferentes: **por posição** é boa para *ler* o setup conferindo
contra a máquina; **mais recente primeiro** é boa para *confirmar o que acabou de digitar*. Por isso
a mudança vale só onde a segunda importa.

### Descoberta 1 — não existe data de criação

`st_setup_itens` (migração `0111`, linhas 69–82) tem `atualizado_em`, e **não** tem `criado_em`.
O `atualizado_em` muda quando o item é **editado**.

O usuário decidiu que **editar não move a linha** — só inserir. Então ordenar por `atualizado_em`
está descartado: editar o feeder de um item antigo o jogaria para o topo.

⇒ **Precisa de uma coluna `criado_em`.** Era uma mudança de tela e passa a ser tela + migração.

Para as linhas que já existem, o backfill usa `atualizado_em`: é a melhor aproximação disponível, e
para item nunca editado os dois valores são iguais.

### Descoberta 2 — a consulta é compartilhada por três telas

`carregarSetupAction` é chamada por **Montar**, **Abastecimento** e **Consultas**. Mudar a
ordenação no repositório mudaria as três.

⇒ **A ordenação nova fica na tela de Montar.** O repositório continua devolvendo por posição, que é
a ordem canônica, e as outras duas telas não mudam nada.

## O desenho

1. **Migração:** `criado_em timestamptz not null default now()` em `public.st_setup_itens`, com
   backfill a partir de `atualizado_em` para as linhas existentes.
2. **Repositório:** `ItemSetup` ganha `criadoEm`, e a consulta passa a trazer a coluna. A ordenação
   por posição **continua** como está.
3. **Tela de Montar:** ordena a lista recebida por `criadoEm` **decrescente** antes de renderizar.
   Empate (dois itens no mesmo instante) desempata por posição, para a lista não embaralhar entre
   duas leituras.
4. **Abastecimento e Consultas:** nada muda.

## O que NÃO muda

- **A ordem no banco.** Nenhuma coluna de ordenação é reescrita; só se acrescenta uma data.
- **Editar não move a linha.** É o ponto da coluna nova. Um item editado fica onde está.
- **Abastecimento e Consultas** continuam por posição. Quem confere o setup contra a máquina
  continua lendo na ordem física.

## Como saber que funcionou

1. Inserir três itens em sequência e ver a lista na ordem **inversa** da inserção.
2. **Editar** o item mais antigo (trocar feeder ou rolo) e confirmar que ele **não** sobe.
   Este é o teste que distingue este desenho do caminho fácil (ordenar por `atualizado_em`).
3. Abrir o **Abastecimento** do mesmo setup e confirmar que lá continua por posição.
4. Item criado antes da migração (com `criado_em` vindo do backfill) aparece junto dos outros, sem
   buraco nem ordem estranha.
5. Dois itens com o mesmo `criado_em` saem sempre na mesma ordem entre duas leituras.

O caso 2 é o que o usuário pediu explicitamente, e o caso 3 é o que garante que a mudança não
vazou para as telas que não deviam mudar.

## Decisões travadas com o usuário (08/10/2026)

1. Mais recente no topo, **só na tela de Montar**.
2. **Só inserir** move a linha. Editar não.
