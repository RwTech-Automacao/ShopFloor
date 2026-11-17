import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { FilaDaConfirmacao, FilaDoCron, ItemFila } from '@/modules/compels/application/baixar-nfs'

/**
 * A fila de prioridade da baixa de NF (`fat_fila_baixa_nf`, migração 0185). Leitura pelo RLS
 * (`faturamento.visualizar`); escrita do usuário SÓ pelas funções `fat_fila_colocar`/`fat_fila_tirar` (que
 * conferem `faturamento.baixar`); o cron grava com a service role.
 */
const TABELA = 'fat_fila_baixa_nf'

/** Nome que o cron deixa em `finalizado_por_nome` (não há usuário). */
export const NOME_DO_CRON = 'ShopFloor (fila automática)'

export type StatusFila = 'aguardando' | 'baixada' | 'simulada' | 'baixada_fora' | 'removida' | 'falhou'

export interface LinhaFila {
  id: string
  notaId: number
  numero: number
  cliente: string
  status: StatusFila
  colocadoPorNome: string
  colocadoEm: string
  tentativas: number
  ultimaTentativaEm: string | null
  ultimaMensagem: string
  finalizadoEm: string | null
}

interface LinhaBanco {
  id: string
  nota_id: number | string
  numero: number | string
  cliente: string | null
  status: string
  colocado_por_nome: string | null
  colocado_em: string
  tentativas: number | null
  ultima_tentativa_em: string | null
  ultima_mensagem: string | null
  finalizado_em: string | null
}

const CAMPOS =
  'id, nota_id, numero, cliente, status, colocado_por_nome, colocado_em, tentativas, ultima_tentativa_em, ' +
  'ultima_mensagem, finalizado_em'

function lerLinha(l: LinhaBanco): LinhaFila {
  return {
    id: l.id,
    notaId: Number(l.nota_id),
    numero: Number(l.numero),
    cliente: l.cliente ?? '',
    status: l.status as StatusFila,
    colocadoPorNome: l.colocado_por_nome ?? '',
    colocadoEm: l.colocado_em,
    tentativas: l.tentativas ?? 0,
    ultimaTentativaEm: l.ultima_tentativa_em,
    ultimaMensagem: l.ultima_mensagem ?? '',
    finalizadoEm: l.finalizado_em,
  }
}

const paraItem = (l: LinhaFila): ItemFila => ({
  id: l.id, notaId: l.notaId, numero: l.numero, cliente: l.cliente, tentativas: l.tentativas,
})

async function aguardandoCom(sb: SupabaseClient): Promise<LinhaFila[]> {
  const { data, error } = await sb.from(TABELA).select(CAMPOS).eq('status', 'aguardando').order('posicao')
  if (error) throw new Error(`fila da baixa de NF: ${error.message}`)
  return ((data ?? []) as unknown as LinhaBanco[]).map(lerLinha)
}

/** Para a tela: quem aguarda (em ordem) e as que saíram da fila sem baixar nos últimos `diasFalhas` dias. */
export async function lerFilaDaTela(diasFalhas = 7): Promise<{ aguardando: LinhaFila[]; falhas: LinhaFila[] }> {
  const sb = await createServerSupabase()
  const desde = new Date(Date.now() - diasFalhas * 86_400_000).toISOString()
  const [aguardando, falhas] = await Promise.all([
    aguardandoCom(sb),
    sb.from(TABELA).select(CAMPOS).eq('status', 'falhou').gte('finalizado_em', desde)
      .order('finalizado_em', { ascending: false }).limit(50),
  ])
  if (falhas.error) throw new Error(`fila da baixa de NF: ${falhas.error.message}`)
  return { aguardando, falhas: ((falhas.data ?? []) as unknown as LinhaBanco[]).map(lerLinha) }
}

/** A fila vista pela confirmação, com a sessão do usuário (o banco confere `faturamento.baixar`). */
export async function filaDoUsuario(): Promise<FilaDaConfirmacao> {
  const sb = await createServerSupabase()
  return {
    aguardando: async () => (await aguardandoCom(sb)).map(paraItem),
    async colocar(nota, r) {
      const { data, error } = await sb.rpc('fat_fila_colocar', {
        p_nota_id: nota.notaId, p_numero: nota.numero, p_cliente: nota.cliente,
        p_status: r.status, p_mensagem: r.mensagem, p_tentativas: r.tentativas,
      })
      if (error) throw new Error(`não foi possível gravar na fila: ${error.message}`)
      return { posicao: typeof data === 'number' ? data : null }
    },
  }
}

/** Tira uma nota da fila (aguardando → removida). `false` = já não estava aguardando. */
export async function tirarDaFila(id: string): Promise<boolean> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('fat_fila_tirar', { p_id: id })
  if (error) throw new Error(`não foi possível tirar da fila: ${error.message}`)
  return data === true
}

/** A fila vista pelo cron (service role: ignora o RLS). */
export function filaDoServico(sb: SupabaseClient = createServiceSupabase()): FilaDoCron {
  return {
    aguardando: async () => (await aguardandoCom(sb)).map(paraItem),
    async tentativa(id, r) {
      const { error } = await sb.from(TABELA)
        .update({ tentativas: r.tentativas, ultima_mensagem: r.mensagem, ultima_tentativa_em: new Date().toISOString() })
        .eq('id', id).eq('status', 'aguardando')
      if (error) throw new Error(`fila da baixa de NF: ${error.message}`)
    },
    async finalizar(id, status, mensagem) {
      const agora = new Date().toISOString()
      // Baixa feita de verdade vale mesmo que alguém tenha tirado a nota da fila durante a rodada: o registro
      // tem que dizer o que aconteceu no Compels.
      const de = status === 'baixada' || status === 'simulada' ? ['aguardando', 'removida'] : ['aguardando']
      const { error } = await sb.from(TABELA)
        .update({
          status, ultima_mensagem: mensagem, ultima_tentativa_em: agora,
          finalizado_em: agora, finalizado_por: null, finalizado_por_nome: NOME_DO_CRON,
        })
        .eq('id', id).in('status', de)
      if (error) throw new Error(`fila da baixa de NF: ${error.message}`)
    },
  }
}
