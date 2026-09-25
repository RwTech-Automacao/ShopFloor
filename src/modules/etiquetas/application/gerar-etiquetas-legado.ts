'use server'

import { refresh } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { gerarCsv } from '../domain/partnumber'
import {
  LIMITE_LINHAS_LEGADO,
  linhasDoArquivoLegado,
  normalizarItem,
  normalizarLocacao,
  recusaDoItem,
  type ConferenciaLegado,
} from '../domain/partnumber-legado'
import {
  conferirParesLegado,
  emitirEtiquetasLegado,
  type ParLegado,
} from '../infra/etiqueta-legado-repository'

/**
 * Ações da ETIQUETAGEM DO ESTOQUE LEGADO (mutirão — ver a spec e a migração 0126).
 *
 * O navegador lê a planilha e manda só pares (item, locação): a planilha bruta nunca sobe. O
 * servidor revalida cada par (nunca confia no cliente), o BANCO atribui o sequencial e o arquivo
 * sai pelo mesmo `gerarCsv` das etiquetas de hoje — mesmo formato, mesma impressora.
 *
 * As duas ações exigem `recebimento: gerar_etiqueta`, além do gate da própria tela.
 */

export type ResultadoConferirLegado =
  | { ok: true; conferencias: ConferenciaLegado[] }
  | { ok: false; erro: string }

export type ResultadoGerarLegado =
  | {
      ok: true
      csv: string
      fileName: string
      totalEtiquetas: number
      /** Linhas descartadas na revalidação do servidor (item vazio ou com separador). */
      ignoradas: number
      /** As etiquetas emitidas, na ordem da planilha, para a tela mostrar o que foi impresso. */
      codigos: string[]
    }
  | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerar etiquetas.'

/**
 * Carimbo de data/hora no nome do arquivo, no fuso de Brasília (o servidor roda em UTC).
 *
 * Cópia deliberada do mesmo helper em `gerar-etiquetas.ts`: esta é uma ferramenta de mutirão, que
 * deve poder ser removida inteira sem tocar na geração de etiquetas do material novo. Um arquivo
 * `use server` só pode exportar funções async, então não dá para compartilhar o helper de lá.
 */
function carimboDataHora(agora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${parte('year')}${parte('month')}${parte('day')}_${parte('hour')}${parte('minute')}${parte('second')}`
}

/** Normaliza e joga fora o que o Setup não conseguiria ler (item vazio ou com separador). */
function paresValidos(linhas: ParLegado[]): { pares: ParLegado[]; ignoradas: number } {
  const pares: ParLegado[] = []
  let ignoradas = 0
  for (const linha of linhas) {
    const item = normalizarItem(linha?.item)
    if (recusaDoItem(item)) {
      ignoradas += 1
      continue
    }
    pares.push({ item, locacao: normalizarLocacao(linha?.locacao) })
  }
  return { pares, ignoradas }
}

/**
 * Prévia: para os pares da planilha, o que já foi etiquetado (quantas vezes e quando) e onde o
 * contador de cada item está. Quem decide se é rolo novo ou repetição é o usuário.
 */
export async function conferirEtiquetasLegado(linhas: ParLegado[]): Promise<ResultadoConferirLegado> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'gerar_etiqueta')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return { ok: false, erro: 'A planilha não tem nenhuma linha para conferir.' }
  }
  if (linhas.length > LIMITE_LINHAS_LEGADO) {
    return { ok: false, erro: `A planilha tem mais de ${LIMITE_LINHAS_LEGADO} linhas. Gere por coluna da prateleira.` }
  }

  const { pares } = paresValidos(linhas)
  if (pares.length === 0) return { ok: true, conferencias: [] }

  return { ok: true, conferencias: await conferirParesLegado(pares) }
}

/**
 * Gera as etiquetas das linhas selecionadas, NA ORDEM em que vieram (é a ordem da planilha, e é a
 * ordem em que as etiquetas vão ser coladas na prateleira).
 *
 * O sequencial é atribuído pelo banco, contínuo por item e para sempre — se duas gerações
 * acontecerem ao mesmo tempo, uma espera a outra. Nenhum código é reaproveitado, nem quando a
 * mesma planilha é subida duas vezes: aí o resultado é um rolo com duas etiquetas (desperdício
 * visível), nunca dois rolos com a mesma.
 */
export async function gerarEtiquetasLegado(linhas: ParLegado[]): Promise<ResultadoGerarLegado> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'gerar_etiqueta')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return { ok: false, erro: 'Selecione ao menos uma linha.' }
  }
  if (linhas.length > LIMITE_LINHAS_LEGADO) {
    return { ok: false, erro: `Máximo de ${LIMITE_LINHAS_LEGADO} etiquetas por geração. Gere por coluna da prateleira.` }
  }

  const { pares, ignoradas } = paresValidos(linhas)
  if (pares.length === 0) {
    return { ok: false, erro: 'Nenhuma linha válida: todas estão sem código de item ou com separador no código.' }
  }

  const emitidas = await emitirEtiquetasLegado(pares)
  const linhasArquivo = linhasDoArquivoLegado(emitidas)
  const csv = gerarCsv(linhasArquivo)
  const fileName = `Etiquetas_legado_${carimboDataHora(new Date())}.csv`

  await registrarLog({
    entidade: 'etiqueta_legado',
    acao: 'gerar_etiqueta',
    descricao: `Geração de ${linhasArquivo.length} etiqueta(s) do estoque legado`,
    dados: {
      totalEtiquetas: linhasArquivo.length,
      ignoradas,
      primeiro: linhasArquivo[0]?.partNumber ?? '',
      ultimo: linhasArquivo[linhasArquivo.length - 1]?.partNumber ?? '',
    },
  })

  // A tela mostra o progresso do mutirão ("já etiquetados: N rolos"), que acabou de mudar.
  refresh()

  return {
    ok: true,
    csv,
    fileName,
    totalEtiquetas: linhasArquivo.length,
    ignoradas,
    codigos: linhasArquivo.map((l) => l.partNumber),
  }
}
