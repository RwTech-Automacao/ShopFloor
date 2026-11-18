import 'server-only'
import { clienteCompelsDoFaturamento } from '@/modules/faturamento/infra/compels'
import type { ClienteCompels } from '@/modules/compels/infra/cliente'
import { negocianteDoCnpj } from '@/modules/compels/domain/negociante'
import { digitosCnpj, formatarCnpj } from '../domain/cnpj'

/**
 * A empresa da nota pelo CNPJ no cadastro de negociantes do Compels (só leitura; spec
 * 2026-11-17-sat-entrada-por-nf-design.md, decisão 3). Tenta com a máscara (formato de quase todo o cadastro) e,
 * sem resultado, só os dígitos. `null` = não achou, CNPJ inválido, Compels fora do ar ou sem login neste
 * ambiente — a pessoa digita a empresa.
 */
export async function empresaDoCnpj(
  cnpj: string,
  cliente: Pick<ClienteCompels, 'buscarNegociantes'> | null = clienteCompelsDoFaturamento(),
): Promise<{ codigo: string; nome: string } | null> {
  const mascara = formatarCnpj(cnpj)
  if (!cliente || mascara === null) return null
  const digitos = digitosCnpj(cnpj)
  try {
    for (const forma of [mascara, digitos]) {
      const achado = negocianteDoCnpj(await cliente.buscarNegociantes(forma), digitos)
      if (achado) return achado
    }
    return null
  } catch (e) {
    console.error('[sat] empresa pelo CNPJ no Compels falhou:', e instanceof Error ? e.message : e)
    return null
  }
}
