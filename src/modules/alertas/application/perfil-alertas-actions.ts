'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { ehCanal, type ContaVinculada } from '../domain/tipos'
import { gerarCodigoVinculo, listarMinhasContas, desvincularConta } from '../infra/contas-repository'
import { criarDependenciasAlertas } from '../infra/fabrica'
import { enviarTeste } from './enviar-alertas'

const SEM_SESSAO = 'Sessão inválida. Entre de novo no sistema.'
const ROTA = '/perfil'

export async function gerarCodigoAction(): Promise<
  { ok: true; codigo: string; expiraEm: string } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  return gerarCodigoVinculo()
}

/** A tela consulta isso a cada 3 s enquanto o código está aberto. */
export async function minhasContasAction(): Promise<
  { ok: true; contas: ContaVinculada[] } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  try {
    return { ok: true, contas: await listarMinhasContas() }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar os vínculos agora.' }
  }
}

export async function desvincularAction(canal: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  if (!ehCanal(canal)) return { ok: false, erro: 'Canal inválido.' }
  try {
    await desvincularConta(canal)
  } catch {
    return { ok: false, erro: 'Não foi possível desvincular agora.' }
  }
  revalidatePath(ROTA)
  return { ok: true }
}

/**
 * Entrega DIRETA, fora da fila: a pessoa precisa ver o resultado na hora, e teste que falhou não é
 * reenviado. `enviarTeste` grava a linha já final em alerta_envios (tipo 'teste', tentativas 1).
 */
export async function enviarTesteAction(canal: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  if (!ehCanal(canal)) return { ok: false, erro: 'Canal inválido.' }
  try {
    const { portas, repo } = criarDependenciasAlertas()
    return await enviarTeste(portas, repo, {
      usuarioId: sessao.usuarioId,
      canal,
      nome: sessao.nome || sessao.email,
    })
  } catch (e) {
    console.error('[alertas] enviar teste:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível enviar o teste agora.' }
  }
}
