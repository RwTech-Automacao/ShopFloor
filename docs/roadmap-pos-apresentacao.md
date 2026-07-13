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
Permitir anexar arquivos/fotos a um processo.
- **Técnico:** Supabase Storage (bucket) + RLS + upload/download na tela do processo.
- **A decidir:** tipos permitidos (só imagem? PDF?), tamanho máx., quem pode anexar/excluir
  (permissão), se some junto quando o processo é excluído.

## 2. Navegação entre processos (setas ‹ ›)
Setas para ir do processo atual ao anterior/próximo **sem voltar à lista** (ex.: #179 → #178).
- **Posição:** canto superior direito **ou** inferior direito — ideia do usuário: **na mesma
  linha (reta) do botão Salvar**.
- **A decidir:** ordem da navegação — numérica pura (#−1 / #+1, pulando buracos) **ou** seguir a
  ordem/filtro da lista de onde veio.

## 3. Processos em abas/accordion por mês + novo ciclo de status
- **Agrupar por mês** da **data de chegada** (accordion, ex.: "Maio/2026"). Se a data de chegada
  mudar de mês (ex.: para 06/2026), o processo **migra de aba** sozinho.
- **Status:** "Finalizado" passa a ser **"Aprovado" ou "Reprovado"**. O status **"Cancelado"** não
  faz sentido → **remover** (status **e** botão Cancelar).
- **A decidir:** o que define Aprovado vs Reprovado (campo de resultado da qualidade?).
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
- **A decidir:** reprovado também gera? Quais campos são "necessários" para a etiqueta.

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
- **A decidir/desenhar:** onde ficam os grupos **Comercial/Material** (base vinda da
  importação/criação — provavelmente fora dessas duas seções de conferência); como as seções
  independentes interagem com o status Aprovado/Reprovado (item 3).
- **Impacto técnico:** novas colunas `responsavel_recebimento` e `responsavel_qualidade`
  (write-once por seção), remover `responsavel_contagem`, dois saves independentes (uma action por
  seção), reestruturar o `processo-form`.

---

## Ordem sugerida quando começarmos
1. **Grupo do ciclo de vida** (3 → 7 → 5), que se interligam e mudam status/estrutura do form.
2. **Isolados** (4 adicionar processo, 2 navegação, 1 anexos) — a qualquer momento.
3. **6** (Nº EMB) quando for retomado.
