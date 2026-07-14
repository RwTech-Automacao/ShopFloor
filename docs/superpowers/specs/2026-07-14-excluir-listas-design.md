# Excluir listas suspensas (remover trava de sistema) — Design

Feature do roadmap: permitir **excluir qualquer lista suspensa**, removendo a
trava que hoje impede excluir listas de "sistema" — mantendo apenas a proteção
de **lista em uso** (que evita quebrar um campo/dropdown ou os status).

## Contexto (descoberta na exploração)

- `listas_delete` (RLS, migração 0006) hoje exige `tem_permissao('administrar')`
  **E `sistema = false`** — essa cláusula é a trava.
- Todas as 9 listas atuais são `sistema=true`; **8 estão em uso** por um campo
  (`configuracao_campos.lista_chave`), e a lista **`resultado`** também dirige
  os **status terminais** dos processos (`listarValoresStatus` +
  `transicoes-processo`).
- `configuracao_campos.lista_chave` é **FK para `listas(chave)` SEM cascade** →
  o Postgres **já impede fisicamente** apagar uma lista em uso (erro de FK). Ou
  seja, "excluir todas" = remover a trava do `sistema`; a proteção de "em uso"
  é intrínseca e desejada.

## Decisões (aprovadas)

1. **Remover a trava de `sistema`:** qualquer lista pode ser excluída (gate
   `administrar` mantido).
2. **Lista em uso = BLOQUEAR com aviso** (não forçar). Se um campo usa a lista,
   o app recusa com mensagem clara nomeando o(s) campo(s); para excluir, o
   usuário primeiro remove a associação no campo. Nunca quebra um dropdown/os
   status por acidente.
3. **Permissão:** continua `administrar`.
4. **Badge "Sistema"** permanece como informação (não bloqueia mais nada).

## Arquitetura

### Migração `0019_listas_delete_sem_sistema.sql`

Recria a policy de DELETE sem a cláusula de sistema:

```sql
drop policy listas_delete on public.listas;
create policy listas_delete on public.listas
  for delete to authenticated using (public.tem_permissao('administrar'));
```

**ENTREGA SEGURADA (pedido do usuário):** como não há ambiente Dev separado e
o usuário pediu para **não fazer push por enquanto**, a migração 0019 **NÃO é
aplicada em produção agora** — aplicar o RLS afrouxado em prod antes do código
(a checagem de uso) deixaria o banco inconsistente. Tudo é construído e
**commitado localmente**; a **aplicação da migração + o push acontecem juntos**
quando o usuário liberar (após validar anexos/export). Até lá o smoke real fica
pendente (a migração precisa estar aplicada).

### Infra — `lista-repository.ts`

Nova função para a checagem de uso:

```ts
/** Rótulos dos campos (configuracao_campos) que usam esta lista (por chave).
 *  Vazio = lista não está em uso e pode ser excluída. */
export async function camposQueUsamLista(chave: string): Promise<string[]>
```

- Query: `select rotulo from configuracao_campos where lista_chave = :chave`
  (ordenado por `rotulo`). Retorna os rótulos.
- `excluirLista(id)` permanece como está (delete + verificação de linha
  afetada); a constante `ERRO_LISTA_BLOQUEADA_EXCLUSAO` (0 linhas) deixa de
  significar "lista de sistema" e passa a significar "não removida" (RLS/sem
  permissão/já removida) — a mensagem na action é reescrita.

### Application — `actions.ts` (`excluirListaAction`)

Antes de excluir, checa uso:

```
sessão + podeFazer('administrar')  → senão SEM_PERMISSAO
alvo = buscarListaPorId(id)        → senão 'Lista não encontrada.'
usos = camposQueUsamLista(alvo.chave)
if (usos.length > 0)               → { erro: 'Esta lista é usada pelo(s) campo(s): <lista>. Remova a associação antes de excluir.' }
excluirLista(id)                   → catch: ERRO_LISTA_BLOQUEADA_EXCLUSAO → 'Não foi possível excluir a lista.'; outro → 'Não foi possível excluir a lista.'
log 'excluir' + revalidatePath
```

- A mensagem "Listas do sistema não podem ser excluídas." é **removida**
  (obsoleta).
- O erro de FK (caso raro de corrida: um campo passa a usar a lista entre o
  check e o delete) cai no `catch` genérico — seguro (a lista não é apagada).

### UI — `lista-form.tsx` / `page.tsx`

- `ExcluirListaButton`: `disabled={sistema || pending}` → `disabled={pending}`.
  A prop `sistema` deixa de ser usada pelo botão e é **removida** (o `page.tsx`
  para de passá-la ao botão; o **badge "Sistema"** em `page.tsx` continua,
  lendo `lista.sistema` direto).
- O `window.confirm` de exclusão permanece. A mensagem de erro em uso aparece
  inline (mesmo canal do erro atual).

## Validação e erros

| Situação | Comportamento |
|---|---|
| Sem `administrar` | Botão/aria já existente; action retorna sem permissão. |
| Lista NÃO em uso | Exclui (itens caem por `on delete cascade`); toast/log ok. |
| Lista em uso por campo(s) | Bloqueia: "Esta lista é usada pelo(s) campo(s): X, Y. Remova a associação antes de excluir." |
| Corrida (FK dispara mesmo assim) | `catch` genérico "Não foi possível excluir a lista." (não apaga). |

## Fora de escopo

- Não altera o conceito/coluna `sistema` (segue marcando as listas do seed).
- Não mexe em como os campos referenciam listas nem nos status.
- Não adiciona "forçar exclusão" (rejeitado — quebraria campos/status).

## Testes

- **Infra/app/UI:** build + smoke (a exclusão real depende do banco).
- **Smoke:** com `administrar` — criar uma lista nova (não usada por campo) e
  excluí-la (funciona); tentar excluir a `resultado` (ou `tipo`) → aviso
  nomeando o campo, sem apagar; confirmar que os status/dropdowns seguem
  intactos.
- Sem regra pura nova relevante para TDD (a mensagem é montada inline; a
  checagem de uso é query de infra).
