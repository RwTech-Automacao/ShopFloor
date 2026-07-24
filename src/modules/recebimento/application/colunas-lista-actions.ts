'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { normalizarLayout } from '../domain/layout-colunas'
import { carregarCatalogoColunas, salvarColunasLista } from '../infra/processo-repository'

export type ResultadoLayout = { ok: true } | { ok: false; erro: string }

/**
 * Salva o layout das colunas do grid de Processos. Gate `administrar`. O catálogo é
 * carregado no SERVIDOR e é a whitelist: o cliente só diz **quais** campos quer visíveis
 * e **em que ordem** — o resto (ocultas, numeração, travas) o domínio deriva.
 */
export async function salvarLayoutColunas(visiveis: string[]): Promise<ResultadoLayout> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para alterar as colunas da lista.' }
  }

  try {
    const catalogo = await carregarCatalogoColunas()
    const layout = normalizarLayout(
      visiveis,
      catalogo.map((c) => c.campo),
    )
    await salvarColunasLista(layout)

    await registrarLog({
      entidade: 'colunas_lista',
      acao: 'alterar_campo',
      descricao: 'Colunas da lista de Processos alteradas',
      dados: { visiveis: layout.filter((c) => c.visivel).map((c) => c.campo) },
    })

    revalidatePath('/recebimento/processos')
    revalidatePath('/configuracoes/colunas')
    return { ok: true }
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o layout.' }
  }
}
