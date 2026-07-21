# Adicionar Processo em lote (Individual + Coletivo) — Design

## Objetivo

Estender a tela "Adicionar Processo" (`/recebimento/processos/novo`) para permitir criar
**vários processos de uma vez** quando compartilham o mesmo Comercial. Um toggle
**Individual | Coletivo**; no Coletivo, o **Comercial é preenchido uma vez** e o **Material vira
uma tabela de N linhas** — cada linha vira um **processo separado** (mesmo Comercial + material
próprio). Poupa digitação em recebimentos com vários itens/materiais sob a mesma NF/embarque.

## Contexto atual

- `/recebimento/processos/novo`: `page.tsx` (server) carrega os campos do formulário +
  itens de lista e renderiza `NovoProcessoForm`.
- `NovoProcessoForm` mostra os grupos **Comercial** e **Material** como cards (grid de 3 colunas),
  cada campo via `CampoControle`. Ao "Criar processo", chama `criarProcessoManual(payload)` → cria
  **1** processo (status `aberto`, `numero` automático) → redireciona pro detalhe.
- `criarProcessoManual` (server action, gate `editar`): valida obrigatórios
  (`obrigatorioImportacao`), valida listas, converte tipos (`converterValor`), computa os
  **calculados** no servidor (`calcularCamposCalculados` — crítico, atraso, divergência,
  amostral/NQA), insere via `criarProcesso`, loga, revalida.
- Campos vêm de `configuracao_campos` por `grupo`: **Comercial** (11 editáveis) e **Material**
  (3 editáveis hoje: `codigo_material`=Item Recebido, `descricao_material`=Descrição do Material,
  `quantidade_pedido`=Qtd. no Pedido).

## Decisões (aprovadas)

1. **Reuso total do design atual.** Mesmo header/título/cards/grid/`CampoControle`. As únicas
   adições são o toggle, a caixa de quantidade e as linhas — o Comercial e o Material-Individual
   ficam pixel-idênticos porque é o mesmo código.
2. **Toggle Individual | Coletivo** abaixo do título; padrão **Individual**.
3. **Individual = comportamento de hoje, inalterado** (Comercial + Material em cards,
   "Criar processo" → detalhe, via `criarProcessoManual`).
4. **Coletivo:**
   - **Comercial** compartilhado (mesmos campos, preenchido uma vez).
   - **Material como tabela**: colunas = os **campos editáveis do grupo Material** (dinâmico pela
     config — hoje 3), N linhas.
   - **Caixa "Quantidade de processos"** sincronizada com **"+ Adicionar linha"** / remover
     (mexer num ajusta o outro).
   - Botão **"Criar N processos"**.
5. **Cada linha de Material exige ao menos "Item Recebido"** (`codigo_material`); senão avisa e
   não cria.
6. **Cada linha vira 1 processo** = Comercial compartilhado + aquela linha. Os **calculados são
   computados por linha** no servidor (o amostral/NQA, p.ex., depende da quantidade, que é da linha).
7. **Criação atômica** (tudo ou nada): os N processos entram num **único INSERT**.
8. **Após criar:** vai pro **detalhe do 1º processo** (o de menor `numero`).
9. **Sem migração** — usa as tabelas existentes (`processos_recebimento`, `configuracao_campos`).

## Arquitetura

### UI — `NovoProcessoForm`
- Estado de modo: `'individual' | 'coletivo'` (default `individual`). **Toggle** no topo.
- **Individual:** rendering atual (grupos como cards) — nada muda.
- **Coletivo:**
  - **Card Comercial:** só os campos do grupo `comercial` (grid, `CampoControle`), estado
    `comercial: Record<campo, string>`.
  - **Card Material (tabela):** colunas = campos editáveis do grupo `material`. Estado
    `linhas: Record<campo, string>[]`. Cabeçalho com a **caixa de quantidade** (`linhas.length`,
    editável → ajusta o tamanho do array) + **"+ Adicionar linha"**; cada linha com botão remover.
  - Cada célula reusa o **input** do `CampoControle` **sem o rótulo** (o cabeçalho da coluna é o
    rótulo) → adicionar prop **`mostrarRotulo?: boolean`** (default `true`) a `CampoControle`; a
    célula da tabela passa `false`.
  - Botão "Criar N processos" → chama a nova action com `{ comercial, materiais: linhas }`.
- Payload coletivo: `{ comercial: Record<campo, valor>, materiais: Record<campo, valor>[] }`.

### Back-end
- **Extrair** a preparação de valores de `criarProcessoManual` para um helper reutilizável
  **`prepararValoresProcesso(campos, itensPorLista, deps, valores)`** → `{ ok: true, valores } |
  { ok: false, erro }` (validação de obrigatórios + listas + conversão + calculados por linha).
  `criarProcessoManual` passa a usá-lo (comportamento **idêntico** ao de hoje).
- Nova action **`criarProcessosColetivo(comercial, materiais)`** (gate `editar`):
  1. Carrega campos + itensPorLista + deps (criticidade, nqa) **uma vez**.
  2. Valida: `materiais` não-vazio; **cada linha exige `codigo_material` preenchido** (senão erro
     "Linha N: Item Recebido é obrigatório").
  3. Para cada linha: `prepararValoresProcesso(merge(comercial, linha))` → valores completos por
     processo (calculados por linha). **Erro em qualquer linha aborta tudo** (nada é criado).
  4. Insere as N linhas **atomicamente** (novo repo `criarProcessosLote(rows)` →
     `supabase.from('processos_recebimento').insert([...]).select('id, numero')`; o `numero` sai
     sequencial pela sequence).
  5. Loga a criação em lote (**uma** entrada: "N processos criados em lote (#a…#b)").
  6. `revalidatePath('/recebimento/processos')`; retorna o **id do processo de menor `numero`**.
- **Individual** segue em `criarProcessoManual` (agora usando o helper extraído).

### Regras / validação
- **Comercial:** mesmas de hoje (obrigatórios = `obrigatorioImportacao`, listas validadas).
- **Material por linha:** ao menos Item Recebido; demais campos validados/convertidos como hoje.
- **Atomicidade:** 1 INSERT de N linhas; se a preparação de qualquer linha falhar, nada é criado.

## Fora de escopo

- Integração com outros módulos / rastreabilidade (Fase 2).
- Mudar os campos/grupos existentes.
- Importação por planilha (já existe, caminho separado).
- Editar as linhas depois de criado (cada processo é editado no seu detalhe, como hoje).

## Testes

- **Sem migração** e **sem novo domínio puro complexo** — reusa domínios já testados
  (`converterValor`, `calcularCamposCalculados`).
- Opcional: teste unitário do merge Comercial+linha, se virar função pura isolada.
- Garantia por **tsc + lint + build** + **smoke**:
  - **Individual:** cria 1 processo como hoje → detalhe (sem regressão).
  - **Coletivo:** Comercial 1x + 3 linhas → cria **3 processos** (mesmo Comercial, materiais
    distintos, `numero` sequencial) → detalhe do 1º; **linha sem Item Recebido → aviso e não cria**;
    caixa de quantidade ↔ linhas sincronizam (adicionar/remover); calculados (ex.: amostral)
    corretos **por linha**.
