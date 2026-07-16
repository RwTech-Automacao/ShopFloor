'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import {
  atualizarItem,
  buscarItem,
  buscarListaPorId,
  camposQueUsamLista,
  criarItem,
  criarLista,
  excluirItem as excluirItemRepo,
  excluirLista as excluirListaRepo,
} from '../infra/lista-repository'

export type ResultadoAcaoLista = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para administrar listas.'
const CHAVE_VALIDA = /^[a-z0-9_]+$/

export async function salvarLista(
  _prev: ResultadoAcaoLista | undefined,
  formData: FormData,
): Promise<ResultadoAcaoLista> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const chave = String(formData.get('chave') ?? '').trim()
  const nome = String(formData.get('nome') ?? '').trim()

  if (!chave) return { erro: 'Informe a chave da lista.' }
  if (!CHAVE_VALIDA.test(chave)) {
    return { erro: 'A chave deve conter apenas letras minúsculas, números e sublinhado.' }
  }
  if (!nome) return { erro: 'Informe um nome para a lista.' }

  let nova: { id: string }
  try {
    nova = await criarLista({ chave, nome })
  } catch {
    return { erro: 'Não foi possível criar a lista. Verifique se a chave já está em uso.' }
  }

  await registrarLog({
    entidade: 'lista',
    entidadeId: nova.id,
    acao: 'criar',
    descricao: `Lista "${nome}" criada`,
    dados: { chave, nome },
  })

  revalidatePath('/configuracoes/listas')
  return { ok: true }
}

export async function excluirListaAction(id: string): Promise<ResultadoAcaoLista> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const alvo = await buscarListaPorId(id)
  if (!alvo) return { erro: 'Lista não encontrada.' }

  // A lista `resultado` é load-bearing: alimenta os status terminais dos
  // processos (lida por chave fixa, independente de campo).
  // Nunca pode ser excluída, mesmo que nenhum campo a referencie.
  if (alvo.chave === 'resultado') {
    return { erro: 'A lista "Resultado" define os status dos processos e não pode ser excluída.' }
  }

  // Lista em uso por um campo não pode ser excluída (esvaziaria o dropdown; se
  // for a lista `resultado`, quebraria os status). Bloqueia com aviso nomeando
  // o(s) campo(s) — em vez do erro cru de FK do banco.
  const usos = await camposQueUsamLista(alvo.chave)
  if (usos.length > 0) {
    return {
      erro: `Esta lista é usada pelo(s) campo(s): ${usos.join(', ')}. Remova a associação antes de excluir.`,
    }
  }

  try {
    await excluirListaRepo(id)
  } catch (e) {
    // ERRO_LISTA_BLOQUEADA_EXCLUSAO (0 linhas) agora só ocorre por RLS/permissão
    // ou lista já removida; e um erro de FK (corrida) também cai aqui. Mensagem
    // genérica em qualquer caso — a lista não foi apagada.
    void e
    return { erro: 'Não foi possível excluir a lista.' }
  }

  await registrarLog({
    entidade: 'lista',
    entidadeId: id,
    acao: 'excluir',
    descricao: `Lista "${alvo.nome}" excluída`,
  })

  revalidatePath('/configuracoes/listas')
  return { ok: true }
}

export async function salvarItem(
  _prev: ResultadoAcaoLista | undefined,
  formData: FormData,
): Promise<ResultadoAcaoLista> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const listaId = String(formData.get('listaId') ?? '').trim()
  const listaChave = String(formData.get('listaChave') ?? '').trim()
  const id = String(formData.get('id') ?? '').trim()
  const valor = String(formData.get('valor') ?? '').trim()
  const ordemTexto = String(formData.get('ordem') ?? '').trim()
  const ordem = ordemTexto ? Number(ordemTexto) : 0

  if (!listaId) return { erro: 'Lista inválida.' }
  if (!valor) return { erro: 'Informe um valor para o item.' }
  if (!Number.isFinite(ordem)) return { erro: 'Informe uma ordem válida.' }

  if (id) {
    const antes = await buscarItem(id)
    if (!antes) return { erro: 'Item não encontrado.' }

    const dados = { valor, ordem, ativo: antes.ativo }

    try {
      await atualizarItem(id, dados)
    } catch {
      return { erro: 'Não foi possível salvar o item. Verifique se o valor já existe nesta lista.' }
    }

    const diff = calcularDiff(
      antes as unknown as Record<string, unknown>,
      { ...antes, ...dados } as unknown as Record<string, unknown>,
      ['valor', 'ordem'],
    )
    await registrarLog({
      entidade: 'lista',
      entidadeId: id,
      acao: 'alterar_campo',
      descricao: `Item "${valor}" alterado`,
      dados: diff,
    })
  } else {
    let novo: { id: string }
    try {
      novo = await criarItem({ listaId, valor, ordem })
    } catch {
      return { erro: 'Não foi possível criar o item. Verifique se o valor já existe nesta lista.' }
    }

    await registrarLog({
      entidade: 'lista',
      entidadeId: novo.id,
      acao: 'criar',
      descricao: `Item "${valor}" criado`,
      dados: { listaId, valor, ordem },
    })
  }

  if (listaChave) revalidatePath(`/configuracoes/listas/${listaChave}`)
  return { ok: true }
}

export async function alternarItemAtivo(id: string): Promise<ResultadoAcaoLista> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const item = await buscarItem(id)
  if (!item) return { erro: 'Item não encontrado.' }

  const novoAtivo = !item.ativo
  try {
    await atualizarItem(id, { valor: item.valor, ordem: item.ordem, ativo: novoAtivo })
  } catch {
    return { erro: 'Não foi possível alterar o status do item.' }
  }

  await registrarLog({
    entidade: 'lista',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Item "${item.valor}" ${novoAtivo ? 'ativado' : 'desativado'}`,
  })

  const lista = await buscarListaPorId(item.lista_id)
  if (lista) revalidatePath(`/configuracoes/listas/${lista.chave}`)
  return { ok: true }
}

export async function excluirItemAction(id: string): Promise<ResultadoAcaoLista> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const item = await buscarItem(id)
  if (!item) return { erro: 'Item não encontrado.' }

  try {
    await excluirItemRepo(id)
  } catch {
    return { erro: 'Não foi possível excluir o item.' }
  }

  await registrarLog({
    entidade: 'lista',
    entidadeId: id,
    acao: 'excluir',
    descricao: `Item "${item.valor}" excluído`,
  })

  const lista = await buscarListaPorId(item.lista_id)
  if (lista) revalidatePath(`/configuracoes/listas/${lista.chave}`)
  return { ok: true }
}
