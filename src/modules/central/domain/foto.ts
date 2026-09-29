/**
 * A "foto" enviada de hora em hora para a Central do Cliente — contrato versão 1, definido no
 * plano `docs/superpowers/plans/2026-09-29-central-do-cliente-5-sincronizacao.md` do repositório
 * Central-Do-Cliente (ver o JSON de exemplo em tools/central-sync/README.md §0). Só o que o
 * cliente pode ver:
 *   Recebimento: id, acp_cliente (como texto), numero_emb, data_chegada e o status — só
 *   'aberto', 'em_conferencia' e 'finalizado' ('cancelado' nunca chega aqui: a 0134 já filtra).
 *   Ordem: id, acp (como texto), a DATA do primeiro registro de produção (fuso de São Paulo) e se
 *   está finalizada.
 * NUNCA colaborador, defeito, número de série, fornecedor, NF, comprador ou reprovação — essas
 * colunas nem existem nas linhas que chegam aqui (a 0134 já não as seleciona).
 */

export type Situacao = 'aberto' | 'em_conferencia' | 'finalizado'

const SITUACOES: readonly Situacao[] = ['aberto', 'em_conferencia', 'finalizado']

/** Uma linha crua de `central_recebimentos_para_sincronizar()` (migração 0134). */
export interface LinhaRecebimento {
  id: string
  projetos: string | null
  numero_emb: string | null
  data_chegada: string | null
  situacao: string | null
}

/** Uma linha crua de `central_ordens_para_sincronizar()` (migração 0134). */
export interface LinhaOrdem {
  id: string
  projetos: string | null
  primeiro_registro: string | null
  concluida: boolean | null
}

export interface RecebimentoFoto {
  id: string
  projetos: string
  numeroEmb: string
  dataChegada: string | null
  situacao: Situacao
}

export interface OrdemFoto {
  id: string
  projetos: string
  primeiroRegistro: string | null
  concluida: boolean
}

/** O corpo exato que `POST /api/sincronizacao` da Central espera. Nenhuma chave além destas. */
export interface Foto {
  versao: 1
  geradoEm: string
  recebimentos: RecebimentoFoto[]
  ordens: OrdemFoto[]
}

function situacaoValida(v: string | null): Situacao {
  if (v !== null && (SITUACOES as readonly string[]).includes(v)) return v as Situacao
  // A 0134 já filtra `status in ('aberto','em_conferencia','finalizado')` na consulta: chegar
  // aqui com outra coisa é bug do banco (ou da migração), nunca uma situação de verdade — melhor
  // travar a sincronização inteira do que mandar pra Central algo fora do contrato dela.
  throw new Error(`situação fora do contrato: ${JSON.stringify(v)}`)
}

/**
 * Só a data (aaaa-mm-dd). O Postgres já devolve colunas `date` nesse formato via PostgREST, mas
 * isto blinda contra qualquer coisa com hora/fuso grudados.
 */
function apenasData(v: string | null): string | null {
  if (v === null) return null
  const m = /^\d{4}-\d{2}-\d{2}/.exec(v)
  return m ? m[0] : null
}

/**
 * Monta o contrato v1 a partir das linhas das duas funções da 0134. Pura: não lê banco, não faz
 * I/O — só transforma o que `infra/leitura.ts` já buscou.
 */
export function montarFoto(recebimentos: LinhaRecebimento[], ordens: LinhaOrdem[], agora: Date): Foto {
  return {
    versao: 1,
    geradoEm: agora.toISOString(),
    recebimentos: recebimentos.map((r) => ({
      id: r.id,
      projetos: (r.projetos ?? '').trim(),
      numeroEmb: (r.numero_emb ?? '').trim(),
      dataChegada: apenasData(r.data_chegada),
      situacao: situacaoValida(r.situacao),
    })),
    ordens: ordens.map((o) => ({
      id: o.id,
      projetos: (o.projetos ?? '').trim(),
      primeiroRegistro: apenasData(o.primeiro_registro),
      concluida: o.concluida === true,
    })),
  }
}
