'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buscarItensAction, pecasSugeridasAction } from '@/modules/sat/application/ordens-actions'
import type { CamadasPecas } from '@/modules/sat/application/pecas-sugeridas'
import type { PecaSugerida } from '@/modules/sat/domain/estrutura'

function Lista({ titulo, pecas, onEscolher }: { titulo: string; pecas: PecaSugerida[]; onEscolher: (p: PecaSugerida) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
      {pecas.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma.</span>}
      <div className="flex flex-wrap gap-1">
        {pecas.map((p) => (
          <Button key={p.codigo} type="button" variant="outline" size="sm" onClick={() => onEscolher(p)}>
            {p.descricao ? `${p.codigo} — ${p.descricao}` : p.codigo}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A lista de peças da manutenção: as 3 camadas sugeridas (mais usadas no modelo, kits que servem, peças da
 * estrutura) e a busca no cadastro do Compels (camada 4). Só leitura do Compels; escolher só preenche o formulário.
 */
const ESPERA_BUSCA_MS = 350
const MIN_BUSCA = 2

export function SeletorPecas({ ordemId, onEscolher }: { ordemId: string; onEscolher: (p: PecaSugerida) => void }) {
  const [camadas, setCamadas] = useState<CamadasPecas | null>(null)
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<PecaSugerida[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, iniciar] = useTransition()

  const sugerir = () => iniciar(async () => {
    setErro(null)
    const r = await pecasSugeridasAction(ordemId)
    if (!r.ok) { setErro(r.erro); return }
    setCamadas(r.valor)
  })
  const seq = useRef(0)
  const buscar = (t: string) => iniciar(async () => {
    const minha = ++seq.current
    setErro(null)
    const r = await buscarItensAction(t)
    if (minha !== seq.current) return // chegou uma busca mais nova: esta resposta é velha
    if (!r.ok) { setErro(r.erro); setAchados(null); return }
    setAchados(r.valor)
  })
  const digitar = (valor: string) => {
    setTermo(valor)
    if (valor.trim().length < MIN_BUSCA) {
      seq.current++ // uma resposta ainda em voo é velha: não pode reaparecer
      setAchados(null)
    }
  }
  // Digitar busca sozinho, com atraso e só a partir de 2 caracteres (não martela o Compels a cada tecla).
  useEffect(() => {
    if (termo.trim().length < MIN_BUSCA) return
    const t = setTimeout(() => buscar(termo), ESPERA_BUSCA_MS)
    return () => clearTimeout(t)
  }, [termo])

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      {camadas === null ? (
        <div><Button type="button" variant="outline" onClick={sugerir} disabled={carregando}>
          {carregando ? 'Carregando…' : 'Ver peças sugeridas'}
        </Button></div>
      ) : (
        <>
          {camadas.avisos.map((a) => <p key={a} className="text-xs text-amber-800">{a}</p>)}
          <Lista titulo="Mais usadas neste modelo" pecas={camadas.maisUsadas} onEscolher={onEscolher} />
          <Lista titulo="Kits de reposição que servem" pecas={camadas.kits} onEscolher={onEscolher} />
          <Lista titulo="Peças da estrutura" pecas={camadas.estrutura} onEscolher={onEscolher} />
        </>
      )}
      <div className="flex gap-2">
        <Input aria-label="Buscar item no Compels" placeholder="Buscar item no Compels (código ou descrição)" value={termo}
          maxLength={60} onChange={(e) => digitar(e.target.value)} />
        <Button type="button" variant="outline" onClick={() => buscar(termo)} disabled={carregando}>Buscar</Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {achados && <Lista titulo="Resultado da busca" pecas={achados} onEscolher={onEscolher} />}
    </div>
  )
}
