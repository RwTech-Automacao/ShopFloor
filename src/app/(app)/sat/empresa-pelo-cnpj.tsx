'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { buscarEmpresaAction } from '@/modules/sat/application/actions'
import { digitosCnpj, formatarCnpj } from '@/modules/sat/domain/cnpj'

/**
 * CNPJ da nota + empresa achada no Compels (spec 2026-11-17-sat-entrada-por-nf-design.md, decisão 3). Ao sair do
 * campo / Enter busca a empresa; cada CNPJ novo achado preenche a Empresa (que continua editável). Usado na entrada e
 * no "Trocar NF" da ficha.
 */
export function useEmpresaPeloCnpj() {
  const [cnpj, setCnpj] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [negocianteCodigo, setNegocianteCodigo] = useState<string | null>(null)
  const [origem, setOrigem] = useState<'compels' | 'nao_achou' | null>(null)
  const [buscando, setBuscando] = useState(false)
  const buscado = useRef('')
  const doCompels = useRef('')
  const pedido = useRef(0)

  const mudarCnpj = (v: string) => {
    setCnpj(v)
    if (digitosCnpj(v) !== buscado.current) {
      buscado.current = ''
      setNegocianteCodigo(null)
      setOrigem(null)
    }
  }

  const buscar = async () => {
    const d = digitosCnpj(cnpj)
    if ((d.length !== 11 && d.length !== 14) || d === buscado.current) return
    buscado.current = d
    const n = ++pedido.current
    setBuscando(true)
    const r = await buscarEmpresaAction(cnpj)
    if (n !== pedido.current) return
    setBuscando(false)
    if (!r.ok) {
      buscado.current = ''
      toast.error(r.erro)
      return
    }
    setCnpj(formatarCnpj(cnpj) ?? cnpj)
    if (r.valor) {
      doCompels.current = r.valor.nome
      setEmpresa(r.valor.nome)
      setNegocianteCodigo(r.valor.codigo)
      setOrigem('compels')
    } else {
      setEmpresa((e) => (e === doCompels.current ? '' : e))
      setNegocianteCodigo(null)
      setOrigem('nao_achou')
    }
  }

  const limpar = () => {
    pedido.current++
    buscado.current = ''
    doCompels.current = ''
    setCnpj('')
    setEmpresa('')
    setNegocianteCodigo(null)
    setOrigem(null)
    setBuscando(false)
  }

  return { cnpj, mudarCnpj, empresa, setEmpresa, negocianteCodigo, origem, buscando, buscar, limpar }
}

/** O texto pequeno embaixo do CNPJ/Empresa. */
export function AvisoEmpresa({ buscando, origem }: { buscando: boolean; origem: 'compels' | 'nao_achou' | null }) {
  if (buscando) return <span className="text-xs text-muted-foreground">Buscando no Compels…</span>
  if (origem === 'compels') return <span className="text-xs text-muted-foreground">do cadastro do Compels</span>
  if (origem === 'nao_achou') return <span className="text-xs text-muted-foreground">Não achamos no Compels — digite a empresa</span>
  return null
}
