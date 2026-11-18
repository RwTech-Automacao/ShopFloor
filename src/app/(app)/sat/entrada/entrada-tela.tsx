'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { consultarNsAction, registrarNfAction } from '@/modules/sat/application/actions'
import type { ResultadoConsultaNs } from '@/modules/sat/application/consultar-ns'
import { ITENS_JUNTO, type ItemJunto, type NotaInput, type SituacaoNf } from '@/modules/sat/domain/entrada'
import { normalizarNs } from '@/modules/sat/domain/numero-serie'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { cn } from '@/lib/utils'
import { SituacaoNfCampos } from '../situacao-nf'
import { AvisoEmpresa, useEmpresaPeloCnpj } from '../empresa-pelo-cnpj'
import { quando } from '../formato'

const ROTULO_PECA: Record<string, string> = {
  serial_impressora: 'Impressora', serial_mrp: 'MRP', serial_modulo_bio: 'Módulo biométrico', serial_rfid: 'RFID',
  serial_fonte: 'Fonte', serial_barras: 'Leitor de barras',
}

/** Um relógio bipado na nota: o que a consulta achou + o que a pessoa preenche. */
interface Relogio {
  chave: string
  consulta: ResultadoConsultaNs
  produto: string
  itensJunto: ItemJunto[]
  itensJuntoOutros: string
  locacao: string
}

/** O mesmo relógio: mesmo modelo + sequência; sem sequência legível, o mesmo texto (a regra de `validarNota`). */
function chaveDoNs(texto: string): string {
  const ns = normalizarNs(texto)
  return ns.sequencia ? `${ns.modelo ?? ''}/${ns.sequencia}` : `#${ns.escrito.toUpperCase()}`
}

const relogios = (n: number) => (n === 1 ? '1 relógio' : `${n} relógios`)

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      {children}
    </section>
  )
}

function Campo({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1 text-sm', className)}>
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      {children}
    </label>
  )
}

function osPrevista(c: ResultadoConsultaNs): string {
  const os = c.os.find((o) => o.id === c.osSugeridaId)
  if (!os) return 'Sem OS'
  return [os.numero ? `OS ${os.numero}` : 'OS sem número', os.garantia, os.defeito && `Defeito: ${os.defeito}`]
    .filter(Boolean).join(' · ')
}

function CartaoRelogio({
  r, onMudar, onRemover,
}: {
  r: Relogio
  onMudar: (m: Partial<Relogio>) => void
  onRemover: () => void
}) {
  const c = r.consulta
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="cartao-relogio">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-sm font-semibold">{c.ns.escrito}</h4>
        <Button variant="ghost" size="sm" aria-label={`Remover ${c.ns.escrito}`} onClick={onRemover}>Remover</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo rotulo="Produto"><Input value={r.produto} onChange={(e) => onMudar({ produto: e.target.value })} /></Campo>
        <Campo rotulo="Locação"><Input value={r.locacao} onChange={(e) => onMudar({ locacao: e.target.value })} /></Campo>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Itens que vieram junto</span>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {ITENS_JUNTO.map((i) => (
            <label key={i.chave} className="flex items-center gap-2">
              <Checkbox
                checked={r.itensJunto.includes(i.chave)}
                onCheckedChange={(v) => onMudar({
                  itensJunto: v === true ? [...r.itensJunto, i.chave] : r.itensJunto.filter((x) => x !== i.chave),
                })}
              />
              {i.rotulo}
            </label>
          ))}
          {r.itensJunto.includes('outros') && (
            <Input
              className="max-w-xs" placeholder="Quais?" value={r.itensJuntoOutros}
              onChange={(e) => onMudar({ itensJuntoOutros: e.target.value })}
            />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {c.nadaEncontrado && <span>Nada encontrado para este número de série — preencha à mão.</span>}
        <span>OS prevista: {osPrevista(c)}</span>
        {c.repinmetro.revendas.map((v) => (
          <span key={v.numeroSerieCompleto}>
            Revenda: {v.revenda ?? 'sem revenda'} · saída da expedição {quando(v.saidaEm)}
          </span>
        ))}
        {c.repinmetro.producao.length > 0 && (
          <details>
            <summary className="cursor-pointer">Teste de produção</summary>
            <div className="mt-1 flex flex-col gap-1">
              {c.repinmetro.producao.map((p, i) => (
                <div key={i}>
                  {quando(p.dataInicio)}: {p.status ?? '—'}
                  <span className="block">
                    {Object.entries(p.seriais).filter(([, v]) => v).map(([k, v]) => `${ROTULO_PECA[k] ?? k}: ${v}`).join(' · ') ||
                      'Sem seriais de peças.'}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

export function EntradaTela({ motivos }: { motivos: MotivoNf[] }) {
  const emp = useEmpresaPeloCnpj()
  const [numero, setNumero] = useState('')
  const [valor, setValor] = useState('')
  const [situacao, setSituacao] = useState<SituacaoNf>('aprovada')
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [ns, setNs] = useState('')
  const [lista, setLista] = useState<Relogio[]>([])
  const [salva, setSalva] = useState<{ numero: string; n: number; id: string } | null>(null)
  const [buscando, iniciarBusca] = useTransition()
  const [salvando, iniciarSalvar] = useTransition()
  // Chaves dos relógios na lista e dos que estão sendo buscados (bipes seguidos).
  const chaves = useRef(new Set<string>())
  // Sobe a cada salvamento: a busca de NS que volta de uma geração anterior é descartada.
  const geracao = useRef(0)

  const bipar = () => {
    const texto = ns.trim()
    if (texto === '') return
    const chave = chaveDoNs(texto)
    if (chaves.current.has(chave)) {
      toast.error(`O número de série ${texto} já está nesta nota.`)
      setNs('')
      return
    }
    chaves.current.add(chave)
    setNs('')
    const minha = geracao.current
    iniciarBusca(async () => {
      let r: Awaited<ReturnType<typeof consultarNsAction>>
      try {
        r = await consultarNsAction(texto)
      } catch {
        if (minha === geracao.current) chaves.current.delete(chave)
        toast.error('Não foi possível buscar o número de série. Tente de novo.')
        return
      }
      if (minha !== geracao.current) return
      if (!r.ok) {
        chaves.current.delete(chave)
        toast.error(r.erro)
        return
      }
      setSalva(null)
      setLista((l) => [...l, {
        chave, consulta: r.valor, produto: r.valor.sugestao.produto, itensJunto: [], itensJuntoOutros: '', locacao: '',
      }])
    })
  }

  const mudarRelogio = (chave: string, m: Partial<Relogio>) =>
    setLista((l) => l.map((r) => (r.chave === chave ? { ...r, ...m } : r)))

  const remover = (chave: string) => {
    chaves.current.delete(chave)
    setLista((l) => l.filter((r) => r.chave !== chave))
  }

  const registrar = () => {
    if (lista.length === 0) return
    const input: NotaInput = {
      cnpj: emp.cnpj, empresa: emp.empresa, negocianteCodigo: emp.negocianteCodigo, numero, valor, situacao,
      motivos: escolhidos,
      relogios: lista.map((r) => ({
        ns: r.consulta.ns.escrito, produto: r.produto, itensJunto: r.itensJunto, itensJuntoOutros: r.itensJuntoOutros,
        locacao: r.locacao,
      })),
    }
    iniciarSalvar(async () => {
      const r = await registrarNfAction(input)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success('Entrada registrada.')
      geracao.current++
      setSalva({ numero: input.numero.trim(), n: r.valor.ids.length, id: r.valor.ids[0] ?? '' })
      emp.limpar()
      setNumero('')
      setValor('')
      setSituacao('aprovada')
      setEscolhidos([])
      setNs('')
      setLista([])
      chaves.current.clear()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {salva && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Entrada da NF {salva.numero} registrada ({relogios(salva.n)}).{' '}
          {salva.id && <Link className="underline" href={`/sat/equipamentos/${salva.id}`}>Ver a ficha</Link>}
        </p>
      )}

      <Secao titulo="Nota fiscal">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="CNPJ">
            <Input
              value={emp.cnpj} autoFocus placeholder="CNPJ ou CPF" onChange={(e) => emp.mudarCnpj(e.target.value)}
              onBlur={() => void emp.buscar()} onKeyDown={(e) => { if (e.key === 'Enter') void emp.buscar() }}
            />
          </Campo>
          <Campo rotulo="Empresa"><Input value={emp.empresa} onChange={(e) => emp.setEmpresa(e.target.value)} /></Campo>
          <Campo rotulo="Número da NF"><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></Campo>
          <Campo rotulo="Valor da nota (R$)">
            <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </Campo>
        </div>
        <AvisoEmpresa buscando={emp.buscando} origem={emp.origem} />
        <SituacaoNfCampos
          nome="situacao-entrada" situacao={situacao} motivos={escolhidos} opcoes={motivos}
          onSituacao={setSituacao} onMotivos={setEscolhidos}
        />
      </Secao>

      <Secao titulo="Relógios">
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Número de série" className="min-w-64 flex-1">
            <Input
              value={ns} placeholder="Bipe ou digite (ex.: 00043005620019177 ou 562-19177)"
              onChange={(e) => setNs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') bipar() }}
            />
          </Campo>
          <Button variant="outline" onClick={bipar} disabled={ns.trim() === ''}>Adicionar</Button>
          {buscando && <span className="text-xs text-muted-foreground">Buscando…</span>}
        </div>
        {lista.map((r) => (
          <CartaoRelogio key={r.chave} r={r} onMudar={(m) => mudarRelogio(r.chave, m)} onRemover={() => remover(r.chave)} />
        ))}
      </Secao>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={registrar} disabled={salvando || buscando || emp.buscando || lista.length === 0}>
          {salvando ? 'Salvando…' : `Registrar entrada (${relogios(lista.length)})`}
        </Button>
        <span className="text-xs text-muted-foreground">Data = hoje; responsável = você.</span>
      </div>
    </div>
  )
}
