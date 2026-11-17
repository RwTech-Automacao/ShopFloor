'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { consultarNsAction, registrarEntradaAction } from '@/modules/sat/application/actions'
import type { OsDoNs, ResultadoConsultaNs } from '@/modules/sat/application/consultar-ns'
import { FRETES, ITENS_JUNTO, cnpjDoCliente, voltaParaFabrica, type EntradaInput, type Frete, type ItemJunto, type SituacaoNf } from '@/modules/sat/domain/entrada'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { cn } from '@/lib/utils'
import { SituacaoNfCampos } from '../situacao-nf'
import { dia, quando } from '../formato'

const ROTULO_PECA: Record<string, string> = {
  serial_impressora: 'Impressora', serial_mrp: 'MRP', serial_modulo_bio: 'Módulo biométrico', serial_rfid: 'RFID',
  serial_fonte: 'Fonte', serial_barras: 'Leitor de barras',
}

interface Form {
  osId: string | null
  empresa: string
  cnpj: string
  produto: string
  nf: string
  valor: string
  frete: Frete | null
  itensJunto: ItemJunto[]
  itensJuntoOutros: string
  defeito: string
  locacao: string
  custo: string
  situacao: SituacaoNf
  motivos: string[]
}

function formDaConsulta(r: ResultadoConsultaNs): Form {
  return {
    osId: r.osSugeridaId, empresa: r.sugestao.empresa, cnpj: r.sugestao.cnpj, produto: r.sugestao.produto, nf: '',
    valor: '', frete: null, itensJunto: [], itensJuntoOutros: '', defeito: r.sugestao.defeito, locacao: '', custo: '',
    situacao: 'aprovada', motivos: [],
  }
}

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

function CartaoOs({ os, escolhida, onEscolher }: { os: OsDoNs; escolhida: boolean; onEscolher: () => void }) {
  return (
    <label className={cn('flex cursor-pointer gap-3 rounded-md border p-2 text-sm', escolhida && 'border-primary ring-1 ring-primary')}>
      <input type="radio" name="os" checked={escolhida} onChange={onEscolher} className="mt-1" />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap gap-x-4">
          <span className="font-semibold">{os.numero ? `OS ${os.numero}` : 'Sem nº de OS'}</span>
          <span className="text-muted-foreground">{dia(os.data)}</span>
          <span>{os.cliente || '—'}</span>
          <span className="text-muted-foreground">{os.equipamento}</span>
        </div>
        {os.defeito && <span><span className="text-muted-foreground">Defeito:</span> {os.defeito}</span>}
        {os.solucao && <span><span className="text-muted-foreground">Solução:</span> {os.solucao}</span>}
        <span className="text-xs text-muted-foreground">
          {[os.tecnico && `Técnico: ${os.tecnico}`, os.vendedor && `Vendedor: ${os.vendedor}`, os.garantia].filter(Boolean).join(' · ')}
        </span>
        {os.pecas.length > 0 && (
          <span className="text-xs">
            Peças: {os.pecas.map((p) => `${p.quantidade ?? 1} × ${[p.codigoPeca, p.peca].filter(Boolean).join(' ')}`).join('; ')}
          </span>
        )}
      </div>
    </label>
  )
}

export function EntradaTela({ motivos }: { motivos: MotivoNf[] }) {
  const [ns, setNs] = useState('')
  const [consulta, setConsulta] = useState<ResultadoConsultaNs | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salva, setSalva] = useState<{ id: string; ns: string } | null>(null)
  const [buscando, iniciarBusca] = useTransition()
  const [salvando, iniciarSalvar] = useTransition()

  const buscar = () => {
    if (ns.trim() === '') return
    iniciarBusca(async () => {
      const r = await consultarNsAction(ns)
      if (!r.ok) { toast.error(r.erro); return }
      setConsulta(r.valor)
      setForm(formDaConsulta(r.valor))
      setSalva(null)
    })
  }

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const escolherOs = (os: OsDoNs | null) => setForm((f) => {
    if (!f) return f
    if (!os) return { ...f, osId: null }
    const c = cnpjDoCliente(os.cliente)
    return { ...f, osId: os.id, empresa: c.nome, cnpj: c.cnpj, defeito: os.defeito || f.defeito }
  })

  const salvar = () => {
    if (!form || !consulta) return
    const input: EntradaInput = { ns: consulta.ns.escrito, ...form }
    iniciarSalvar(async () => {
      const r = await registrarEntradaAction(input)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success('Entrada registrada.')
      setSalva({ id: r.valor.id, ns: consulta.ns.escrito })
      setConsulta(null)
      setForm(null)
      setNs('')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3">
        <Campo rotulo="Número de série" className="min-w-64 flex-1">
          <Input
            value={ns} autoFocus placeholder="Bipe ou digite (ex.: 00043005620019177 ou 562-19177)"
            onChange={(e) => setNs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
          />
        </Campo>
        <Button onClick={buscar} disabled={buscando || ns.trim() === ''}>{buscando ? 'Buscando…' : 'Buscar'}</Button>
      </div>

      {salva && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Entrada de {salva.ns} registrada. <Link className="underline" href={`/sat/equipamentos/${salva.id}`}>Ver a ficha</Link>
        </p>
      )}

      {consulta && form && (
        <>
          <p className="text-sm text-muted-foreground">
            {consulta.ns.modelo && consulta.ns.sequencia
              ? `Modelo ${consulta.ns.modelo} · sequência ${consulta.ns.sequencia}`
              : consulta.ns.sequencia ? `Sequência ${consulta.ns.sequencia} (sem modelo)` : 'Número de série sem modelo/sequência reconhecível.'}
          </p>
          {consulta.nadaEncontrado && (
            <p className="rounded-lg border px-3 py-2 text-sm">
              Nada encontrado para este número de série — preencha a entrada manualmente.
            </p>
          )}

          {consulta.os.length > 0 && (
            <Secao titulo="Planilha de garantia (OS)">
              {consulta.os.filter((o) => voltaParaFabrica(o.solucao)).map((o) => (
                <CartaoOs key={o.id} os={o} escolhida={form.osId === o.id} onEscolher={() => escolherOs(o)} />
              ))}
              {consulta.os.every((o) => !voltaParaFabrica(o.solucao)) && (
                <p className="text-sm text-muted-foreground">Nenhuma OS de envio ao SAT ou troca do relógio para este número de série.</p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="os" checked={form.osId === null} onChange={() => escolherOs(null)} />
                Sem OS
              </label>
              {consulta.os.some((o) => !voltaParaFabrica(o.solucao)) && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    Outros atendimentos ({consulta.os.filter((o) => !voltaParaFabrica(o.solucao)).length}) — envio de peça e
                    outros que não voltam para a fábrica
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {consulta.os.filter((o) => !voltaParaFabrica(o.solucao)).map((o) => (
                      <CartaoOs key={o.id} os={o} escolhida={form.osId === o.id} onEscolher={() => escolherOs(o)} />
                    ))}
                  </div>
                </details>
              )}
            </Secao>
          )}

          {(consulta.repinmetro.revendas.length > 0 || consulta.repinmetro.producao.length > 0) && (
            <Secao titulo="Repinmetro">
              {consulta.repinmetro.revendas.map((r) => (
                <span key={r.numeroSerieCompleto} className="text-sm">
                  Revenda: <strong>{r.revenda ?? 'sem revenda'}</strong> · saída da expedição {quando(r.saidaEm)}
                </span>
              ))}
              {consulta.repinmetro.producao.map((p, i) => (
                <div key={i} className="text-sm">
                  Teste de produção {quando(p.dataInicio)}: <strong>{p.status ?? '—'}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {Object.entries(p.seriais).filter(([, v]) => v).map(([k, v]) => `${ROTULO_PECA[k] ?? k}: ${v}`).join(' · ') || 'Sem seriais de peças.'}
                  </span>
                </div>
              ))}
            </Secao>
          )}

          {consulta.shopfloor.length > 0 && (
            <Secao titulo="ShopFloor (produção)">
              {consulta.shopfloor.map((s) => (
                <span key={`${s.pmo}-${s.op}`} className="text-sm">
                  OP {s.op} · {s.pmo} {s.descricao && `— ${s.descricao}`} · {s.cliente} · último posto {s.ultimoPosto} em {quando(s.ultimoEm)}
                </span>
              ))}
              {consulta.compels.map((c) => (
                <span key={c.codigo} className="text-xs text-muted-foreground">Compels {c.codigo}: {c.descricao}</span>
              ))}
            </Secao>
          )}

          <Secao titulo="Entrada">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Empresa"><Input value={form.empresa} onChange={(e) => mudar('empresa', e.target.value)} /></Campo>
              <Campo rotulo="CNPJ"><Input value={form.cnpj} onChange={(e) => mudar('cnpj', e.target.value)} /></Campo>
              <Campo rotulo="Produto"><Input value={form.produto} onChange={(e) => mudar('produto', e.target.value)} /></Campo>
              <Campo rotulo="NF de entrada *"><Input value={form.nf} onChange={(e) => mudar('nf', e.target.value)} /></Campo>
              <Campo rotulo="Valor unitário (R$)"><Input inputMode="decimal" value={form.valor} onChange={(e) => mudar('valor', e.target.value)} /></Campo>
              <Campo rotulo="Frete de entrada">
                <select
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={form.frete ?? ''} onChange={(e) => mudar('frete', (e.target.value || null) as Frete | null)}
                >
                  <option value="">—</option>
                  {FRETES.map((f) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Locação"><Input value={form.locacao} onChange={(e) => mudar('locacao', e.target.value)} /></Campo>
              <Campo rotulo="Custo (R$)"><Input inputMode="decimal" value={form.custo} onChange={(e) => mudar('custo', e.target.value)} /></Campo>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Itens que vieram junto</span>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {ITENS_JUNTO.map((i) => (
                  <label key={i.chave} className="flex items-center gap-2">
                    <Checkbox
                      checked={form.itensJunto.includes(i.chave)}
                      onCheckedChange={(v) => mudar('itensJunto', v === true ? [...form.itensJunto, i.chave] : form.itensJunto.filter((x) => x !== i.chave))}
                    />
                    {i.rotulo}
                  </label>
                ))}
                {form.itensJunto.includes('outros') && (
                  <Input className="max-w-xs" placeholder="Quais?" value={form.itensJuntoOutros} onChange={(e) => mudar('itensJuntoOutros', e.target.value)} />
                )}
              </div>
            </div>
            <Campo rotulo="Defeito relatado"><Textarea value={form.defeito} onChange={(e) => mudar('defeito', e.target.value)} /></Campo>
            <SituacaoNfCampos
              nome="situacao-entrada" situacao={form.situacao} motivos={form.motivos} opcoes={motivos}
              onSituacao={(s) => mudar('situacao', s)} onMotivos={(m) => mudar('motivos', m)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={salvar} disabled={salvando || form.nf.trim() === ''}>{salvando ? 'Salvando…' : 'Salvar entrada'}</Button>
              <span className="text-xs text-muted-foreground">Data = hoje; responsável = você.</span>
            </div>
          </Secao>
        </>
      )}
    </div>
  )
}
