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
- **Decidido:** só **fotos** (imagens); com opção de tirar na hora pela câmera.
- **Recomendação de tamanho (aguardando confirmação):** limite de ~**5 MB por foto** com
  **compressão automática no navegador** para ~1–1,5 MB / ~1600 px (fotos de celular vêm com
  3–12 MB); limitar a ~**10 fotos por processo**. Motivo: o **free tier do Supabase Storage é
  1 GB** — com compressão dá ~700–1000 fotos; sem compressão estoura rápido. HEIC (iPhone) pode
  precisar de conversão.
- **A confirmar depois:** quem pode anexar/excluir (proposta: anexa quem edita o processo;
  excluir talvez só Supervisor/Admin) e se as fotos somem quando o processo é excluído.

## 2. Navegação entre processos (setas ‹ ›)
Setas para ir do processo atual ao anterior/próximo **sem voltar à lista** (ex.: #179 → #178).
- **Posição:** canto superior direito **ou** inferior direito — ideia do usuário: **na mesma
  linha (reta) do botão Salvar**.
- **A decidir (explicado ao usuário):** ordem da navegação —
  - **(a) Numérica pura:** de #179 → anterior #178 / próximo #180, sempre pela numeração,
    ignorando filtros.
  - **(b) Ordem da lista:** segue o mesmo filtro/ordem (e a aba do mês, item 3) da lista de onde
    veio — "próximo" é o próximo daquela sequência, não necessariamente #180.
  - **Recomendação:** (b), pois combina com o fluxo de conferir os processos "em lote" dentro de
    um mês. Aguardando escolha do usuário.

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

## Ordem sugerida quando começarmos
1. **Grupo do ciclo de vida** (3 → 7 → 5), que se interligam e mudam status/estrutura do form.
2. **Isolados** (4 adicionar processo, 2 navegação, 1 anexos) — a qualquer momento.
3. **6** (Nº EMB) quando for retomado.
