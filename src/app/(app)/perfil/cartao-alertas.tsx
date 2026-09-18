'use client'

import { useEffect, useState, useTransition } from 'react'
import { BellRing, RefreshCw, Send, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { CANAIS, NOME_CANAL, type Canal, type ContaVinculada } from '@/modules/alertas/domain/tipos'
import {
  desvincularAction,
  enviarTesteAction,
  gerarCodigoAction,
  minhasContasAction,
} from '@/modules/alertas/application/perfil-alertas-actions'

const INTERVALO_CONSULTA_MS = 3000
const TOAST = { position: 'bottom-center' } as const

function dataCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}

function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface CodigoAberto {
  canal: Canal
  codigo: string
  expiraEm: string
}

export function CartaoAlertas({
  nome,
  contas,
  configurados,
  telegramBot,
}: {
  nome: string
  contas: ContaVinculada[]
  configurados: Record<Canal, boolean>
  telegramBot: string
}) {
  const [lista, setLista] = useState<ContaVinculada[]>(contas)
  const [codigo, setCodigo] = useState<CodigoAberto | null>(null)
  const [restante, setRestante] = useState(0)
  const [pendente, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  // Enquanto o código está na tela: conta o tempo e pergunta ao servidor se o vínculo chegou.
  useEffect(() => {
    if (!codigo) return
    const alvo = new Date(codigo.expiraEm).getTime()
    const faltam = () => Math.max(0, Math.round((alvo - Date.now()) / 1000))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestante(faltam())
    const tique = setInterval(() => setRestante(faltam()), 1000)
    const consulta = setInterval(async () => {
      const r = await minhasContasAction()
      if (!r.ok) return
      setLista(r.contas)
      if (r.contas.some((c) => c.canal === codigo.canal)) {
        setCodigo(null)
        toast.success(`✅ ${NOME_CANAL[codigo.canal]} vinculado`, TOAST)
      }
    }, INTERVALO_CONSULTA_MS)
    return () => {
      clearInterval(tique)
      clearInterval(consulta)
    }
  }, [codigo])

  function vincular(canal: Canal) {
    startTransition(async () => {
      const r = await gerarCodigoAction()
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      setCodigo({ canal, codigo: r.codigo, expiraEm: r.expiraEm })
    })
  }

  function testar(canal: Canal) {
    startTransition(async () => {
      const r = await enviarTesteAction(canal)
      if (r.ok) toast.success(`Mensagem de teste enviada no ${NOME_CANAL[canal]}`, TOAST)
      else toast.error(r.erro, TOAST)
    })
  }

  async function desvincular(canal: Canal) {
    const ok = await confirmar({
      titulo: `Desvincular o ${NOME_CANAL[canal]}?`,
      descricao: 'Você deixa de receber os alertas por esse canal até vincular de novo.',
      rotuloConfirmar: 'Desvincular',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await desvincularAction(canal)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      setLista((atual) => atual.filter((c) => c.canal !== canal))
      toast.success(`${NOME_CANAL[canal]} desvinculado`, TOAST)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-[18px]" /> Alertas
        </CardTitle>
        <CardDescription>
          Vincule seu Telegram e/ou Discord para receber os alertas de taxa de aprovação dos postos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {CANAIS.map((canal) => {
          const conta = lista.find((c) => c.canal === canal) ?? null
          const aberto = codigo?.canal === canal ? codigo : null
          return (
            <div key={canal} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">{NOME_CANAL[canal]}</span>
                  {!configurados[canal] && (
                    <span className="text-xs text-muted-foreground">Não configurado neste ambiente</span>
                  )}
                  {configurados[canal] && conta && (
                    <span className="text-xs text-muted-foreground">Vinculado em {dataCurta(conta.vinculadoEm)}</span>
                  )}
                  {configurados[canal] && !conta && (
                    <span className="text-xs text-muted-foreground">Não vinculado</span>
                  )}
                </div>

                <div className="flex gap-2">
                  {conta ? (
                    <>
                      <Button variant="outline" size="sm" disabled={pendente || !configurados[canal]} onClick={() => testar(canal)}>
                        <Send /> Enviar teste
                      </Button>
                      <Button variant="destructive" size="sm" disabled={pendente} onClick={() => desvincular(canal)}>
                        <Unlink /> Desvincular
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pendente || !configurados[canal]}
                      onClick={() => vincular(canal)}
                    >
                      {aberto ? <RefreshCw /> : null} Vincular
                    </Button>
                  )}
                </div>
              </div>

              {aberto && (
                <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
                  <p className="text-center font-mono text-2xl font-semibold tracking-widest">{aberto.codigo}</p>
                  <p className="text-center text-xs text-muted-foreground">
                    {restante > 0 ? `Vale por ${relogio(restante)}` : 'Código expirado — gere outro'}
                  </p>
                  {canal === 'telegram' ? (
                    <p className="text-sm text-muted-foreground">
                      Abra <span className="font-medium">t.me/{telegramBot || 'seu_bot'}</span>, toque em Iniciar e
                      envie o código acima.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No servidor da Enterplak, digite{' '}
                      <span className="font-medium">/vincular {aberto.codigo}</span>.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {nome}, esta tela confirma sozinha quando o vínculo chegar.
                  </p>
                </div>
              )}
            </div>
          )
        })}
        {dialog}
      </CardContent>
    </Card>
  )
}
