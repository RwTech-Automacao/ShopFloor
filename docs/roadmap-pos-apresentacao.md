# Roadmap — alterações pós-apresentação

> Levantado pelo usuário **antes** da apresentação para a equipe (a implementar **depois**).
> Cada item grande terá seu próprio ciclo brainstorm → spec → plano quando iniciado.
> Nada aqui está implementado ainda.

## Visão geral e interdependências
- **Itens 3, 5 e 7** mexem no **ciclo de vida do processo** e/ou na **estrutura do formulário** —
  devem ser desenhados **juntos / em ordem** (não isolados).
- **Item 6** está **parado** (só mapeado, discutir depois).
- **Itens 1, 2, 4** são relativamente **isolados**.

---

## 1. Anexo de mídia ao final de cada processo
Permitir anexar **fotos** a um processo — tanto **enviar imagem salva** quanto **abrir a câmera
para tirar na hora** (`input` com `accept="image/*" capture="environment"` abre a câmera no
celular).
- **Técnico:** Supabase Storage (bucket) + RLS + upload/download na tela do processo. Compressão
  no cliente antes do upload.
- **Decidido:** só **fotos** (imagens); com opção de tirar na hora pela câmera; **compressão no
  cliente para ~500 KB** antes do upload.
- **Estratégia de armazenamento (ideia do usuário):** o Supabase Storage é só um **buffer
  temporário**. **1× por mês**, exportar as fotos para um **Drive** (externo) e **limpar** o
  bucket do Supabase — assim o storage nunca enche (a 500 KB, 1 GB ≈ ~2000 fotos, e a limpeza
  mensal renova). Na exportação, as fotos são **renomeadas** com campos do processo que façam
  sentido no nome.
  - **Renomear no momento da EXPORTAÇÃO**, a partir dos **valores atuais** do processo (o nome
    reflete os dados corretos mesmo que tenham mudado depois do upload). Várias fotos do mesmo
    processo ganham sufixo (`_1`, `_2`).
  - **A decidir:** quais campos entram no nome (ex.: número, Nº NF, Item Recebido, Fornecedor,
    data de chegada?); e o **mecanismo de exportação**:
    - **v1 (simples):** botão admin "Exportar fotos do mês" → baixa um **.ZIP** com as fotos já
      renomeadas (você sobe no Drive manualmente) → depois "Limpar fotos do período".
    - **v2 (futura):** integração automática com Google Drive (agenda mensal) — mais complexo
      (API/OAuth ou service account).
- **A confirmar depois:** quem pode anexar/excluir foto individual (proposta: anexa quem edita o
  processo; excluir só Supervisor/Admin).

## 2. Navegação entre processos (setas ‹ ›)
Setas para ir do processo atual ao anterior/próximo **sem voltar à lista** (ex.: #179 → #178).
- **Posição:** canto superior direito **ou** inferior direito — ideia do usuário: **na mesma
  linha (reta) do botão Salvar**.
- **A decidir (explicado ao usuário):** ordem da navegação —
  - **(a) Numérica pura:** de #179 → anterior #178 / próximo #180, sempre pela numeração,
    ignorando filtros.
  - **(b) Ordem da lista:** segue o mesmo filtro/ordem (e a aba do mês, item 3) da lista de onde
    veio — "próximo" é o próximo daquela sequência, não necessariamente #180.
  - **Decidido: (b)** — segue a ordem/filtro/aba-do-mês da lista de onde veio.

## 3. Processos em abas/accordion por mês + novo ciclo de status
- **Agrupar por mês** da **data de chegada** (accordion, ex.: "Maio/2026"). Se a data de chegada
  mudar de mês (ex.: para 06/2026), o processo **migra de aba** sozinho.
- **Status:** "Finalizado" passa a ser **"Aprovado" ou "Reprovado"**. O status **"Cancelado"** não
  faz sentido → **remover** (status **e** botão Cancelar).
- **Decidido:** Aprovado vs Reprovado é definido pelo **campo de resultado da qualidade**.
- **Impacto técnico:** migração (constraint de status na tabela), máquina de estados
  (`ciclo-vida`), RLS de finalização, telas de processo e de lista. **Cruza com itens 5 e 7.**

## 4. Botão "Adicionar processo" (criação manual)
Criar um processo **sem** importar planilha — botão **"Adicionar processo"** no **canto superior
direito** da tela de Processos.
- **Técnico:** formulário de criação (reaproveitar o form dinâmico) + Server Action de insert +
  permissão.
- **A decidir:** quais campos são obrigatórios na criação manual.

## 5. Gate de geração de etiqueta por status + completude
Só permitir **gerar etiqueta** quando o processo estiver **Aprovado** (ou **também Reprovado?** —
confirmar) **E** tiver **todas as informações necessárias** para a etiqueta.
- Hoje **não há trava** de status (decisão anterior de deixar em aberto). **Cruza com item 3**
  (novos status).
- **Decidido:** **Reprovado também gera** etiqueta (Aprovado ou Reprovado). Os campos
  "necessários" = os usados na **composição da etiqueta** (usuário confirmará a lista exata; ver
  `gerarEtiquetasDoProcesso` / regras do Part Number).

## 6. [PARADO] Nº EMB pelos 8 primeiros caracteres do nome da planilha
Na **importação**, o campo **"Nº EMB"** seria preenchido pelos **8 primeiros caracteres do nome
do arquivo** da planilha.
- **Status:** só **mapeado**; o usuário pediu para **deixar de lado por enquanto** (será mais
  discutido).

## 7. Separar Recebimento × Qualidade em seções independentes (o mais complexo)
Transformar Recebimento e Qualidade em **duas seções independentes** — **uma não depende da outra**
para ser preenchida.
- **"Part Number recebido"** passa para a **seção Qualidade** (pode ser o **primeiro item** dela).
- **Cada seção** tem seu **próprio botão Salvar** (ao final da seção).
- **Cada seção** tem um **responsável**, preenchido automaticamente pelo **usuário que apertou o
  Salvar daquela seção**: **"responsável recebimento"** e **"responsável qualidade"**.
- **Remover** o campo **"responsável contagem"** atual **e** o **botão Salvar único** atual.
- **Decidido:** os grupos **Comercial/Material ficam como estão** (grupos base, **fora** das duas
  seções independentes de conferência). Ainda a desenhar: como as seções interagem com o status
  Aprovado/Reprovado (item 3).
- **Impacto técnico:** novas colunas `responsavel_recebimento` e `responsavel_qualidade`
  (write-once por seção), remover `responsavel_contagem`, dois saves independentes (uma action por
  seção), reestruturar o `processo-form`.

---

## Plano de execução acordado (estado atual)

**Pré-requisito:** montar o **ambiente Dev** (2º projeto Supabase) **antes** das features que
mexem no banco (#3, #4, #7, #1) — para não rodar migração/testes em produção. O **#2 não
precisa** (só leitura).

**Prontas para começar já:**
- **#2 Setas de navegação** — especificada (ordem = da lista), isolada, sem banco. Fazer numa
  **branch** (não tocar `main`/produção durante a apresentação).

**Aguardando conversa com o pessoal / mais definições:**
- **#3 abas/mês + status, #5 etiqueta, #7 seções** — o #3 muda o **fluxo de status**
  (Aprovado/Reprovado, remove Cancelado), decisão que a **equipe** deve validar; e os três se
  **entrelaçam** (tocam os mesmos arquivos → desenhar juntos, na ordem **3 → 7 → 5**, para evitar
  retrabalho e conflito).
- **#4 Adicionar processo** — melhor **depois do #7** (o formulário será reestruturado).
- **#1 Fotos** — falta o usuário fechar a spec (campos do nome, mecanismo de export v1 ZIP).
- **#6 Nº EMB** — parado.

**Decisão sobre paralelismo:** NÃO iniciar tudo junto — hoje só a #2 está madura; as demais estão
bloqueadas (interligação, input da equipe, spec pendente). Paralelizar (subagentes) só o que for
de fato independente, conforme desbloquear.

**Sequência combinada:** (1) ambiente Dev + **#2** (eu); (2) usuário fecha spec da foto e alinha
3/5/7 com o pessoal; (3) atacar cada frente conforme desbloqueia.
**Status:** usuário vai **terminar de explicar/definir depois**. Nada iniciado ainda.

## Fluxo de trabalho acordado (Dev × Prod)
- **1 repositório** GitHub (ambientes diferem só por env vars, não por código).
- Mudança de **código** → branch → testa local (no **Dev**) → merge na `main` → Vercel deploya.
- Mudança de **estrutura do banco** → **migration** → aplica no **Dev** (testa) → aplica no
  **Prod** (`supabase db push`) **antes** de mesclar → merge. (Merge NÃO aplica migração sozinho.)
- Mudança de **configuração/dados** (usuários, listas, campos, NQA, criticidade) → pelas **telas
  de Admin**, sem migração.
