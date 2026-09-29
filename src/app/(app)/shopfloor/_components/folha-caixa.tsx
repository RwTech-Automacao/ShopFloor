'use client'

import { useEffect } from 'react'
import type { OpComCaixa, CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'

/** Pares QTD|NS por linha da folha — é o formato da planilha que a fábrica usa hoje. */
const PARES = 3

export const fmtEmissao = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** O que a folha impressa precisa saber. Montado no clique (nunca durante o render).
 *  Dois QRs convivem na folha: `qrSvg` é a lista de SNs (conferência pelo celular, uso de hoje) e
 *  `qrCodigoSvg` é só o código final da caixa (o que o leitor de mão do Almoxarifado bipa). Cada um
 *  tem seu próprio aviso de erro — um QR faltando não impede a folha de sair com o outro. */
export interface Folha {
  caixa: CaixaConsulta
  base: number // peças embaladas antes desta caixa (o "QTD" começa em base+1)
  qrSvg: string | null
  aviso: string | null
  qrCodigoSvg: string | null
  avisoCodigo: string | null
  emitidoEm: string
}

/**
 * Nome sugerido do arquivo em "Salvar como PDF" — o navegador usa o TÍTULO DO DOCUMENTO. Leva o
 * código da caixa, que já carrega sequência, quantidade, OP e PMO (ex.: CX[1][12]8492-PMOD55).
 * Os caracteres proibidos em nome de arquivo saem; os colchetes do código são permitidos.
 */
export function nomeDoArquivo(codigo: string): string {
  return codigo.replace(/[/\\:*?"<>|]/g, '-').trim() || 'caixa'
}

/**
 * Resolve quando as imagens terminaram de carregar — ou falharam, ou passou `limiteMs`. Logo que não
 * carrega não pode travar a impressão: melhor a folha sem logo do que botão que não faz nada.
 */
function imagensCarregadas(imgs: Iterable<HTMLImageElement>, limiteMs = 3000): Promise<void> {
  const cargas = [...imgs].map((img) =>
    img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined),
  )
  const limite = new Promise<void>((ok) => window.setTimeout(ok, limiteMs))
  return Promise.race([Promise.all(cargas).then(() => undefined), limite])
}

/**
 * Orquestra a impressão da folha: assim que `folha` aparece, espera um quadro pro navegador
 * desenhar, espera o LOGO carregar (sem essa espera ele saía em branco na 1ª impressão da sessão —
 * a imagem só começa a baixar quando a folha monta, e 60ms não bastam) e chama `window.print()`.
 * Ao terminar (`afterprint`), tira a folha do DOM via `setFolha(null)`.
 *
 * Compartilhado entre a tela "Consultar Caixa" (impressão sob pedido) e o posto de Embalagem
 * (impressão automática ao fechar a caixa) — o comportamento é o mesmo nos dois.
 */
export function useImpressaoFolha(folha: Folha | null, setFolha: (f: Folha | null) => void) {
  useEffect(() => {
    if (!folha) return
    const tituloOriginal = document.title
    document.title = nomeDoArquivo(folha.caixa.codigo)
    const fim = () => setFolha(null)
    window.addEventListener('afterprint', fim, { once: true })
    let cancelado = false
    const t = window.setTimeout(async () => {
      await imagensCarregadas(document.querySelectorAll<HTMLImageElement>('[data-folha-caixa] img'))
      if (!cancelado) window.print()
    }, 60)
    return () => {
      cancelado = true
      window.clearTimeout(t)
      window.removeEventListener('afterprint', fim)
      document.title = tituloOriginal
    }
  }, [folha, setFolha])
}

/**
 * A folha de papel. Só existe no DOM enquanto imprime e só aparece na impressão (`hidden
 * print:block`) — a tela continua sendo a de consulta (ou a de embalagem). Espelha a planilha
 * "Lista de Números de Série" que a fábrica usa hoje: faixa do produto, dados da OP, grade de
 * pares QTD|NS, o QR Code com a lista de SNs e, ao lado, o QR pequeno do código final da caixa
 * (com o código também em texto, pra conferir a olho se o leitor de mão falhar).
 */
export function FolhaCaixa({ folha, ordem }: { folha: Folha; ordem: OpComCaixa }) {
  const { caixa, base, qrSvg, aviso, qrCodigoSvg, avisoCodigo, emitidoEm } = folha
  // Grade balanceada: enche a 1ª coluna de cima a baixo, depois a 2ª, depois a 3ª — mesma ordem de
  // leitura da planilha antiga, mas sem as dezenas de linhas em branco do gabarito.
  const porColuna = Math.ceil(caixa.sns.length / PARES)
  const linhas = Array.from({ length: porColuna }, (_, r) =>
    Array.from({ length: PARES }, (_, c) => {
      const i = c * porColuna + r
      return i < caixa.sns.length ? { qtd: base + i + 1, sn: caixa.sns[i]! } : null
    }),
  )

  return (
    <div data-folha-caixa className="hidden text-black print:block print:p-[12mm]">
      {/* Logo à esquerda e título centralizado na folha: o <h1> ocupa o espaço todo e o logo fica
          por cima, no canto — assim o título não desloca por causa da largura da marca.
          `<img>` cru em vez de next/image: isto é impressão, não precisa de otimização nem lazy,
          e o loader do next/image atrapalharia o carregamento antes do window.print(). */}
      <div className="relative mb-2 flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- folha de impressão */}
        <img src="/Logo_Docs.png" alt="Enterplak" className="absolute left-0 h-[10mm] w-auto" />
        <h1 className="w-full text-center text-[15px] font-semibold">Lista de Números de Série</h1>
      </div>

      <div className="border border-black">
        <div className="flex items-center gap-3 border-b border-black bg-enterplak px-3 py-1.5 text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
          <span className="text-[11px] uppercase text-[#e3bcc4]">Produto</span>
          <span className="text-[13px] font-bold">
            {ordem.descricao ? `${ordem.descricao} — ${ordem.pmo}` : ordem.pmo}
          </span>
        </div>
        <dl className="grid grid-cols-3 text-[11px]">
          <Campo rotulo="Cliente" valor={ordem.cliente || '—'} />
          <Campo rotulo="OP" valor={ordem.op} />
          <Campo rotulo="Quantidade da OP" valor={ordem.qtdOp != null ? String(ordem.qtdOp) : '—'} />
          <Campo rotulo="Caixa" valor={caixa.codigo} />
          <Campo rotulo="Posto" valor={caixa.posto} />
          <Campo rotulo="Peças nesta caixa" valor={`${caixa.qtd}${caixa.fechada ? '' : ' (caixa aberta)'}`} />
        </dl>
      </div>

      <table className="mt-2 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {Array.from({ length: PARES }, (_, c) => (
              <ColunaCabecalho key={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, r) => (
            <tr key={r}>
              {linha.map((celula, c) => (
                <Celula key={c} celula={celula} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex items-start gap-3 break-inside-avoid border border-black p-3">
        <span className="text-[11px] font-semibold">QR Code:</span>
        {qrSvg ? (
          // 90mm: com 120 SNs cada módulo do QR saía com 0,25mm no quadro antigo de 120px (~32mm) —
          // denso demais pra câmera. Aqui, já contando a zona de silêncio, fica ~0,65mm com 120 SNs e ~0,5mm no limite de 192.
          <div className="size-[90mm] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <span className="text-[11px]">{aviso ?? 'não gerado'}</span>
        )}

        {/* QR pequeno do CÓDIGO da caixa — é o que o leitor de mão do Almoxarifado bipa na entrada.
            Convive com o QR grande acima (que continua sendo a lista de SNs pro celular); o código
            some por baixo em fonte monoespaçada pra conferir a olho se o leitor falhar. */}
        <div className="ml-3 flex shrink-0 flex-col items-center gap-1 border-l border-black pl-3">
          {qrCodigoSvg ? (
            <div className="size-[20mm] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrCodigoSvg }} />
          ) : (
            <span className="w-[20mm] text-center text-[9px]">{avisoCodigo ?? 'não gerado'}</span>
          )}
          <span className="font-mono text-[9px]">{caixa.codigo}</span>
        </div>

        <span className="ml-auto self-end text-[9px]">Emitido em {emitidoEm}</span>
      </div>
    </div>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 border-b border-r border-black px-3 py-1">
      <dt className="text-[9px] uppercase text-neutral-600">{rotulo}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  )
}

/** Cabeçalho de um par de colunas. Fica no <thead> pra repetir em cada folha da impressão. */
function ColunaCabecalho() {
  return (
    <>
      <th className="w-[8%] border border-black px-1 py-0.5 text-center font-semibold">#</th>
      <th className="w-[25%] border border-black px-1 py-0.5 text-center font-semibold">NS</th>
    </>
  )
}

function Celula({ celula }: { celula: { qtd: number; sn: string } | null }) {
  return (
    <>
      <td className="border border-black px-1 py-0.5 text-center tabular-nums">{celula?.qtd ?? ''}</td>
      <td className="border border-black px-1 py-0.5 text-center font-mono">{celula?.sn ?? ''}</td>
    </>
  )
}
