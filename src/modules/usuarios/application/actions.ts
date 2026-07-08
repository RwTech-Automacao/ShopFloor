'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { buscarPerfil } from '@/modules/perfis/infra/perfil-repository'
import { validarAcaoUsuario } from '../domain/regras-usuario'
import {
  atualizarSenha,
  atualizarUsuario,
  buscarUsuario,
  criarUsuarioAuth,
} from '../infra/usuario-admin-repository'

export type ResultadoAcaoUsuario = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para administrar usuários.'
const CAMPOS_DIFF = ['nome', 'perfil_id', 'ativo']

// Traduz erros da API admin do Supabase Auth para mensagens amigáveis em
// pt-BR — nunca expor a mensagem crua da API ao usuário final.
function traduzirErroAdminApi(e: unknown): string {
  const codigo =
    e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined

  switch (codigo) {
    case 'email_exists':
    case 'user_already_exists':
      return 'Este e-mail já está cadastrado.'
    case 'weak_password':
      return 'Senha muito fraca. Use ao menos 6 caracteres.'
    case 'email_address_invalid':
      return 'Informe um e-mail válido.'
    default:
      return 'Não foi possível criar o usuário. Verifique os dados e tente novamente.'
  }
}

export async function criarUsuario(
  _prev: ResultadoAcaoUsuario | undefined,
  formData: FormData,
): Promise<ResultadoAcaoUsuario> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const nome = String(formData.get('nome') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const senha = String(formData.get('senha') ?? '')
  const perfilId = String(formData.get('perfilId') ?? '').trim()

  if (!nome) return { erro: 'Informe um nome.' }
  if (!email || !email.includes('@')) return { erro: 'Informe um e-mail válido.' }
  if (senha.length < 6) return { erro: 'A senha deve ter ao menos 6 caracteres.' }
  if (!perfilId) return { erro: 'Selecione um perfil.' }

  let novoId: string
  try {
    const criado = await criarUsuarioAuth({ email, password: senha, nome })
    novoId = criado.id
  } catch (e) {
    return { erro: traduzirErroAdminApi(e) }
  }

  try {
    await atualizarUsuario(novoId, { nome, perfilId, ativo: true })
  } catch {
    return { erro: 'Usuário criado, mas não foi possível concluir a configuração do perfil.' }
  }

  await registrarLog({
    entidade: 'usuario',
    entidadeId: novoId,
    acao: 'criar',
    descricao: `Usuário "${nome}" (${email}) criado`,
    dados: { nome, email, perfilId },
  })

  revalidatePath('/configuracoes/usuarios')
  return { ok: true }
}

export async function editarUsuario(
  _prev: ResultadoAcaoUsuario | undefined,
  formData: FormData,
): Promise<ResultadoAcaoUsuario> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const id = String(formData.get('id') ?? '').trim()
  const nome = String(formData.get('nome') ?? '').trim()
  const perfilId = String(formData.get('perfilId') ?? '').trim()
  const ativo = formData.get('ativo') === 'on'

  if (!id) return { erro: 'Usuário inválido.' }
  if (!nome) return { erro: 'Informe um nome.' }
  if (!perfilId) return { erro: 'Selecione um perfil.' }

  const antes = await buscarUsuario(id)
  if (!antes) return { erro: 'Usuário não encontrado.' }

  const perfilAlvo = await buscarPerfil(perfilId)
  if (!perfilAlvo) return { erro: 'Perfil selecionado não encontrado.' }

  const validacao = validarAcaoUsuario({
    usuarioAlvoId: id,
    usuarioLogadoId: sessao.usuarioId,
    novoAtivo: ativo,
    perfilAlvoTemAdministrar: perfilAlvo.pode_administrar,
  })
  if (!validacao.ok) return { erro: validacao.erro }

  try {
    await atualizarUsuario(id, { nome, perfilId, ativo })
  } catch {
    return { erro: 'Não foi possível salvar o usuário.' }
  }

  const diff = calcularDiff(
    { nome: antes.nome, perfil_id: antes.perfis.id, ativo: antes.ativo },
    { nome, perfil_id: perfilId, ativo },
    CAMPOS_DIFF,
  )
  await registrarLog({
    entidade: 'usuario',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Usuário "${nome}" alterado`,
    dados: diff,
  })

  revalidatePath('/configuracoes/usuarios')
  return { ok: true }
}

export async function redefinirSenha(id: string, password: string): Promise<ResultadoAcaoUsuario> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  if (password.length < 6) return { erro: 'A senha deve ter ao menos 6 caracteres.' }

  try {
    await atualizarSenha(id, password)
  } catch (e) {
    return { erro: traduzirErroAdminApi(e) }
  }

  // Nunca registrar o valor da senha no log de auditoria.
  await registrarLog({
    entidade: 'usuario',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: 'Senha redefinida',
  })

  revalidatePath('/configuracoes/usuarios')
  return { ok: true }
}

export async function alternarAtivo(id: string, novoAtivo: boolean): Promise<ResultadoAcaoUsuario> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const alvo = await buscarUsuario(id)
  if (!alvo) return { erro: 'Usuário não encontrado.' }

  const validacao = validarAcaoUsuario({
    usuarioAlvoId: id,
    usuarioLogadoId: sessao.usuarioId,
    novoAtivo,
    perfilAlvoTemAdministrar: alvo.perfis.pode_administrar,
  })
  if (!validacao.ok) return { erro: validacao.erro }

  try {
    await atualizarUsuario(id, { nome: alvo.nome, perfilId: alvo.perfis.id, ativo: novoAtivo })
  } catch {
    return { erro: 'Não foi possível alterar o status do usuário.' }
  }

  await registrarLog({
    entidade: 'usuario',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Usuário "${alvo.nome}" ${novoAtivo ? 'ativado' : 'desativado'}`,
  })

  revalidatePath('/configuracoes/usuarios')
  return { ok: true }
}
