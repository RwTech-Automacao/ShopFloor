'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { fixarAlmoxarifado, trechosDoEspelho, validarCadastro, type CadastroOp, type UltimaOp } from '../domain/cadastro-op'
import { mensagemErroDeTrecho } from '../domain/erros-trecho'
import { mensagemOpDuplicada } from '../domain/op-unica'
import { postoAlmoxarifadoPadrao } from '../domain/rota-op-nova'
import { cadastrarOp, ultimaOpDaPmo } from '../infra/cadastro-op-repository'
import { listarEspelho } from '../infra/espelho-ops-repository'
import { buscarOpEmUso, listarPostos } from '../infra/ordem-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'

export type ResultadoCadastro = { ok: true; id: string; pmo: string; op: string } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar ordens de produção.'

async function sessaoAdmin() {
  const s = await getSessao()
  return s && podeNoModulo(s.perfil, 'shopfloor', 'administrar') ? s : null
}

function mensagemDoBanco(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (code === '23505') return 'Já existe uma OP com esse PMO e número.'
  return mensagemErroDeTrecho(e) ?? 'Não foi possível criar a OP.'
}

/**
 * Cria a OP nova (Ordens → Nova OP). Nada do cliente é confiado: postos conferidos no catálogo, Almoxarifado no fim
 * da PMO, componentes/burn-in só nos postos certos e, no modo Compels, os trechos conferidos contra o espelho.
 */
export async function cadastrarOpAction(c: CadastroOp): Promise<ResultadoCadastro> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }

  const [catalogo, perfis] = await Promise.all([listarPostos(), mapaPostoPerfil()])
  const chaves = new Set(catalogo.map((p) => p.chave))
  const recurso = (p: string): string => perfis[p]?.recurso ?? 'nenhum'
  // o mesmo critério do criarOrdemAction (ordens-actions → postoAlmoxarifado): o perfil decide, não o nome
  const almox = postoAlmoxarifadoPadrao(catalogo.map((p) => p.chave), (p) => perfis[p] ?? { recurso: 'nenhum' })
  const trechos = fixarAlmoxarifado(c.trechos.map((t) => ({
    ...t,
    postos: [...new Set(t.postos.map((p) => p.trim()).filter((p) => chaves.has(p)))],
    faixas: t.tipo === 'prt' && t.snModo === 'mesmo' ? [] : t.faixas,
  })), almox)

  if (c.modo === 'compels') {
    const base = trechos.at(-1)?.compelsOp ?? ''
    const opNum = c.op.trim()
    const opOk = base !== '' && (opNum === base || (opNum.startsWith(`${base}_`) && /^[A-Za-z0-9]{1,10}$/.test(opNum.slice(base.length + 1))))
    if (!opOk) return { ok: false, erro: `O número da OP tem que ser o da OP do Compels (${base}) ou ele com sufixo (ex.: ${base}_F).` }
    let esperado: ReturnType<typeof trechosDoEspelho> = []
    try {
      const espelho = await listarEspelho()
      const opPmo = espelho.find((o) => String(o.numero) === base && o.codigo === c.pmo.trim())
      if (opPmo && !opPmo.ativa) return { ok: false, erro: `A OP ${base} não está mais ativa no Compels.` }
      if (opPmo) esperado = trechosDoEspelho(opPmo, espelho)
    } catch {
      return { ok: false, erro: 'Não foi possível ler o espelho do Compels agora.' }
    }
    const bate = esperado.length === trechos.length &&
      esperado.every((t, i) => t.codigo === trechos[i]!.codigo && t.compelsOp === trechos[i]!.compelsOp &&
        t.seq === trechos[i]!.seq && t.tipo === trechos[i]!.tipo)
    if (!bate) return { ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' }
  } else if (trechos.length !== 1 || trechos[0]!.tipo !== 'pmo' || trechos[0]!.compelsOp !== null) {
    return { ok: false, erro: 'Cadastro manual tem um trecho só, sem OP do Compels.' }
  }

  const rota = new Set(trechos.flatMap((t) => t.postos))
  const limpo: CadastroOp = {
    ...c,
    pmo: c.pmo.trim(),
    op: c.op.trim(),
    trechos,
    componentes: c.componentes.filter((x) => rota.has(x.posto) && recurso(x.posto) === 'integracao'),
    burnin: c.burnin.filter((x) => rota.has(x.posto) && recurso(x.posto) === 'burnin'),
  }
  const v = validarCadastro(limpo)
  if (!v.ok) return v

  const emUso = await buscarOpEmUso(limpo.op)
  if (emUso) return { ok: false, erro: mensagemOpDuplicada(emUso) }

  let id: string
  try {
    id = await cadastrarOp(limpo)
  } catch (e) {
    return { ok: false, erro: mensagemDoBanco(e) }
  }
  await registrarLog({
    entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${limpo.pmo}/${limpo.op} criada (${limpo.modo})`,
    dados: { modo: limpo.modo, trechos: limpo.trechos.map((t) => ({ codigo: t.codigo, compelsOp: t.compelsOp, snModo: t.snModo, postos: t.postos, faixas: t.faixas })) },
  })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id, pmo: limpo.pmo, op: limpo.op }
}

/** Os postos (com o trecho), componentes e burn-in da última OP da PMO. Sem permissão ou erro: null. */
export async function ultimaOpDaPmoAction(pmo: string): Promise<UltimaOp | null> {
  if (!(await sessaoAdmin())) return null
  try { return await ultimaOpDaPmo(String(pmo ?? '').trim()) } catch { return null }
}
