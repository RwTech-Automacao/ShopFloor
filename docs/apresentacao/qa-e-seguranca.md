# ShopFloor — Q&A da apresentação + Notas de segurança

Material de apoio (2026-07-15). Baseado no código real em produção.

---

# Parte 1 — Segurança

## 1.1 SQL Injection

**Veredito: risco de SQL injection clássico é essencialmente nulo.** Motivos, verificados no código:

1. **Não existe SQL dinâmico.** Nenhuma migração monta comando SQL como texto e executa
   (`EXECUTE format(...)`). As funções do banco (RPCs) são SQL **estático com parâmetros
   ligados**. O único `format()` do projeto (migração 0008) monta uma **mensagem de log**,
   não SQL.
2. **Todo acesso ao banco passa pelo cliente Supabase (PostgREST)**, que envia os valores
   como **parâmetros** — nunca concatena o que o usuário digitou dentro de um comando SQL.
3. **As RPCs recebem parâmetros tipados** (`p_busca text`, `p_mes text`, `p_id uuid`). O
   Postgres trata o conteúdo como **valor**, jamais como código.

### O risco que de fato existia (e está tratado)
Não é SQL injection — é **injeção no filtro do PostgREST**. A busca livre monta uma string
de filtro do tipo `coluna.ilike.%termo%,outra.ilike.%termo%`. Se o termo contivesse
`,` `.` `(` `)` `%` `*`, poderia **alterar o filtro** (ampliar resultado / mexer em quais
colunas são comparadas).

**Tratamento:** a função `sanitizarTermoBusca()` remove esses caracteres **antes** de montar
o filtro, e há **testes automatizados cobrindo cada caractere**. Aplicada nos 3 caminhos:
- lista de processos (`listarProcessos` / `listarProcessosDoMes`),
- contagem por mês (RPC `processos_meses`),
- busca de etiquetas (`sanitizarTermo`, mesma abordagem).

### A defesa de fundo (o ponto mais importante)
Mesmo que alguém contornasse o app inteiro, o **RLS (Row Level Security) do Postgres** limita
o que cada usuário pode ler/escrever conforme as permissões do perfil dele. **O banco é a
última palavra, não o app.** É por isso que o gate de permissão existe em duas camadas
(Server Action + RLS).

### Limitação honesta (dizer se perguntarem)
A **API do Supabase é pública na internet** — é assim que o Vercel conversa com ela. Ela é
protegida por **login (JWT) + RLS**, não por rede. Ou seja: a segurança vem de **"quem você
é"** (usuário + permissões), não de **"de onde você vem"** (IP).

---

## 1.2 Limitar acesso por IP

### As opções reais

| Opção | Como | Situação |
|---|---|---|
| **1. Vercel Firewall** (allowlist de IP na borda) | O jeito "certo", bloqueia antes de chegar no app | ⚠️ Projeto está no plano **Hobby**; regra de IP é recurso de **plano pago** (Pro, ~US$20/mês) |
| **2. Middleware do Next** (checar IP no código) | Dá pra fazer **hoje**, sem custo: o `middleware.ts` já intercepta todas as rotas; leria o IP (`x-forwarded-for`) e bloquearia fora da lista | Protege **só o app** — a API do Supabase continua acessível direto |
| **3. Supabase Network Restrictions** | Restringe o **banco** por IP | Vale pra conexão direta ao Postgres; teria que liberar os IPs do Vercel (que são dinâmicos) → na prática atrapalha mais que ajuda |

### ⚠️ O conflito que PRECISA ser dito
Acabamos de entregar a **foto pela câmera do celular/tablet** no recebimento. Se limitar por
IP da fábrica:
- **quem estiver no 4G não entra** — só quem estiver no **Wi-Fi da fábrica**.

Então, antes de decidir: **os aparelhos que vão tirar foto ficam no Wi-Fi da fábrica?**
- **Sim** → allowlist de IP é viável.
- **Não / não sempre** → allowlist quebraria o caso de uso que acabamos de construir.

### Recomendação
O sistema **já está protegido pela camada que realmente importa** num MES interno:
**login + perfis/permissões + RLS + auditoria**. Restringir por IP é **reforço** (defesa em
profundidade), **não a base**. Se a diretoria pedir, o caminho mais barato é a **opção 2
(middleware)** — mas só depois de resolver a questão do celular/4G.

---

## 1.3 Outras proteções que já existem (bom ter na ponta da língua)

- **Senhas:** gerenciadas pelo **Supabase Auth** (com hash). Nunca ficam no nosso banco nem
  aparecem em log.
- **Auditoria imutável:** a tabela de logs tem *triggers* que **bloqueiam alteração e
  exclusão** — inclusive para a chave de serviço. Registra quem fez, o quê e quando.
- **Permissões por perfil:** 8 permissões (visualizar, importar, editar, finalizar,
  editar_finalizado, excluir, gerar_etiqueta, administrar), configuráveis por tela.
- **Fotos:** bucket **privado**; acesso só por **URL assinada temporária**. Nada é público.
- **Chave de serviço** (a que ignora RLS): existe **só no servidor** (`server-only`), nunca
  vai para o navegador.
- **HTTPS + HSTS** no domínio próprio (`shopfloor.enterplak.com.br`), certificado válido.
- **Processo concluído é somente-leitura** — para editar, tem que Reabrir (com permissão), e
  fica registrado.

---

# Parte 2 — Perguntas prováveis (e respostas)

## Uso do dia a dia

**"E se alguém finalizar um processo por engano?"**
→ Dá pra **Reabrir** (quem tem a permissão `editar_finalizado`). Volta pra "Em conferência" e
fica registrado no log quem reabriu.

**"Dá pra apagar um processo?"**
→ **Hoje não.** Não existe exclusão de processo pela tela. Se for necessário, é uma decisão a
tomar (com cuidado: mexe em auditoria).

**"Quem pode fazer o quê?"**
→ Configurável em **Configurações → Perfis**, por permissão. Dá pra criar perfis (ex.:
Consulta, Recebimento, Qualidade, Admin).

**"Consigo saber quem mexeu no quê?"**
→ Sim: **Configurações → Logs**, com usuário, ação, data e o que mudou. E os logs **não podem
ser alterados nem apagados**.

**"Funciona no celular?"**
→ Sim — a lista vira cards e a **foto usa a câmera**. Ressalva honesta: o **layout 100%
responsivo** (todas as telas) ainda é um pacote de melhoria a fazer.

**"E se cair a internet?"**
→ É um sistema web: **precisa de conexão**. Não há modo offline.

**"Posso adicionar um campo novo / mudar as opções de um dropdown?"**
→ Sim, sem programador: **Configurações → Campos** e **Configurações → Listas** (admin).

## Fotos

**"As fotos ficam guardadas pra sempre?"**
→ **Não** — e isso é de propósito. O armazenamento é um **buffer temporário**: no fim do mês
você **exporta um ZIP** (com as fotos renomeadas por pedido + item + nº do processo) e
**limpa**. O arquivo definitivo fica no **Drive**. Depois de limpar, o processo mostra "0 fotos".

**"Quantas fotos por processo?"** → **3**.

**"A foto some se eu limpar sem exportar?"**
→ Sim — por isso são **dois botões separados** (Exportar / Limpar), com confirmação. A ordem
é: exporta → guarda no Drive → limpa.

## Dados, custo e risco

**"Onde ficam os dados?"**
→ Supabase (Postgres) na AWS **São Paulo (sa-east-1)** — dados no Brasil.

**"Tem backup?"**
→ ⚠️ **Ponto a verificar/endereçar.** Hoje estamos no **plano free** do Supabase, onde os
backups são limitados (o *point-in-time recovery* é de plano pago). Se o sistema virar
crítico pra operação, **vale contratar o plano com backup** — resposta honesta: "está no
radar, e a decisão é de custo".

**"E se o Vercel ou o Supabase cair?"**
→ Dependemos desses serviços (padrão de mercado, alta disponibilidade). Não temos plano de
contingência local.

**"Quanto custa hoje?"**
→ Está tudo em **plano gratuito**. Custos entram se precisar de: backup/PITR (Supabase Pro),
firewall de IP (Vercel Pro) ou volume maior.

**"Isso está pronto pra produção de verdade?"**
→ Sim para uso, **com uma ressalva que eu mesmo levanto**: ainda **não existe ambiente de
homologação (Dev)** separado — hoje as mudanças vão direto para produção. É o **próximo passo
técnico** que recomendo antes do uso pesado diário.

---

# Parte 3 — Ressalvas que vale admitir antes de perguntarem

Ser transparente nestes 4 pontos gera mais confiança do que ser pego neles:

1. **Sem ambiente de homologação (Dev)** — mudanças vão direto pra produção. Já é o próximo
   passo planejado (2º projeto Supabase).
2. **Backup no plano free** — limitado; é decisão de custo se o sistema virar crítico.
3. **Sem modo offline** — precisa de internet.
4. **Responsivo mobile parcial** — funciona, mas o polimento completo de todas as telas é um
   pacote futuro.

---

# Parte 4 — Pendência conhecida (não é bug de dado)

Na tela de **Etiquetas**, a coluna **"Nº" mostra a posição na lista (1, 2, 3…)** e não o
número do processo. **Já está corrigido e pronto para subir** — não foi para produção ainda
por decisão de não mexer durante a apresentação. Se alguém notar: *"é só exibição naquela
coluna, a correção já está feita"*.
