'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { AlertTriangleIcon, DownloadIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  conferirEtiquetasLegado,
  gerarEtiquetasLegado,
} from '@/modules/etiquetas/application/gerar-etiquetas-legado'
import { lerSaldoLocacoesXlsx } from '@/modules/etiquetas/domain/ler-saldo-locacoes'
import {
  LIMITE_LINHAS_LEGADO,
  avaliarLinhas,
  resumirPrevia,
  type LinhaAvaliada,
} from '@/modules/etiquetas/domain/partnumber-legado'

/** Teto de linhas DESENHADAS na prévia. A leva recomendada é uma coluna da prateleira por vez. */
const MAX_LINHAS_EXIBIDAS = 500

const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

interface ResultadoGeracao {
  totalEtiquetas: number
  ignoradas: number
  primeiro: string
  ultimo: string
  fileName: string
}

function dispararDownload(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** Selecionadas por padrão: tudo o que gera, MENOS o que já foi etiquetado nessa mesma posição
 *  (aí quem decide se é rolo novo ou repetição é o usuário, marcando a linha). */
function selecaoPadrao(avaliadas: LinhaAvaliada[]): Set<number> {
  return new Set(
    avaliadas
      .filter((l) => l.recusa === null && !l.avisos.includes('ja_etiquetada'))
      .map((l) => l.ordem),
  )
}

export function EtiquetasLegadoCliente() {
  const [arquivoNome, setArquivoNome] = useState('')
  const [avaliadas, setAvaliadas] = useState<LinhaAvaliada[] | null>(null)
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null)
  const [lendo, startLeitura] = useTransition()
  const [gerando, startGeracao] = useTransition()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const resumo = useMemo(() => (avaliadas ? resumirPrevia(avaliadas) : null), [avaliadas])
  const exibidas = useMemo(() => (avaliadas ?? []).slice(0, MAX_LINHAS_EXIBIDAS), [avaliadas])

  function limpar() {
    setAvaliadas(null)
    setSelecionadas(new Set())
    setArquivoNome('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function onEscolherArquivo(file: File | undefined) {
    setErro(null)
    setResultado(null)
    if (!file) return
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      setErro('A planilha passa de 20 MB.')
      return
    }
    setArquivoNome(file.name)
    startLeitura(async () => {
      // A planilha é lida no NAVEGADOR: o arquivo bruto não sobe, só (item, locação).
      const { linhas, erro: erroLeitura } = await lerSaldoLocacoesXlsx(file)
      if (erroLeitura) {
        setAvaliadas(null)
        setSelecionadas(new Set())
        setErro(erroLeitura)
        return
      }
      if (linhas.length > LIMITE_LINHAS_LEGADO) {
        setAvaliadas(null)
        setSelecionadas(new Set())
        setErro(
          `A planilha tem ${linhas.length} linhas (máximo ${LIMITE_LINHAS_LEGADO} por geração). ` +
            'Exporte por coluna da prateleira — é assim que a colagem funciona sem se perder.',
        )
        return
      }

      const conferencia = await conferirEtiquetasLegado(
        linhas.map((l) => ({ item: l.item, locacao: l.locacao })),
      )
      if (!conferencia.ok) {
        setAvaliadas(null)
        setSelecionadas(new Set())
        setErro(conferencia.erro)
        return
      }

      const avaliacao = avaliarLinhas(linhas, conferencia.conferencias)
      setAvaliadas(avaliacao)
      setSelecionadas(selecaoPadrao(avaliacao))
    })
  }

  function alternar(ordem: number, marcado: boolean) {
    setSelecionadas((atual) => {
      const proximo = new Set(atual)
      if (marcado) proximo.add(ordem)
      else proximo.delete(ordem)
      return proximo
    })
  }

  function gerar() {
    if (!avaliadas) return
    setErro(null)
    setResultado(null)
    const escolhidas = avaliadas.filter((l) => l.recusa === null && selecionadas.has(l.ordem))
    startGeracao(async () => {
      const res = await gerarEtiquetasLegado(
        escolhidas.map((l) => ({ item: l.item, locacao: l.locacao })),
      )
      if (!res.ok) {
        setErro(res.erro)
        return
      }
      dispararDownload(res.csv, res.fileName)
      setResultado({
        totalEtiquetas: res.totalEtiquetas,
        ignoradas: res.ignoradas,
        primeiro: res.codigos[0] ?? '',
        ultimo: res.codigos[res.codigos.length - 1] ?? '',
        fileName: res.fileName,
      })
      // Limpa a prévia: gerar duas vezes a mesma seleção gastaria etiquetas em dobro no mesmo rolo.
      limpar()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <Label htmlFor="planilha-saldo">Planilha do ERP (Saldo por Locação, .xlsx)</Label>
        {/* Input nativo (como o wizard de importação): é só um seletor de arquivo. */}
        <input
          id="planilha-saldo"
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          disabled={lendo || gerando}
          onChange={(e) => onEscolherArquivo(e.target.files?.[0])}
          className="max-w-md text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {lendo
            ? 'Lendo a planilha e conferindo o que já foi etiquetado...'
            : arquivoNome || 'Exporte uma coluna da prateleira por vez e cole as etiquetas na ordem do arquivo.'}
        </p>
      </div>

      {erro && (
        <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      )}

      {resultado && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p>
            Geradas <strong>{resultado.totalEtiquetas}</strong> etiqueta(s) —{' '}
            <span className="font-mono">{resultado.primeiro}</span> até{' '}
            <span className="font-mono">{resultado.ultimo}</span>.
          </p>
          <p className="mt-1">
            Arquivo <span className="font-mono">{resultado.fileName}</span> baixado. Cole as
            etiquetas na ordem do arquivo.
          </p>
          {resultado.ignoradas > 0 && (
            <p className="mt-1">{resultado.ignoradas} linha(s) ignorada(s) por código de item inválido.</p>
          )}
        </div>
      )}

      {avaliadas && resumo && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span>
              <strong>{resumo.aEtiquetar}</strong> linha(s) podem gerar etiqueta
            </span>
            {resumo.recusadas > 0 && (
              <span className="text-red-700">
                {resumo.recusadas} recusada(s)
                {resumo.semItem > 0 && ` · ${resumo.semItem} sem código de item`}
                {resumo.itemComSeparador > 0 && ` · ${resumo.itemComSeparador} com separador no código`}
              </span>
            )}
            {resumo.jaEtiquetadas > 0 && (
              <span className="text-amber-700">{resumo.jaEtiquetadas} já etiquetada(s) nesta posição</span>
            )}
            {resumo.repetidasNaPlanilha > 0 && (
              <span className="text-amber-700">{resumo.repetidasNaPlanilha} repetida(s) na planilha</span>
            )}
            {resumo.locacaoMalformada > 0 && (
              <span className="text-amber-700">{resumo.locacaoMalformada} com locação fora do padrão</span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelecionadas(selecaoPadrao(avaliadas))}>
                Marcar as novas
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelecionadas(new Set(avaliadas.filter((l) => l.recusa === null).map((l) => l.ordem)))
                }
              >
                Marcar todas as válidas
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelecionadas(new Set())}>
                Limpar seleção
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">
              {selecionadas.size} selecionada(s) de {avaliadas.length} linha(s)
              {avaliadas.length > MAX_LINHAS_EXIBIDAS && ` · mostrando as ${MAX_LINHAS_EXIBIDAS} primeiras`}
            </span>
          </div>

          {/* Tela de gestor, usada no desktop: uma tabela só, com rolagem lateral no que for estreito. */}
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Linha</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Locação</TableHead>
                  <TableHead>Código previsto</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exibidas.map((l) => (
                  <TableRow key={l.ordem}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar a linha ${l.linhaPlanilha} (${l.item || 'sem código'})`}
                        checked={selecionadas.has(l.ordem)}
                        disabled={l.recusa !== null}
                        onChange={(e) => alternar(l.ordem, e.target.checked)}
                        className="accent-enterplak"
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.linhaPlanilha}</TableCell>
                    <TableCell className="font-medium">{l.item || '—'}</TableCell>
                    <TableCell className="max-w-80 truncate text-sm text-muted-foreground" title={l.descricao}>
                      {l.descricao || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.locacao || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{l.codigoPrevisto || '—'}</TableCell>
                    <TableCell>
                      <Situacao linha={l} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            O número do código é atribuído na geração: se outra pessoa gerar antes, o seu continua
            do número seguinte — nunca repete.
          </p>

          <div className="flex items-center gap-3">
            <Button
              onClick={gerar}
              disabled={gerando || selecionadas.size === 0}
              className="bg-enterplak hover:bg-enterplak-700"
            >
              <DownloadIcon className="size-4" />
              {gerando ? 'Gerando...' : `Gerar ${selecionadas.size} etiqueta(s) (CSV)`}
            </Button>
            <Button variant="outline" onClick={limpar} disabled={gerando}>
              Descartar planilha
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** O que a prévia diz da linha: recusa (não gera) ou avisos (gera, mas confira). */
function Situacao({ linha }: { linha: LinhaAvaliada }) {
  if (linha.recusa === 'sem_item') {
    return <Badge className="bg-red-100 text-red-700">Sem código de item</Badge>
  }
  if (linha.recusa === 'item_com_separador') {
    return <Badge className="bg-red-100 text-red-700">Código com separador</Badge>
  }
  if (linha.avisos.length === 0) {
    return <Badge className="bg-emerald-100 text-emerald-700">Nova</Badge>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {linha.avisos.includes('ja_etiquetada') && (
        <Badge className="bg-amber-100 text-amber-800">
          Já etiquetada
          {linha.ultimaNaLocacao && ` em ${formatadorData.format(new Date(linha.ultimaNaLocacao))}`}
        </Badge>
      )}
      {linha.avisos.includes('repetida_na_planilha') && (
        <Badge className="bg-amber-100 text-amber-800">Repetida na planilha</Badge>
      )}
      {linha.avisos.includes('locacao_malformada') && (
        <Badge className="bg-amber-100 text-amber-800">Locação fora do padrão</Badge>
      )}
    </span>
  )
}
