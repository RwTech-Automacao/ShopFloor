import type { SupabaseClient } from '@supabase/supabase-js'
/** A mesma comparação em tempo constante dos segredos do cron/webhooks (ver a rota da fila de estoque). */
import { segredoConfere } from '@/modules/alertas/infra/assinatura'
import { gerarQrDataUrl } from '@/modules/alertas/infra/qr'
import {
  LIMITE_FICHAS_QUIOSQUE,
  chaveDoResponsavel,
  fichaDaPendencia,
  pendenciasComFicha,
  type FichaComQr,
} from '../domain/quiosque-fichas'

/**
 * A chave do link do tablet confere? Chave do ambiente vazia ou ausente = página DESLIGADA (sempre não).
 * Espaços em volta da variável são ignorados (um `FICHAS_TABLET_CHAVE= ` acidental não vira chave vazia válida).
 */
export function chaveDoQuiosqueConfere(recebida: string | null | undefined, configurada: string | undefined): boolean {
  const esperada = (configurada ?? '').trim()
  if (esperada === '') return false
  return segredoConfere(recebida, esperada)
}

/**
 * A fila do Almoxarifado com as fichas, pelo client de SERVICE ROLE (a página do tablet não tem sessão).
 *
 * A lista é a MESMA da tela /recebimento/almoxarifado ("Esperando confirmação"): `sf_almox_pendencias` é só
 * `sf_almox_pendencias_base()` atrás do teste de permissão do usuário (0167), e a base é liberada ao
 * service_role. Produto e quantidade vêm de `sf_ordens`; o responsável, de `alerta_ficha_responsavel` (0173) —
 * a mesma regra da ficha do Discord. Só leitura.
 *
 * Falha ao ler a FILA lança (a página mostra erro, nunca "nada esperando"). Falha ao ler o responsável de uma
 * ficha só deixa o campo em "—".
 */
export async function carregarFichasDoQuiosque(
  supabase: SupabaseClient,
  limite = LIMITE_FICHAS_QUIOSQUE,
): Promise<{ fichas: FichaComQr[]; total: number }> {
  const { data, error } = await supabase.rpc('sf_almox_pendencias_base')
  if (error) throw new Error(`sf_almox_pendencias_base: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('sf_almox_pendencias_base: resposta inesperada')

  const pendencias = pendenciasComFicha(data)
  const mostrar = pendencias.slice(0, Math.max(0, limite))
  if (mostrar.length === 0) return { fichas: [], total: pendencias.length }

  const ops = [...new Set(mostrar.map((p) => p.op))]
  const { data: ordens, error: erroOrdens } = await supabase
    .from('sf_ordens')
    .select('pmo, op, descricao, qtd')
    .in('op', ops)
  if (erroOrdens) throw new Error(`sf_ordens: ${erroOrdens.message}`)
  const porOp = new Map<string, { descricao: string | null; qtd: number | null }>()
  for (const o of (ordens ?? []) as { pmo: string; op: string; descricao: string | null; qtd: number | null }[]) {
    porOp.set(`${o.pmo}\u0000${o.op}`, { descricao: o.descricao, qtd: o.qtd })
  }

  const fichas = await Promise.all(
    mostrar.map(async (p): Promise<FichaComQr> => {
      const chave = chaveDoResponsavel(p)
      let responsavel: string | null = null
      if (chave) {
        const r = await supabase.rpc('alerta_ficha_responsavel', {
          p_tipo: p.tipo,
          p_pmo: p.pmo,
          p_op: p.op,
          p_chave: chave,
        })
        responsavel = !r.error && typeof r.data === 'string' ? r.data : null
      }
      const dados = fichaDaPendencia(p, porOp.get(`${p.pmo}\u0000${p.op}`) ?? null, responsavel)
      return { dados, qr: await gerarQrDataUrl(p.codigo) }
    }),
  )
  return { fichas, total: pendencias.length }
}
