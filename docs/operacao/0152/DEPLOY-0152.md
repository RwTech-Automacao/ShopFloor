# Deploy da 0152 — Dashboard de divergências do Recebimento

Produção está na **0148**. Este deploy leva a migração **0152** (`supabase/migrations/0152_rec_dashboard.sql`)
e o app da main com a tela **Recebimento › Dashboard**.

Tudo roda **na instância Lightsail**, no terminal, **um comando por vez, colado como está**. Nenhum comando
tem coisa para trocar. A senha do banco é **digitada** no prompt `Password:` do `-W` (nunca em comando,
nunca no chat). Se o terminal cair no meio, volte ao **passo 2** (a variável `HOST` some junto com o terminal).

Os arquivos de apoio ficam no repositório em `docs/operacao/0152/`:

| arquivo | o que faz | grava? |
|---|---|---|
| `01-conferir-antes.sql` | conta o que a 0152 vai encontrar | **não** (sessão somente leitura) |
| `02-copiar-linhas-do-update.sql` | guarda as linhas que o UPDATE da 0152 muda em `public.processos_recebimento_bkp_0152` | sim (tabela nova, fechada para o app) |
| `03-rollback-0152.sql` | desfaz a 0152 — **só** se algo der errado | sim |

---

## Passo 1 — anotar o commit que está no ar e baixar a main

Guarda o commit atual (é para onde o app volta se algo der errado) e busca a main **sem** mexer no código
do disco (o `git pull` aqui faria o `deploy.sh` pular o build):

```bash
cd ~/ShopFloor && git rev-parse HEAD > ~/antes-0152.txt && cat ~/antes-0152.txt && git fetch origin main
```

**Olhar:** aparece um hash (o commit em produção hoje) e o fetch termina sem erro.

## Passo 2 — extrair os arquivos e pegar o host do banco

```bash
cd ~/ShopFloor && git show origin/main:supabase/migrations/0152_rec_dashboard.sql > /tmp/0152.sql && git show origin/main:docs/operacao/0152/01-conferir-antes.sql > /tmp/0152-01.sql && git show origin/main:docs/operacao/0152/02-copiar-linhas-do-update.sql > /tmp/0152-02.sql && git show origin/main:docs/operacao/0152/03-rollback-0152.sql > /tmp/0152-03.sql && wc -l /tmp/0152*.sql
```

```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && echo "HOST ok"
```

**Olhar:** os quatro arquivos com número de linhas (nenhum com 0) e `HOST ok`.

## Passo 3 — conferir antes (somente leitura)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/0152-01.sql
```

**Olhar** (cada bloco começa com `== N.` explicando o número):

- **Bloco 6:** os quatro `tem_*` têm que ser `t`. Se algum for `f`, **PARE** — a 0152 não aplica.
  Os `ja_tem_*` normalmente são `f` (se forem `t`, a 0152 ou o passo 4 já rodaram antes; não impede).
- **Bloco 5, `linhas_que_o_update_muda`:** **anote este número** — é quantas justificativas só-de-espaços
  a 0152 vai deixar vazias. `destas_que_viram_pendente_no_dashboard` são as que passam a contar como
  "sem justificativa" (a tela de Processos já as mostrava como pendentes).
- Blocos 1 a 4 são informação (total de processos, fornecedores com branco nas pontas, datas sujas,
  justificativas só de tab/quebra de linha que a 0152 **não** mexe).

## Passo 4 — copiar as linhas que o UPDATE vai mudar

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/0152-02.sql
```

**Olhar:** `total_na_copia` **igual** ao `linhas_que_o_update_muda` do passo 3. Rodar de novo é seguro
(copia 0 e não sobrescreve a primeira cópia). Se der `ERROR`, nada foi gravado: **não siga** para o passo 5.

## Passo 5 — aplicar a 0152 ⚠️ (o passo que só se desfaz com o rollback)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/0152.sql
```

**Olhar:** `CREATE FUNCTION` ×4, **`UPDATE N`** (N = o número anotado no passo 3), `REVOKE` ×4, `GRANT` ×4,
`NOTIFY`. Se aparecer `ERROR`, a transação inteira voltou (`-1`): nada mudou, pare e mande o erro.

> **Este é o passo irreversível sem o `03-rollback-0152.sql`.** As funções novas se apagam a qualquer
> momento, mas o UPDATE troca o texto das justificativas só-de-espaços por `''`, e o texto original só
> volta pela cópia do passo 4 (lida pelo rollback).

Conferir na hora (tem que dar `t | t | t | t | 0`):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select to_regprocedure('public.rec_dashboard(text,text,text,text,date,date,text)') is not null as dashboard, to_regprocedure('public.rec_dashboard_opcoes()') is not null as opcoes, to_regprocedure('public.rec_norm_texto(text)') is not null as norm_texto, (select position('btrim(p_texto)' in prosrc) > 0 from pg_proc where oid = 'public.rec_justificar_divergencia(uuid,text)'::regprocedure) as justificar_apara, (select count(*) from public.processos_recebimento where divergencia_justificativa <> '' and btrim(divergencia_justificativa) = '') as so_espacos_restantes;"
```

## Passo 6 — reiniciar o PostgREST (obrigatório, depois da migração)

```bash
cd ~/supabase/docker && docker compose restart rest
```

**Olhar:** `Container ... rest ... Started`.

## Passo 7 — deploy do app

```bash
cd ~/ShopFloor && ./deploy/aws/deploy.sh
```

**Olhar:** termina com `==> deploy OK -> 4938eb0` (ou um commit mais novo da main).

Se aparecer **`Nada novo na main. Deploy não necessário.`**, alguém deu `git pull` antes e o script pulou
o build — o app velho continua no ar. Rode o build e o restart à mão:

```bash
cd ~/ShopFloor && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```

---

## Verificação em produção (depois do passo 7)

Logado com um usuário que tem `recebimento.visualizar` (para o item 4, também `recebimento.administrar`):

- [ ] **1. Menu:** no grupo Recebimento aparece o item **Dashboard**.
- [ ] **2. Página:** `https://shopfloor.enterplak.com.br/recebimento/dashboard` abre com os cartões
      (Itens · Com divergência · Sem justificativa · Positivas/Negativas · EMBs), o top 10 de
      fornecedores e o gráfico semanal — **sem** o aviso de erro no lugar dos números.
- [ ] **3. Um número contra a grade:** abra `https://shopfloor.enterplak.com.br/recebimento/dashboard?periodo=tudo`
      e anote **Com divergência**. Em **Processos**, sem nenhum filtro de coluna, clique no filtro rápido
      **Todas Divergências**: o rodapé `Mostrando 1–… de TOTAL` tem que dar o mesmo número. (Opcional: **Sem
      justificativa** contra **Divergências Não Resolvidas** — só pode diferir pelas justificativas só de
      tab/quebra de linha do bloco 4 do passo 3, normalmente zero.)
- [ ] **4. A justificativa continua funcionando:** em Processos › **Divergências Não Resolvidas**, abra a
      justificativa de um processo de teste (ou um sem justificativa), escreva `teste deploy 0152` e salve:
      o selo muda para resolvida. Abra de novo, apague o texto e digite **só espaços**, salve: volta a
      **não resolvida**. Confirme no banco que ficou vazio (a última justificativa gravada tem que mostrar
      `''` e o seu nome):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select numero, quote_literal(divergencia_justificativa) as justificativa, divergencia_justificada_por_nome, divergencia_justificada_em from public.processos_recebimento order by divergencia_justificada_em desc nulls last limit 1;"
```

  (O diálogo já apara o texto antes de mandar; quem garante que uma chamada direta só-de-espaços também
  fica vazia é a função nova — o `justificar_apara = t` do passo 5.)

Se tudo passou, a cópia pode ser apagada **depois** (dias, não agora):
`PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "drop table if exists public.processos_recebimento_bkp_0152;"`

---

## Se algo der errado

**Antes do passo 5:** nada mudou no que o app usa. O passo 4 só criou a tabela de cópia; pode ficar.

**Durante o passo 5 com `ERROR`:** a transação voltou inteira. Nada a desfazer.

**Depois do passo 5** (dashboard quebrado, justificativa falhando, número estranho), **nesta ordem**:

**1. Primeiro o app volta** para o commit anotado no passo 1 (senão o menu e a página continuam
chamando funções que o rollback apaga):

```bash
cd ~/ShopFloor && git reset --hard $(cat ~/antes-0152.txt) && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```

**Olhar:** o build termina e o `pm2` reinicia; o item **Dashboard** some do menu. (O próximo `deploy.sh`
volta para a main normalmente: o `git pull` avança de novo.)

**2. Depois o banco** (precisa do `HOST` do passo 2 e de `/tmp/0152-03.sql`):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/0152-03.sql
```

**Olhar:** `CREATE FUNCTION`, `REVOKE`, `GRANT`, a linha `NOTICE: b) linhas na cópia: X, justificativas
devolvidas agora: Y, deixadas como estão ...: Z`, `DROP FUNCTION` ×3, `NOTIFY`, `COMMIT`. Os avisos
`there is already a transaction in progress` / `there is no transaction in progress` são esperados (o
arquivo tem `begin/commit` e o `-1` também). `Z` maior que zero = justificativas que alguém refez depois da
0152 — essas ficam como estão, de propósito.

**3. PostgREST:**

```bash
cd ~/supabase/docker && docker compose restart rest
```

O rollback devolve a `rec_justificar_divergencia` exatamente ao corpo da 0143, devolve o texto das
justificativas só-de-espaços (lendo a cópia) e apaga `rec_dashboard`, `rec_dashboard_opcoes` e
`rec_norm_texto`. Não apaga a tabela de cópia. Rodar duas vezes não faz mal.
