'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  erroCadeiaCompels, erroSufixoOp, fixarAlmoxarifado, resumoIgnoradas, trechosDoEspelho, validarCadastro,
  type CadastroOp, type PrtIgnoradaEnvio, type UltimaOp,
} from '../domain/cadastro-op'
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
  const trechos = fixarAlmoxarifado(c.trechos.map(({ herdados: _herdados, ...t }) => ({
    ...t,
    postos: [...new Set(t.postos.map((p) => p.trim()).filter((p) => chaves.has(p)))],
    faixas: t.tipo === 'prt' && t.snModo === 'mesmo' ? [] : t.faixas,
  })), almox)

  // PRTs da cadeia que ficam fora da OP (não são trecho): conferidas contra o espelho abaixo, como os trechos
  const ignoradas: PrtIgnoradaEnvio[] = (Array.isArray(c.ignoradas) ? c.ignoradas : [])
    .map((i) => ({ codigo: String(i?.codigo ?? ''), compelsOp: i?.compelsOp == null ? null : String(i.compelsOp), modo: i?.modo }))

  if (c.modo === 'compels') {
    const base = trechos.at(-1)?.compelsOp ?? ''
    const erroOp = erroSufixoOp(base, c.op)
    if (erroOp) return { ok: false, erro: erroOp }
    let esperado: ReturnType<typeof trechosDoEspelho> = []
    try {
      const espelho = await listarEspelho()
      const opPmo = espelho.find((o) => String(o.numero) === base && o.codigo === c.pmo.trim())
      if (opPmo && !opPmo.ativa) return { ok: false, erro: `A OP ${base} não está mais ativa no Compels.` }
      if (opPmo) esperado = trechosDoEspelho(opPmo, espelho)
    } catch {
      return { ok: false, erro: 'Não foi possível ler o espelho do Compels agora.' }
    }
    const erroCadeia = erroCadeiaCompels(esperado, trechos, ignoradas)
    if (erroCadeia) return { ok: false, erro: erroCadeia }
  } else if (trechos.length !== 1 || trechos[0]!.tipo !== 'pmo' || trechos[0]!.compelsOp !== null || ignoradas.length > 0) {
    return { ok: false, erro: 'Cadastro manual tem um trecho só, sem OP do Compels.' }
  }

  const rota = new Set(trechos.flatMap((t) => t.postos))
  const limpo: CadastroOp = {
    ...c,
    ignoradas,
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
  // a decisão de ignorar fica no log da OP (quem e quando o log já grava): qual PRT e tirar/manter os postos
  const linhaIgnoradas = resumoIgnoradas(ignoradas)
  await registrarLog({
    entidade: 'sf_ordem', entidadeId: id, acao: 'criar',
    descricao: `OP ${limpo.pmo}/${limpo.op} criada (${limpo.modo})${linhaIgnoradas ? ` · ${linhaIgnoradas}` : ''}`,
    dados: {
      modo: limpo.modo,
      trechos: limpo.trechos.map((t) => ({ codigo: t.codigo, compelsOp: t.compelsOp, snModo: t.snModo, postos: t.postos, faixas: t.faixas })),
      prtsIgnoradas: ignoradas.map((i) => ({ codigo: i.codigo, compelsOp: i.compelsOp, modo: i.modo })),
    },
  })
  revalidatePath('/shopfloor/ordens')
  revalidatePath('/shopfloor/ordens-nova')
  return { ok: true, id, pmo: limpo.pmo, op: limpo.op }
}

export type ResultadoUltimaOp = { ok: true; ultima: UltimaOp | null } | { ok: false; erro: string }

/** Os postos (com o trecho), componentes e burn-in da última OP da PMO. ultima null = a PMO ainda não tem OP; falha = ok:false. */
export async function ultimaOpDaPmoAction(pmo: string): Promise<ResultadoUltimaOp> {
  if (!(await sessaoAdmin())) return { ok: false, erro: SEM_PERMISSAO }
  try { return { ok: true, ultima: await ultimaOpDaPmo(String(pmo ?? '').trim()) } } catch { return { ok: false, erro: 'Não foi possível ler a última OP desta PMO.' } }
}
