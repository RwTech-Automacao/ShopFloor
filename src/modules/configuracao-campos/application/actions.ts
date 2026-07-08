'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { validarTipoCampo, type TipoCampo } from '../domain/regras-campo'
import { atualizarCampo, buscarCampo, type DadosCampo } from '../infra/campo-repository'

export type ResultadoAcaoCampo = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para administrar campos.'
const TIPOS_VALIDOS: TipoCampo[] = ['texto', 'lista', 'numero', 'data']

const CAMPOS_DIFF = [
  'rotulo',
  'tipo',
  'lista_chave',
  'obrigatorio_importacao',
  'obrigatorio_finalizacao',
  'ordem',
  'ativo',
]

export async function salvarCampo(
  _prev: ResultadoAcaoCampo | undefined,
  formData: FormData,
): Promise<ResultadoAcaoCampo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { erro: 'Campo inválido.' }

  const antes = await buscarCampo(id)
  if (!antes) return { erro: 'Campo não encontrado.' }

  const rotulo = String(formData.get('rotulo') ?? '').trim()
  if (!rotulo) return { erro: 'Informe um rótulo para o campo.' }

  const tipoBruto = String(formData.get('tipo') ?? antes.tipo)
  const tipoSubmetido: TipoCampo = TIPOS_VALIDOS.includes(tipoBruto as TipoCampo)
    ? (tipoBruto as TipoCampo)
    : antes.tipo

  const listaChaveBruta = String(formData.get('lista_chave') ?? '').trim()
  const listaChave = listaChaveBruta ? listaChaveBruta : null

  // Regra de negócio central desta tela: campos numero/data têm tipo fixo, e
  // tipo=lista exige lista_chave preenchida. Validado aqui (server-side) —
  // não confiamos apenas na UI do formulário.
  const validacao = validarTipoCampo({
    tipoAtual: antes.tipo,
    tipoSubmetido,
    listaChave,
  })
  if (!validacao.ok) return { erro: validacao.erro }

  const ordemTexto = String(formData.get('ordem') ?? '').trim()
  const ordem = ordemTexto ? Number(ordemTexto) : antes.ordem
  if (!Number.isFinite(ordem)) return { erro: 'Informe uma ordem válida.' }

  const dados: DadosCampo = {
    rotulo,
    tipo: validacao.tipo,
    lista_chave: validacao.tipo === 'lista' ? listaChave : null,
    obrigatorio_importacao: formData.get('obrigatorio_importacao') === 'on',
    obrigatorio_finalizacao: formData.get('obrigatorio_finalizacao') === 'on',
    ordem,
    ativo: formData.get('ativo') === 'on',
  }

  try {
    await atualizarCampo(id, dados)
  } catch {
    return { erro: 'Não foi possível salvar o campo.' }
  }

  const diff = calcularDiff(
    antes as unknown as Record<string, unknown>,
    { ...antes, ...dados } as unknown as Record<string, unknown>,
    CAMPOS_DIFF,
  )
  await registrarLog({
    entidade: 'campo',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Campo "${dados.rotulo}" alterado`,
    dados: diff,
  })

  revalidatePath('/configuracoes/campos')
  return { ok: true }
}
