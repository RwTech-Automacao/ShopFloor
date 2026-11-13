'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import type { TrechoReceita } from '@/modules/shopfloor/domain/estrutura'
import type { EstruturaView } from '@/modules/shopfloor/infra/estrutura-repository'
import {
  ativarEstruturaAction, importarDoCompelsAction, lerDoCompelsAction, salvarEstruturaAction,
} from '@/modules/shopfloor/application/estrutura-actions'

const SITUACAO = { rascunho: 'Rascunho — conferir postos', ativa: 'Ativa' } as const
const trechoVazio = (seq: number): TrechoReceita => ({ seq, codigo: '', descricao: '', postoConclui: null, snModo: 'mesmo', estoque: 'EINTER' })

export function EstruturasCliente({ estruturas, postos, pmoInicial }: { estruturas: EstruturaView[]; postos: string[]; pmoInicial?: string }) {
  // Vindo do aviso do formulário da OP: abre já na PMO pedida (estrutura nova, ou a existente em edição).
  const [aberturaInicial] = useState(() => {
    if (!pmoInicial) return null
    const existente = estruturas.find((e) => e.pmo === pmoInicial)
    return { e: existente ?? ({ pmo: pmoInicial, situacao: 'rascunho', origem: 'manual', trechos: [] } as EstruturaView), daLista: !!existente }
  })
  const [editando, setEditando] = useState<EstruturaView | null>(aberturaInicial?.e ?? null)
  const [trechos, setTrechos] = useState<TrechoReceita[]>(() => (aberturaInicial ? (aberturaInicial.e.trechos.length ? aberturaInicial.e.trechos : [trechoVazio(1)]) : []))
  const [opCompels, setOpCompels] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [resumo, setResumo] = useState<string | null>(null)
  const [pendente, start] = useTransition()
  const [origemLista, setOrigemLista] = useState(aberturaInicial?.daLista ?? false)
  const [salvo, setSalvo] = useState(false)
  const [sujo, setSujo] = useState(false)
  const { confirmar, dialog } = useConfirmacao()

  function abrir(e: EstruturaView) {
    setEditando(e); setTrechos(e.trechos.length ? e.trechos : [trechoVazio(1)]); setErro(null)
    setSalvo(false); setSujo(false); setOrigemLista(false)
  }
  function novo() {
    abrir({ pmo: '', situacao: 'rascunho', origem: 'manual', trechos: [] })
  }
  function editar(e: EstruturaView) {
    abrir(e); setOrigemLista(true)
  }
  const mudar = (i: number, parcial: Partial<TrechoReceita>) =>
    { setSujo(true); setTrechos((ts) => ts.map((t, j) => (j === i ? { ...t, ...parcial } : t))) }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={novo}>Nova estrutura</Button>
        <Button
          variant="outline"
          disabled={pendente}
          onClick={() => start(async () => {
            const r = await importarDoCompelsAction()
            if (r.ok) setResumo(`${r.criadas} estrutura(s) criada(s) em rascunho · ${r.semFilhas} PMO(s) sem PRT no Compels · ${r.falhas} falha(s)`)
            else toast.error(r.erro)
          })}
        >
          Importar do Compels
        </Button>
      </div>
      {resumo && <p className="text-sm text-muted-foreground">{resumo}</p>}

      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th>PMO</th><th>Trechos</th><th>Situação</th><th /></tr></thead>
        <tbody>
          {estruturas.map((e) => (
            <tr key={e.pmo} className="border-t border-border">
              <td className="py-2 font-medium">{e.pmo}</td>
              <td>{e.trechos.map((t) => `${t.codigo} → ${t.postoConclui ?? '?'}`).join(' · ') || '—'}</td>
              <td>{SITUACAO[e.situacao]}</td>
              <td className="text-right">
                <Button size="sm" variant="outline" aria-label={`Editar ${e.pmo}`} onClick={() => editar(e)}>Editar</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {dialog}
      {editando && (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Situação: {SITUACAO[estruturas.find((e) => e.pmo === editando.pmo.trim())?.situacao ?? 'rascunho']}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">PMO
              <Input value={editando.pmo} onChange={(ev) => { setSujo(true); setEditando({ ...editando, pmo: ev.target.value.toUpperCase() }) }} disabled={origemLista || salvo || pendente} />
            </label>
            <label className="flex flex-col gap-1 text-sm">Ler do Compels (nº de uma OP da PMO)
              <Input value={opCompels} onChange={(ev) => setOpCompels(ev.target.value)} placeholder="ex.: 8498" />
            </label>
            <Button
              variant="outline"
              disabled={pendente || !opCompels.trim() || !editando.pmo.trim()}
              onClick={async () => {
                if (trechos.some((t) => t.codigo.trim())) {
                  const ok = await confirmar({ titulo: 'Substituir os trechos pelos lidos do Compels?', rotuloConfirmar: 'Substituir' })
                  if (!ok) return
                }
                start(async () => {
                  const r = await lerDoCompelsAction(editando.pmo, opCompels)
                  if (r.ok) { setTrechos(r.trechos.length ? r.trechos : [trechoVazio(1)]); setSujo(true) }
                  else toast.error(r.erro)
                })
              }}
            >
              Ler do Compels
            </Button>
          </div>

          {trechos.map((t, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_14rem_8rem_auto]">
              <Input aria-label={`Código do trecho ${i + 1}`} value={t.codigo} onChange={(ev) => mudar(i, { codigo: ev.target.value.toUpperCase() })} placeholder="PRT…" />
              <span className="self-center truncate text-xs text-muted-foreground">{t.descricao}</span>
              <select aria-label={`Posto que conclui o trecho ${i + 1}`} className="h-9 rounded-md border border-border bg-background px-2"
                value={t.postoConclui ?? ''} onChange={(ev) => mudar(i, { postoConclui: ev.target.value || null })}>
                <option value="">— escolha o posto —</option>
                {t.postoConclui && !postos.includes(t.postoConclui) && <option value={t.postoConclui}>{t.postoConclui}</option>}
                {postos.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select aria-label={`Estoque do trecho ${i + 1}`} className="h-9 rounded-md border border-border bg-background px-2"
                value={t.estoque} onChange={(ev) => mudar(i, { estoque: ev.target.value as TrechoReceita['estoque'] })}>
                <option value="EINTER">EINTER</option>
                <option value="PA">PA</option>
              </select>
              <Button variant="ghost" size="sm" aria-label={`Remover trecho ${i + 1}`} onClick={() => { setSujo(true); setTrechos((ts) => ts.filter((_, j) => j !== i)) }}>Remover</Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Trechos na ordem da rota (o primeiro é o mais fundo, ex.: SMD). Número de série: o mesmo da PMO.</p>

          {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setSujo(true); setTrechos((ts) => [...ts, trechoVazio(ts.length + 1)]) }}>Adicionar trecho</Button>
            <Button
              disabled={pendente}
              onClick={() => {
                if (!origemLista && !salvo && estruturas.some((e) => e.pmo === editando.pmo.trim())) {
                  setErro('Essa PMO já tem estrutura — use Editar na lista.')
                  return
                }
                start(async () => {
                const r = await salvarEstruturaAction(editando.pmo, trechos)
                if (r.ok) { toast.success('Estrutura salva como rascunho.'); setErro(null); setSalvo(true); setSujo(false) } else setErro(r.erro)
                })
              }}
            >
              Salvar
            </Button>
            <Button
              variant="secondary"
              disabled={pendente || sujo}
              onClick={() => start(async () => {
                const r = await ativarEstruturaAction(editando.pmo)
                if (r.ok) { toast.success('Estrutura ativa: vale para as próximas OPs desta PMO.'); setErro(null) } else setErro(r.erro)
              })}
            >
              Ativar
            </Button>
            {sujo && <span className="self-center text-xs text-muted-foreground">Salve antes de ativar.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
