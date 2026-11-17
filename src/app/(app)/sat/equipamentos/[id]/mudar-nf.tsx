'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { corrigirNfAction, trocarNfAction } from '@/modules/sat/application/actions'
import type { SituacaoNf } from '@/modules/sat/domain/entrada'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { SituacaoNfCampos } from '../../situacao-nf'
import { AvisoEmpresa, useEmpresaPeloCnpj } from '../../empresa-pelo-cnpj'

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      {children}
    </label>
  )
}

/**
 * Corrigir (a mesma nota muda de situação) ou trocar (nota nova; a antiga fica no histórico). Vale para todos os
 * relógios da nota. sat.aprovar_nf.
 */
export function MudarNf({
  nfId, nfAtual, situacaoAtual, motivosAtuais, relogios, motivos,
}: {
  nfId: string
  nfAtual: string
  situacaoAtual: SituacaoNf
  /** Textos dos motivos da nota (ela guarda o texto, não o id). */
  motivosAtuais: string[]
  relogios: number
  motivos: MotivoNf[]
}) {
  const router = useRouter()
  const emp = useEmpresaPeloCnpj()
  const [modo, setModo] = useState<'corrigir' | 'trocar' | null>(null)
  const [numero, setNumero] = useState('')
  const [valor, setValor] = useState('')
  const [situacao, setSituacao] = useState<SituacaoNf>('aprovada')
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [pendente, iniciar] = useTransition()

  const abrir = (m: 'corrigir' | 'trocar') => {
    setModo(m); setNumero(''); setValor(''); emp.limpar()
    if (m === 'corrigir') {
      setSituacao(situacaoAtual)
      setEscolhidos(situacaoAtual === 'reprovada' ? motivos.filter((x) => motivosAtuais.includes(x.texto)).map((x) => x.id) : [])
    } else {
      setSituacao('aprovada'); setEscolhidos([])
    }
  }

  const confirmar = () => iniciar(async () => {
    const r = modo === 'trocar'
      ? await trocarNfAction(nfId, {
          numero, cnpj: emp.cnpj, empresa: emp.empresa, negocianteCodigo: emp.negocianteCodigo, valor, situacao,
          motivos: escolhidos,
        })
      : await corrigirNfAction(nfId, situacao, escolhidos)
    if (!r.ok) { toast.error(r.erro); return }
    toast.success(modo === 'trocar' ? 'NF trocada.' : 'NF corrigida.')
    setModo(null)
    router.refresh()
  })

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <div className="flex flex-wrap gap-2">
        <Button variant={modo === 'corrigir' ? 'default' : 'outline'} onClick={() => abrir('corrigir')}>Corrigir NF {nfAtual}</Button>
        <Button variant={modo === 'trocar' ? 'default' : 'outline'} onClick={() => abrir('trocar')}>Trocar por nota nova</Button>
      </div>
      {modo && (
        <div className="flex flex-col gap-3">
          {modo === 'trocar' && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Campo rotulo="Número da NF nova *"><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></Campo>
                <Campo rotulo="CNPJ">
                  <Input
                    value={emp.cnpj} placeholder="CNPJ ou CPF" onChange={(e) => emp.mudarCnpj(e.target.value)}
                    onBlur={() => void emp.buscar()} onKeyDown={(e) => { if (e.key === 'Enter') void emp.buscar() }}
                  />
                </Campo>
                <Campo rotulo="Empresa"><Input value={emp.empresa} onChange={(e) => emp.setEmpresa(e.target.value)} /></Campo>
                <Campo rotulo="Valor da nota (R$)">
                  <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                </Campo>
              </div>
              <AvisoEmpresa buscando={emp.buscando} origem={emp.origem} />
            </>
          )}
          <SituacaoNfCampos
            nome="situacao-mudanca" situacao={situacao} motivos={escolhidos} opcoes={motivos}
            onSituacao={setSituacao} onMotivos={setEscolhidos}
          />
          <p className="text-xs text-muted-foreground">
            Vale para todos os relógios desta nota ({relogios === 1 ? '1 relógio' : `${relogios} relógios`}).
          </p>
          <div className="flex gap-2">
            <Button onClick={confirmar} disabled={pendente || (modo === 'trocar' && numero.trim() === '')}>
              {pendente ? 'Salvando…' : 'Confirmar'}
            </Button>
            <Button variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  )
}
