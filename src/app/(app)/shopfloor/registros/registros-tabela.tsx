'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { RegistroRow } from '@/modules/shopfloor/infra/registros-repository'
import { cancelavelInfo, cancelarLancamento } from '@/modules/shopfloor/application/cancelamento-actions'

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  // Fuso fixo de Brasília: os timestamps vêm em UTC do banco e estas telas
  // renderizam no servidor (UTC na Vercel). Sem isto, os horários apareceriam
  // 3h à frente em produção.
  timeZone: 'America/Sao_Paulo',
})

function formatarDataHora(valor: string): string {
  return formatadorData.format(new Date(valor))
}

function classePorStatus(status: string): string {
  const s = status.trim().toLowerCase()
  if (s === 'aprovado') return 'bg-green-100 text-green-800'
  if (s === 'reprovado') return 'bg-red-100 text-red-800'
  return ''
}

function rotuloStatus(status: string): string {
  return status.trim() || 'Sem status'
}

function valorOuTraco(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  return String(valor)
}

interface CampoDetalheProps {
  rotulo: string
  valor: string | number | null | undefined
}

function CampoDetalhe({ rotulo, valor }: CampoDetalheProps) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1">{valorOuTraco(valor)}</dd>
    </div>
  )
}

/** Campo opcional: omite a linha inteira quando o valor é vazio/nulo (sem "—"). */
function linha(rotulo: string, valor: string | number | null | undefined) {
  if (valor === null || valor === undefined || valor === '') return null
  return (
    <div className="flex gap-2" key={rotulo}>
      <dt className="w-32 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1">{valor}</dd>
    </div>
  )
}

interface RegistrosTabelaProps {
  linhas: RegistroRow[]
  podeAdministrar: boolean
}

export function RegistrosTabela({ linhas, podeAdministrar }: RegistrosTabelaProps) {
  const [sel, setSel] = useState<RegistroRow | null>(null)
  const [checando, setChecando] = useState(false)
  const [cancelavel, setCancelavel] = useState<{ podeCancelar: boolean; motivo?: string } | null>(null)
  const [confirmAberto, setConfirmAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [erroCancel, setErroCancel] = useState('')
  const router = useRouter()

  // Ao abrir o detalhe de um registro (e sendo gestor), checa no servidor se dá pra cancelar.
  useEffect(() => {
    if (!sel || !podeAdministrar) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCancelavel(null)
      return
    }
    let vivo = true
    setChecando(true)
    setCancelavel(null)
    cancelavelInfo(sel.id)
      .then((r) => { if (vivo) setCancelavel(r) })
      .catch(() => { if (vivo) setCancelavel({ podeCancelar: false, motivo: 'Não foi possível verificar.' }) })
      .finally(() => { if (vivo) setChecando(false) })
    return () => { vivo = false }
  }, [sel, podeAdministrar])

  function abrirConfirm() {
    setMotivo(''); setErroCancel(''); setConfirmAberto(true)
  }
  async function confirmarCancelamento() {
    if (!sel || motivo.trim() === '' || cancelando) return
    setCancelando(true); setErroCancel('')
    const r = await cancelarLancamento(sel.id, motivo)
    setCancelando(false)
    if (r.ok) {
      setConfirmAberto(false); setSel(null)
      router.refresh() // re-busca a lista (o bipe some)
    } else {
      setErroCancel(r.erro)
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/Hora</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>PMO·OP</TableHead>
              <TableHead>Posto</TableHead>
              <TableHead>SN</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Colaborador</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((l) => (
              <TableRow
                key={l.id}
                className="cursor-pointer"
                onClick={() => setSel(l)}
                tabIndex={0}
                role="button"
                aria-label={`Detalhes do registro ${l.numero_serie}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSel(l)
                  }
                }}
              >
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatarDataHora(l.data_hora)}
                </TableCell>
                <TableCell>{l.cliente || '—'}</TableCell>
                {/* PMO e OP são obrigatórios no domínio de Ordens, nunca vazios: sem fallback "—" */}
                <TableCell>{`${l.pmo}·${l.op}`}</TableCell>
                <TableCell>{l.posto || '—'}</TableCell>
                <TableCell>{l.numero_serie || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={classePorStatus(l.status)}>
                    {rotuloStatus(l.status)}
                  </Badge>
                </TableCell>
                <TableCell>{l.colaborador || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={sel !== null} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {sel && (
            <>
              <DialogHeader>
                <DialogTitle>Detalhe do registro</DialogTitle>
              </DialogHeader>
              <dl className="space-y-1.5 text-sm">
                <CampoDetalhe rotulo="Data/Hora" valor={formatarDataHora(sel.data_hora)} />
                <CampoDetalhe rotulo="Cliente" valor={sel.cliente} />
                {/* PMO e OP são obrigatórios no domínio de Ordens, nunca vazios: sem fallback "—" */}
                <CampoDetalhe rotulo="PMO·OP" valor={`${sel.pmo}·${sel.op}`} />
                <CampoDetalhe rotulo="Posto" valor={sel.posto} />
                <CampoDetalhe rotulo="SN" valor={sel.numero_serie} />
                <CampoDetalhe rotulo="Status" valor={rotuloStatus(sel.status)} />
                <CampoDetalhe rotulo="Colaborador" valor={sel.colaborador} />
                {linha('Nº caixa', sel.numero_caixa)}
                {linha('Qtd/caixa', sel.qtd_por_caixa)}
                {linha('Código defeito', sel.codigo_defeito)}
                {linha('Posição', sel.posicao)}
                {linha('Tipo defeito', sel.tipo_defeito)}
                {linha('NQA visual', sel.nqa_visual)}
                {linha('NQA funcional', sel.nqa_funcional)}
                {linha('ID Integração', sel.id_integracao)}
                {linha('Reparo (conserto)', sel.reparo_conserto)}
                {linha('Reparo (posição)', sel.reparo_posicao)}
                {linha('Posto de origem', sel.posto_origem)}
                {linha(
                  'Data/hora origem',
                  sel.data_hora_origem ? formatarDataHora(sel.data_hora_origem) : null,
                )}
              </dl>
              {podeAdministrar && (
                <div className="mt-4 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    disabled={checando || !cancelavel?.podeCancelar}
                    onClick={abrirConfirm}
                  >
                    {checando ? 'Verificando…' : 'Cancelar lançamento'}
                  </Button>
                  {!checando && cancelavel && !cancelavel.podeCancelar && cancelavel.motivo && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{cancelavel.motivo}</p>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAberto} onOpenChange={(o) => { if (!o && !cancelando) setConfirmAberto(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar lançamento</DialogTitle>
          </DialogHeader>
          {sel && (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                Vai cancelar o bipe <strong>{sel.numero_serie}</strong> em <strong>{sel.posto}</strong>{' '}
                (<strong>{rotuloStatus(sel.status)}</strong>) de {formatarDataHora(sel.data_hora)}. O bipe
                é removido e a peça volta ao posto anterior. Esta ação fica registrada na auditoria.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="motivo-cancel">Motivo (obrigatório)</Label>
                <Input id="motivo-cancel" value={motivo} autoFocus
                  onChange={(e) => { setMotivo(e.target.value); if (erroCancel) setErroCancel('') }}
                  placeholder="Ex.: aprovado por engano" />
              </div>
              {erroCancel && <p className="text-sm text-red-600">{erroCancel}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={cancelando} onClick={() => setConfirmAberto(false)}>Voltar</Button>
            <Button className="bg-red-600 text-white hover:bg-red-700"
              disabled={cancelando || motivo.trim() === ''}
              onClick={confirmarCancelamento}>
              {cancelando ? 'Cancelando…' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
