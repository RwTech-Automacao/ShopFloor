# Ambientes (Dev × Prod) e fluxo de trabalho

Guia dos dois ambientes de banco do ShopFloor e de como uma mudança viaja do
desenvolvimento até a produção. Escrito pra ser lido por quem está começando —
com o "porquê" de cada coisa.

## Os dois ambientes

| | **Prod** (produção) | **Dev** (desenvolvimento) |
|---|---|---|
| O que é | O sistema no ar que as pessoas usam | Um "laboratório" idêntico, só pra testar |
| App | `shopfloor.enterplak.com.br` (Vercel deploya a branch `main`) | `localhost:3000` (o `npm run dev` da máquina) |
| Projeto Supabase (ref) | `ykwkacfviarhfmxeisqk` | `drxmfcrrfzmzjpkvhpjr` |
| Dados | Uso real | Teste (pode zerar à vontade) |
| Fotos (Drive) | pasta `ShopFloor Fotos` | pasta `ShopFloor Fotos Dev/Validacao` |

As credenciais de cada ambiente ficam em arquivos **locais e fora do git**
(`.env.local` = aponta pro Dev no dia a dia; `.env.prod.local` = backup das do
Prod). Nunca vão pro repositório.

## Conceito-chave: **schema × dados**

- **Schema** = a *estrutura* do banco (tabelas, colunas, regras/RLS, funções).
  Vive em **arquivos de migração** (`supabase/migrations/`), versionados no git.
- **Dados** = o *conteúdo* (os processos, os usuários, os ajustes feitos pela
  tela). **Não** vive em migração.

Por isso, quando recriamos o Dev, ele nasce com a **estrutura idêntica** ao Prod
(reaplicando as migrações) mas **vazio de dados**. Ajustes feitos pela interface
(ex.: criar uma regra de criticidade, reordenar colunas) são *dados* — se
quiser que o Dev os tenha, é preciso **copiar** essas tabelas de config
(feito uma vez em 2026-07-20).

## O que é uma migração

Pensa nela como um **"commit" do banco**: um arquivo `.sql` numerado
(`0001`, `0002`, …) que descreve **uma** mudança de estrutura. O banco guarda
numa tabela interna quais já foram aplicadas, então dá pra reconstruir o schema
inteiro do zero só reaplicando os arquivos em ordem.

- **Mudança de estrutura** (nova coluna/tabela/regra) → **sempre um arquivo de
  migração**, aplicado nos **dois** bancos.
- **Operação pontual de dados** (limpar teste, corrigir um valor) → SQL avulso
  (não precisa ser reproduzido num banco novo).

Aplicar as migrações que faltam:
```bash
supabase link --project-ref <ref-do-ambiente>   # aponta o CLI pro banco
supabase db push                                 # aplica as migrações pendentes, em ordem
```

## O ciclo de uma mudança (o fluxo de promoção)

```
1. branch a partir da `main`
2. desenvolvo com o local apontando pro DEV; aplico a migração no DEV; testo
3. você aprova no smoke (no Dev)
4. promovo pro Prod:
   (a) aplico a migração no PROD primeiro   ← "banco antes do código"
   (b) merge da branch na `main` → Vercel deploya o código
```

**Por que o banco primeiro?** Para mudanças **aditivas** (coluna/tabela nova), o
código antigo em produção ignora a coluna nova sem quebrar — então aplicar no
banco antes é seguro. Só se inverte quando a mudança **remove** algo que o código
ainda usa: aí primeiro sobe o código que para de usar, depois remove no banco.

**Duas regras de ouro (pra Dev e Prod nunca divergirem):**
1. Toda mudança de schema é uma **migração** aplicada nos **dois** bancos — nunca
   SQL ad-hoc só num.
2. Só o **schema** precisa bater; os **dados** podem (e devem) diferir.

## Alternar de ambiente (operacional)

- Trabalho normal = **Dev** (`.env.local` e o `supabase link` já apontam pra lá).
- Para mexer no **Prod**: re-linkar (`supabase link --project-ref ykwkacfviarhfmxeisqk`)
  e usar as credenciais do `.env.prod.local`. **Sempre** deixar explícito
  "isto é no PROD" e confirmar antes de qualquer alteração.

## Backup (sem plano Pro)

O Supabase Free **não** tem PITR (recuperação ponto-a-ponto). A rede de segurança
é o **dump manual** — um arquivo `.sql` com todo o conteúdo, tirado **antes** de
qualquer mudança arriscada no Prod:
```bash
supabase db dump --db-url "<conexão-do-prod>" --data-only > backup-prod-AAAA-MM-DD.sql
```
> ⚠️ Risco residual aceito: sem PITR, perda de dado durante o **uso normal** não
> tem "voltar no tempo" automático. Mitigação: tirar dumps periódicos quando o
> dado real começar.

## Reset de ambiente de teste

Ao "limpar o banco" de teste (por SQL):
1. Apagar os transacionais (`processos_recebimento`, `importacoes`,
   `geracoes_etiquetas`, `anexos_processo`, `padroes_importacao`) + reiniciar a
   sequence `processos_numero_seq`.
2. Logs são **imutáveis** — só dá pra apagar desabilitando o trigger no SQL
   Editor (role `postgres`).
3. **Limpar a pasta do Drive** — apagar o registro no banco **não** apaga a foto
   no Drive (só a remoção pela tela apaga). Senão, fotos órfãs se acumulam.
