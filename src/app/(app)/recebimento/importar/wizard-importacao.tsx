'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertTriangleIcon, CheckIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { importarPlanilha } from '@/modules/recebimento/application/importar-planilha'
import { lerPlanilha } from '@/modules/recebimento/domain/ler-planilha'
import { sugerirMapeamento, type CampoImportavel } from '@/modules/recebimento/domain/mapeamento'
import { validarLinha, type LinhaValidada } from '@/modules/recebimento/domain/validacao-linha'

const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024
const LINHAS_PREVIEW = 20
const SEM_MAPEAMENTO = '__sem_mapeamento__'

const PASSOS = [
  { numero: 1, rotulo: 'Selecionar' },
  { numero: 2, rotulo: 'Mapear' },
  { numero: 3, rotulo: 'Pré-visualização' },
  { numero: 4, rotulo: 'Importar' },
] as const

type NumeroPasso = (typeof PASSOS)[number]['numero']

type ResultadoImportacao =
  | { ok: true; importacaoId: string; total: number }
  | { ok: false; erro: string }

interface WizardImportacaoProps {
  campos: CampoImportavel[]
  itensPorLista: Record<string, string[]>
}

export function WizardImportacao({ campos, itensPorLista }: WizardImportacaoProps) {
  const [passo, setPasso] = useState<NumeroPasso>(1)

  const [arquivoNome, setArquivoNome] = useState('')
  const [formato, setFormato] = useState<'xlsx' | 'csv'>('xlsx')
  const [colunas, setColunas] = useState<string[]>([])
  const [linhasBrutas, setLinhasBrutas] = useState<Record<string, unknown>[]>([])
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({})
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [lendoArquivo, setLendoArquivo] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null)
  const [importando, startImportacao] = useTransition()

  async function processarArquivo(file: File) {
    setErroArquivo(null)

    const nome = file.name.toLowerCase()
    const extensao: 'xlsx' | 'csv' | null = nome.endsWith('.xlsx')
      ? 'xlsx'
      : nome.endsWith('.csv')
        ? 'csv'
        : null
    if (!extensao) {
      setErroArquivo('Formato não suportado. Envie um arquivo .xlsx ou .csv.')
      return
    }
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      setErroArquivo('Arquivo muito grande (máximo 20 MB).')
      return
    }

    setLendoArquivo(true)
    try {
      const { colunas: colunasLidas, linhas } = await lerPlanilha(file)
      if (colunasLidas.length === 0) {
        setErroArquivo('Não foi possível ler o arquivo. Verifique se ele não está corrompido, vazio ou em outro formato.')
        return
      }
      setArquivoNome(file.name)
      setFormato(extensao)
      setColunas(colunasLidas)
      setLinhasBrutas(linhas)
      setMapeamento(sugerirMapeamento(colunasLidas, campos))
      setResultado(null)
      setPasso(2)
    } finally {
      setLendoArquivo(false)
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void processarArquivo(file)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void processarArquivo(file)
  }

  const camposFaltando = useMemo(
    () => campos.filter((campo) => campo.obrigatorioImportacao && !mapeamento[campo.campo]),
    [campos, mapeamento],
  )

  const linhasValidadas: LinhaValidada[] = useMemo(() => {
    if (passo < 3) return []
    return linhasBrutas.map((linha) => {
      const linhaMapa: Record<string, unknown> = {}
      for (const campo of campos) {
        const coluna = mapeamento[campo.campo]
        linhaMapa[campo.campo] = coluna ? linha[coluna] : null
      }
      return validarLinha(linhaMapa, campos, itensPorLista)
    })
  }, [passo, linhasBrutas, campos, mapeamento, itensPorLista])

  const totalComErro = linhasValidadas.filter((linha) => linha.erros.length > 0).length
  const podeImportar = linhasBrutas.length > 0 && totalComErro === 0

  function onImportar() {
    setResultado(null)
    startImportacao(async () => {
      const linhas = linhasValidadas.map((linha) => linha.valores)
      const r = await importarPlanilha({ arquivoNome, formato, mapeamento, linhas })
      setResultado(r)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper passoAtual={passo} />

      {passo === 1 && (
        <PassoSelecionar
          inputRef={inputRef}
          lendoArquivo={lendoArquivo}
          erro={erroArquivo}
          onDrop={onDrop}
          onInputChange={onInputChange}
        />
      )}

      {passo === 2 && (
        <PassoMapear
          campos={campos}
          colunas={colunas}
          mapeamento={mapeamento}
          camposFaltando={camposFaltando}
          onMudarMapeamento={(campo, coluna) =>
            setMapeamento((atual) => ({ ...atual, [campo]: coluna }))
          }
          onVoltar={() => setPasso(1)}
          onProximo={() => setPasso(3)}
        />
      )}

      {passo === 3 && (
        <PassoPreview
          campos={campos}
          totalLinhas={linhasBrutas.length}
          linhasValidadas={linhasValidadas}
          totalComErro={totalComErro}
          podeAvancar={podeImportar}
          onVoltar={() => setPasso(2)}
          onProximo={() => setPasso(4)}
        />
      )}

      {passo === 4 && (
        <PassoImportar
          arquivoNome={arquivoNome}
          totalLinhas={linhasBrutas.length}
          importando={importando}
          resultado={resultado}
          onVoltar={() => setPasso(3)}
          onImportar={onImportar}
        />
      )}
    </div>
  )
}

function Stepper({ passoAtual }: { passoAtual: NumeroPasso }) {
  return (
    <ol className="flex items-center">
      {PASSOS.map((item, i) => {
        const concluido = item.numero < passoAtual
        const atual = item.numero === passoAtual
        return (
          <li key={item.numero} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ' +
                  (atual
                    ? 'bg-enterplak text-white'
                    : concluido
                      ? 'bg-enterplak-50 text-enterplak'
                      : 'bg-muted text-muted-foreground')
                }
              >
                {concluido ? <CheckIcon className="size-4" /> : item.numero}
              </span>
              <span
                className={
                  'text-sm whitespace-nowrap ' +
                  (atual ? 'font-medium text-enterplak' : 'text-muted-foreground')
                }
              >
                {item.rotulo}
              </span>
            </div>
            {i < PASSOS.length - 1 && (
              <div className={'mx-3 h-px flex-1 ' + (concluido ? 'bg-enterplak-50' : 'bg-border')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

interface PassoSelecionarProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  lendoArquivo: boolean
  erro: string | null
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function PassoSelecionar({ inputRef, lendoArquivo, erro, onDrop, onInputChange }: PassoSelecionarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-12 text-center transition-colors hover:border-enterplak hover:bg-enterplak-50/40"
      >
        <UploadIcon className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          {lendoArquivo ? 'Lendo arquivo...' : 'Arraste a planilha aqui ou clique para selecionar'}
        </p>
        <p className="text-xs text-muted-foreground">.xlsx ou .csv — máximo 20 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          disabled={lendoArquivo}
          onChange={onInputChange}
        />
      </div>
      {erro && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" /> {erro}
        </p>
      )}
    </div>
  )
}

interface PassoMapearProps {
  campos: CampoImportavel[]
  colunas: string[]
  mapeamento: Record<string, string>
  camposFaltando: CampoImportavel[]
  onMudarMapeamento: (campo: string, coluna: string) => void
  onVoltar: () => void
  onProximo: () => void
}

function PassoMapear({
  campos,
  colunas,
  mapeamento,
  camposFaltando,
  onMudarMapeamento,
  onVoltar,
  onProximo,
}: PassoMapearProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Confira a coluna da planilha correspondente a cada campo do sistema. Campos marcados com{' '}
        <span className="text-red-600">*</span> são obrigatórios para importar.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campo do sistema</TableHead>
            <TableHead>Coluna da planilha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campos.map((campo) => (
            <TableRow key={campo.campo}>
              <TableCell>
                {campo.rotulo}
                {campo.obrigatorioImportacao && <span className="text-red-600"> *</span>}
              </TableCell>
              <TableCell>
                <Select
                  value={mapeamento[campo.campo] ?? SEM_MAPEAMENTO}
                  onValueChange={(valor) =>
                    onMudarMapeamento(
                      campo.campo,
                      valor === null || valor === SEM_MAPEAMENTO ? '' : valor,
                    )
                  }
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Não mapear" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_MAPEAMENTO}>Não mapear</SelectItem>
                    {colunas.map((coluna) => (
                      <SelectItem key={coluna} value={coluna}>
                        {coluna}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {camposFaltando.length > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Faltam mapear campos obrigatórios: {camposFaltando.map((campo) => campo.rotulo).join(', ')}.
        </p>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onVoltar}>
          Voltar
        </Button>
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          disabled={camposFaltando.length > 0}
          onClick={onProximo}
        >
          Próximo
        </Button>
      </div>
    </div>
  )
}

interface PassoPreviewProps {
  campos: CampoImportavel[]
  totalLinhas: number
  linhasValidadas: LinhaValidada[]
  totalComErro: number
  podeAvancar: boolean
  onVoltar: () => void
  onProximo: () => void
}

function PassoPreview({
  campos,
  totalLinhas,
  linhasValidadas,
  totalComErro,
  podeAvancar,
  onVoltar,
  onProximo,
}: PassoPreviewProps) {
  const amostra = linhasValidadas.slice(0, LINHAS_PREVIEW)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {totalLinhas} linha{totalLinhas === 1 ? '' : 's'} na planilha
          {totalLinhas > LINHAS_PREVIEW ? ` (mostrando as primeiras ${LINHAS_PREVIEW})` : ''}.
        </span>
        {totalComErro > 0 ? (
          <Badge variant="destructive">
            {totalComErro} linha{totalComErro === 1 ? '' : 's'} com erro
          </Badge>
        ) : (
          totalLinhas > 0 && <Badge className="bg-green-100 text-green-800">Nenhum erro encontrado</Badge>
        )}
      </div>

      {totalLinhas === 0 && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" /> A planilha não tem nenhuma linha de dados.
        </p>
      )}

      {totalComErro > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Corrija os erros na planilha de origem e selecione o arquivo novamente. A importação é
          tudo-ou-nada: nenhum processo é criado enquanto houver linhas com erro.
        </p>
      )}

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              {campos.map((campo) => (
                <TableHead key={campo.campo}>{campo.rotulo}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {amostra.map((linha, i) => (
              // Linhas de preview não têm id estável antes da importação; o índice é seguro aqui
              // porque a lista é derivada e re-renderizada por completo a cada mudança de mapeamento.
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                {campos.map((campo) => {
                  const erro = linha.erros.find((e) => e.campo === campo.campo)
                  const valor = linha.valores[campo.campo]
                  return (
                    <TableCell
                      key={campo.campo}
                      title={erro?.erro}
                      className={erro ? 'bg-red-50 text-red-700' : undefined}
                    >
                      {erro ? erro.erro : (valor ?? '—')}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onVoltar}>
          Voltar
        </Button>
        <Button className="bg-enterplak hover:bg-enterplak-700" disabled={!podeAvancar} onClick={onProximo}>
          Próximo
        </Button>
      </div>
    </div>
  )
}

interface PassoImportarProps {
  arquivoNome: string
  totalLinhas: number
  importando: boolean
  resultado: ResultadoImportacao | null
  onVoltar: () => void
  onImportar: () => void
}

function PassoImportar({
  arquivoNome,
  totalLinhas,
  importando,
  resultado,
  onVoltar,
  onImportar,
}: PassoImportarProps) {
  if (resultado?.ok) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-10 text-center">
        <CheckIcon className="size-10 text-green-600" />
        <p className="text-lg font-medium text-green-800">
          {resultado.total} processo{resultado.total === 1 ? '' : 's'} criado
          {resultado.total === 1 ? '' : 's'}.
        </p>
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          render={<Link href="/recebimento/processos" />}
        >
          Ver processos
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Arquivo</p>
        <p className="font-medium">{arquivoNome}</p>
        <p className="mt-3 text-sm text-muted-foreground">Linhas a importar</p>
        <p className="font-medium">{totalLinhas}</p>
      </div>

      {resultado && !resultado.ok && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangleIcon className="size-4 shrink-0" /> {resultado.erro}
        </p>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onVoltar} disabled={importando}>
          Voltar
        </Button>
        <Button className="bg-enterplak hover:bg-enterplak-700" disabled={importando} onClick={onImportar}>
          {importando ? (
            <>
              <Loader2Icon className="size-4 animate-spin" /> Importando...
            </>
          ) : (
            'Importar'
          )}
        </Button>
      </div>
    </div>
  )
}
