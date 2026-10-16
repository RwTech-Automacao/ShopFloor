'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NOME_CANAL, CANAIS, type Canal } from '@/modules/alertas/domain/tipos'
import type { PostoRegra } from '@/modules/alertas/domain/postos-regra'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import type { ModuloAlerta } from '@/modules/alertas/domain/modulo'
import { avaliarAgoraAction } from '@/modules/alertas/application/alertas-actions'
import { RegrasLista } from './regras-lista'
import { OcorrenciasLista } from './ocorrencias-lista'

/**
 * A tela de Alertas. Mora no MÓDULO, e não na pasta de uma rota, porque ela serve DUAS rotas
 * (`/configuracoes/sf-alertas` e `/configuracoes/rec-alertas`, spec de 2026-10-09, decisão 2): a
 * pasta de uma rota não pode ser a casa da tela da outra.
 *
 * O que a tela sabe do módulo vem SÓ da prop `modulo` — nunca do `usePathname()`. É ela que decide
 * quais tipos de regra existem, para qual rota as actions revalidam e qual permissão o servidor
 * confere. As duas `page.tsx` carregam o que é do módulo delas e montam este componente.
 */

const TOAST = { position: 'bottom-center' } as const

export function AlertasTela({
  modulo,
  regras,
  postos,
  pmos,
  destinatarios,
  configurados,
  canalConfigurado,
  ocorrenciasIniciais,
  filtroInicial,
}: {
  /** Qual módulo esta instância da tela está servindo. Desce inteira até o formulário. */
  modulo: ModuloAlerta
  regras: RegraAlerta[]
  postos: PostoRegra[]
  pmos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  /** O aviso em canal está pronto (token + DISCORD_CANAL_ID)? */
  canalConfigurado: boolean
  ocorrenciasIniciais: OcorrenciaLinha[]
  filtroInicial: FiltroOcorrencias
}) {
  const [aba, setAba] = useState<'regras' | 'ocorrencias'>('regras')
  const [pendente, startTransition] = useTransition()
  const router = useRouter()
  // Incrementa a cada avaliação: é o sinal para a lista de ocorrências buscar de novo.
  const [recarga, setRecarga] = useState(0)

  const semCanal = CANAIS.filter((c) => !configurados[c])

  function avaliarAgora() {
    startTransition(async () => {
      const r = await avaliarAgoraAction(modulo)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      const { avaliadas, enviados, falhas, ocupado } = r.resumo
      toast.success(
        ocupado
          ? 'Uma avaliação já estava rodando — tente de novo em instantes.'
          : `${avaliadas} combinações avaliadas · ${enviados} enviados${falhas > 0 ? ` · ${falhas} falhas` : ''}`,
        TOAST,
      )
      // A avaliação abre, REABRE, lembra e normaliza ocorrências. Sem isto, o gestor clica, lê "2
      // combinações avaliadas" e vê a linha ainda como "Resolvida" — e conclui que o alerta não
      // funcionou (foi o que aconteceu no smoke). Mesmo par do setup-estrutura: `router.refresh()`
      // renova o que vem do servidor (inclusive a lista inicial de quando a aba for aberta depois)
      // e a lista montada, que é estado do cliente, é avisada para buscar de novo.
      // Vale também no `ocupado`: a outra rodada está mexendo nas ocorrências agora.
      router.refresh()
      setRecarga((v) => v + 1)
    })
  }

  const botaoAba = (chave: 'regras' | 'ocorrencias', rotulo: string) => (
    <button
      key={chave}
      type="button"
      onClick={() => setAba(chave)}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        aba === chave ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {rotulo}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {botaoAba('regras', 'Regras')}
          {botaoAba('ocorrencias', 'Ocorrências')}
        </div>
        <Button variant="outline" disabled={pendente} onClick={avaliarAgora}>
          <Play /> Avaliar agora
        </Button>
      </div>

      {semCanal.length > 0 && (
        <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          {semCanal.map((c) => `${NOME_CANAL[c]} não configurado`).join(' · ')} neste ambiente — regras com esse canal
          não enviam nada.
        </p>
      )}

      {aba === 'regras' ? (
        <RegrasLista
          modulo={modulo}
          regras={regras}
          postos={postos}
          pmos={pmos}
          destinatarios={destinatarios}
          configurados={configurados}
          canalConfigurado={canalConfigurado}
        />
      ) : (
        <OcorrenciasLista
          modulo={modulo}
          ocorrenciasIniciais={ocorrenciasIniciais}
          filtroInicial={filtroInicial}
          recarregar={recarga}
        />
      )}
    </div>
  )
}
