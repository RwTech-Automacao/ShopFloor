# ShopFloor — Visão Técnica

> Documentação técnica do sistema: o que é, com o que foi construído e como
> trabalhamos. Escrita para ser lida por qualquer pessoa da equipe, técnica ou não.

---

## 1. O que é o ShopFloor

**ShopFloor** é um **MES** (Manufacturing Execution System — Sistema de Execução de
Manufatura) feito sob medida para a **Enterplak**. Ele digitaliza o chão de fábrica,
começando pelo **Recebimento e Inspeção** de materiais importados: registra os
processos, importa planilhas, gera etiquetas, guarda fotos e mantém um histórico
auditável de tudo.

- **No ar em:** `https://shopfloor.enterplak.com.br`
- **Acesso:** por login (e-mail + senha), com permissões por perfil.

---

## 2. Stack (linguagens, frameworks e ferramentas)

| Camada | Tecnologia | Papel |
|---|---|---|
| **Linguagem** | **TypeScript** (modo estrito) | Tipagem forte — o compilador pega erros antes de rodar |
| **Framework** | **Next.js 16** (App Router) | Framework fullstack React: renderização no servidor + rotas + backend no mesmo lugar |
| **UI** | **React 19**, **Tailwind CSS v4**, **Base UI** + **shadcn/ui** | Componentes e estilos |
| **Banco de dados** | **PostgreSQL 17** (via **Supabase**) | Banco relacional |
| **Auth / Segurança** | **Supabase Auth** + **RLS** (Row Level Security) | Login e regras de acesso aplicadas no próprio banco |
| **Arquivos/Fotos** | **Google Drive** (API `googleapis`) | Fotos dos processos ficam no Drive; o banco guarda só o endereço |
| **Planilhas** | **SheetJS (`xlsx`)** | Leitura de `.xlsx`/`.csv` na importação |
| **Hospedagem** | **Vercel** | Deploy automático a cada push na branch `main` |
| **Testes** | **Vitest** | Testes automatizados (hoje ~195) |
| **Versionamento** | **Git + GitHub** | Histórico de código |
| **Migrações** | **Supabase CLI** | Versionamento da estrutura do banco |

### Por que essas escolhas
- **Next.js + React + TypeScript:** um único projeto cobre front-end **e** back-end,
  com tipagem de ponta a ponta — menos código duplicado, menos bug.
- **Supabase:** entrega Postgres + login + storage + API prontos, com segurança
  (RLS) no banco. Acelera muito sem abrir mão de robustez.
- **Vercel:** deploy sem servidor pra gerenciar; sobe sozinho a cada push.

---

## 3. Arquitetura

### Organização por módulos (Clean Architecture)
O código é dividido por **módulo de negócio**, e cada módulo em três camadas:

```
src/
  app/                → rotas e telas (Next.js App Router)
  modules/
    recebimento/
      domain/         → regras de negócio PURAS (sem banco, sem framework) — testáveis
      application/    → casos de uso / Server Actions (orquestram)
      infra/          → acesso ao banco/Supabase (repositórios)
    etiquetas/  usuarios/  auth/  logs/  ...
  components/ui/      → componentes visuais reutilizáveis
  shared/lib/         → utilitários e clientes (Supabase, env)
```

**Por quê:** separar *regra de negócio* de *framework* e *banco* deixa o núcleo
testável e fácil de mudar. Trocar o Google Drive por outro storage, por exemplo,
mexe só na camada `infra` — o resto nem fica sabendo.

### Server-first (Server Components + Server Actions)
O grosso roda **no servidor**: as telas são renderizadas no servidor (dados já vêm
prontos, mais rápido e seguro) e as ações de escrita são **Server Actions** —
funções que rodam no servidor e revalidam sessão/permissão a cada chamada. O
navegador nunca fala direto com o banco de forma confiável.

### Segurança em camadas (defense-in-depth)
1. **RLS no banco:** todas as 14 tabelas têm Row Level Security — mesmo que algo
   passasse pela aplicação, o banco só entrega/aceita o que o perfil permite.
2. **Checagem na aplicação:** toda Server Action revalida sessão + permissão.
3. **Sem SQL "na mão":** todo dado do usuário entra como *parâmetro* (query builder),
   nunca concatenado — SQL injection não tem por onde entrar.
4. **Logs imutáveis:** a tabela de auditoria é protegida por trigger contra
   alteração/exclusão — nem o código com privilégio máximo apaga um log.
5. **Chave de serviço** (que ignora RLS) só existe no servidor, nunca vaza pro
   navegador.

### Padrões notáveis
- **Porta/Adapter para fotos:** uma "porta" (`ArmazenamentoFotos`) com adapters
  trocáveis (Google Drive / Supabase Storage / S3-compatível). Muda o backend de
  fotos com **uma variável de ambiente**.
- **Estado do grid na URL:** filtros/ordenação da lista vivem na URL — dá pra
  compartilhar um link já filtrado, e o "voltar" preserva o estado.
- **Migrações versionadas:** toda mudança de estrutura do banco é um arquivo `.sql`
  numerado no git ("schema como código") — hoje são 27.

---

## 4. Módulos e funcionalidades entregues

- **Autenticação + RBAC** — login por e-mail/senha; **perfis** com permissões
  (visualizar, editar, importar, administrar, etc.). Cada usuário **define a
  própria senha** no 1º acesso (senha temporária → troca obrigatória).
- **Recebimento** — cadastro e ciclo dos processos (aberto → conferido →
  finalizado); **importação de planilhas** (`.xlsx`/`.csv`) com mapeamento de
  colunas reutilizável; **grid estilo Excel** (ordenar, filtrar e buscar por
  coluna, tudo no servidor) com layout de colunas configurável e navegação por
  setas que respeita filtros.
- **Etiquetas** — geração de etiquetas (Part Number) a partir dos processos, com
  sub-filtro estilo planilha e "ocultar incompletos".
- **Configurações** — campos do processo, listas (dropdowns), criticidade de
  fornecedor, tabela NQA, colunas da lista.
- **Fotos / anexos** — anexar fotos ao processo (comprimidas), guardadas no Google
  Drive e servidas só a quem está logado.
- **Logs / auditoria** — registro imutável de quem fez o quê.
- **Responsividade** — tabela no desktop, cards no celular/tablet.

---

## 5. Práticas de desenvolvimento

- **Clean Code + SOLID + componentização** — código legível, responsabilidades
  separadas, componentes reutilizáveis.
- **TDD (Test-Driven Development)** nas regras de negócio puras — escreve o teste,
  vê falhar, implementa, vê passar. (~195 testes automatizados.)
- **Cadência por feature:**
  `brainstorm → especificação → plano → implementação → revisão adversarial → smoke do usuário → deploy`.
  Cada etapa é um ponto de decisão antes de virar código.
- **Revisão de código** — toda mudança passa por uma revisão crítica (buscando
  bug/segurança) antes de subir; features maiores são executadas por agentes
  especializados com revisão a cada tarefa.
- **Migrações versionadas** — estrutura do banco evolui por arquivos no git,
  aplicados de forma reproduzível (ver `docs/ambientes.md`).
- **Ambiente Dev × Prod** — um "laboratório" (Dev) idêntico à produção para testar
  com segurança; mudanças são promovidas pro Prod de forma controlada
  (**banco antes do código**).
- **Verificação antes de concluir** — `tsc` (tipos) + `lint` + `build` + testes
  verdes antes de qualquer entrega.
- **Documentação viva** — specs, planos, histórico e este guia versionados no repo.

---

## 6. Ambientes

| | **Prod** | **Dev** |
|---|---|---|
| Uso | Sistema real do time | Laboratório de desenvolvimento |
| App | `shopfloor.enterplak.com.br` | `localhost:3000` |
| Fotos | Pasta Drive de produção | Pasta Drive separada (isolada) |

Fluxo de uma mudança: **branch → desenvolve no Dev → aprova no smoke → aplica no
Prod → merge → deploy**. Detalhes e comandos em [`docs/ambientes.md`](ambientes.md).

---

## 7. Estado atual

Sistema **entregue ao time** e em produção, com o ambiente de desenvolvimento
(Dev × Prod) montado. Próximos passos previstos: novos **módulos** (o projeto vai
crescer), rotina de **backup** quando entrar dado real, e otimizações de escala
(índices/paginação) quando o volume justificar.
