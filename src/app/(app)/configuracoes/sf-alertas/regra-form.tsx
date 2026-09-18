'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatarTaxa } from '@/modules/alertas/domain/taxa'
import { CANAIS, NOME_CANAL, type Canal } from '@/modules/alertas/domain/tipos'
import {
  PADROES_REGRA,
  destinatariosSemCanal,
  validarRegra,
  type DestinatarioDisponivel,
  type EntradaRegra,
  type RegraAlerta,
} from '@/modules/alertas/domain/regra'
import type { PreviaPosto } from '@/modules/alertas/domain/ocorrencia'
import { previaRegraAction, salvarRegraAction } from '@/modules/alertas/application/alertas-actions'
import { Explica } from './explica'

const TOAST = { position: 'bottom-center' } as const
/** Mensagem do repositório quando a regra já foi excluída (exclusão lógica) por outro gestor. */
export const ERRO_REGRA_EXCLUIDA = 'Essa regra foi excluída.'

/**
 * Destinatários salvos que não estão mais entre os disponíveis (usuário desativado ou removido —
 * `alerta_destinatarios` só devolve ativos). Saem da seleção ao abrir o formulário; o aviso pede
 * para salvar e confirmar. Lista de disponíveis vazia = nada carregou: não descarta ninguém.
 */
export function separarDestinatarios(
  salvos: string[],
  disponiveis: DestinatarioDisponivel[],
): { validos: string[]; descartados: number } {
  if (disponiveis.length === 0) return { validos: salvos, descartados: 0 }
  const ids = new Set(disponiveis.map((d) => d.usuarioId))
  const validos = salvos.filter((id) => ids.has(id))
  return { validos, descartados: salvos.length - validos.length }
}

function alterna<T>(lista: T[], item: T): T[] {
  return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]
}

export function RegraForm({
  regra,
  postos,
  destinatarios,
  configurados,
  onSalvo,
  onCancelar,
  onRegraExcluida,
}: {
  regra: RegraAlerta | null
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  onSalvo: () => void
  onCancelar: () => void
  /** A regra foi excluída por outro gestor enquanto o diálogo estava aberto. */
  onRegraExcluida?: () => void
}) {
  const [nome, setNome] = useState(regra?.nome ?? '')
  const [postosSel, setPostosSel] = useState<string[]>(regra?.postos ?? [])
  const [taxa, setTaxa] = useState(String(regra?.taxaMinima ?? PADROES_REGRA.taxaMinima).replace('.', ','))
  const [janelaTipo, setJanelaTipo] = useState<'tempo' | 'bipes' | 'op'>(regra?.janelaTipo ?? 'tempo')
  const [minutos, setMinutos] = useState(
    String(
      regra?.janelaTipo === 'tempo' ? (regra.janelaValor ?? PADROES_REGRA.janelaTempo) : PADROES_REGRA.janelaTempo,
    ),
  )
  const [bipes, setBipes] = useState(
    String(
      regra?.janelaTipo === 'bipes' ? (regra.janelaValor ?? PADROES_REGRA.janelaBipes) : PADROES_REGRA.janelaBipes,
    ),
  )
  const [minimo, setMinimo] = useState(String(regra?.minimoBipes ?? PADROES_REGRA.minimoBipes))
  const [lembrete, setLembrete] = useState(regra?.lembreteMin === null || regra === null ? '' : String(regra.lembreteMin))
  const [canaisSel, setCanaisSel] = useState<Canal[]>(regra?.canais ?? [])
  const [inicioDest] = useState(() => separarDestinatarios(regra?.destinatarios ?? [], destinatarios))
  const [destSel, setDestSel] = useState<string[]>(inicioDest.validos)
  const [previa, setPrevia] = useState<PreviaPosto[] | null>(null)
  const [pendente, startTransition] = useTransition()

  const avisos = destinatariosSemCanal(destinatarios, destSel, canaisSel)

  function entrada(): EntradaRegra {
    return {
      nome,
      postos: postosSel,
      taxaMinima: taxa,
      janelaTipo,
      janelaValor: janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : null,
      minimoBipes: minimo,
      lembreteMin: lembrete,
      canais: canaisSel,
      destinatarios: destSel,
      ativa: regra?.ativa ?? true,
    }
  }

  function salvar() {
    // Mesma validação do servidor, antes de ir ao banco: o gestor vê o erro na hora.
    const dados = entrada()
    const v = validarRegra(dados)
    if (!v.ok) {
      toast.error(v.erro, TOAST)
      return
    }
    startTransition(async () => {
      const r = await salvarRegraAction(regra?.id ?? null, dados)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        if (r.erro === ERRO_REGRA_EXCLUIDA) onRegraExcluida?.()
        return
      }
      toast.success(regra ? 'Regra alterada' : 'Regra criada', TOAST)
      onSalvo()
    })
  }

  function verPrevia() {
    startTransition(async () => {
      const r = await previaRegraAction({
        postos: postosSel,
        janelaTipo,
        janelaValor: janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : null,
        minimoBipes: minimo,
      })
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      setPrevia(r.postos)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Teste abaixo de 90" autoComplete="off" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Postos
          <Explica titulo="Postos">
            <p>Os postos que esta regra acompanha.</p>
            <p>A taxa é calculada <strong>separada para cada posto</strong> marcado. Cada posto que ficar abaixo da meta abre o seu próprio alerta.</p>
          </Explica>
        </legend>
        <div className="flex flex-wrap gap-3">
          {postos.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={`posto-${p}`}
                aria-label={p}
                checked={postosSel.includes(p)}
                onChange={() => setPostosSel((atual) => alterna(atual, p))}
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="taxa">Taxa mínima (%)</Label>
            <Explica titulo="Taxa mínima (%)">
              <p>A meta de aprovação do posto. Se a taxa ficar <strong>abaixo</strong> dela, o alerta é enviado.</p>
              <p>Taxa = aprovados ÷ (aprovados + reprovados) × 100, contando só os bipes com resultado <strong>Aprovado</strong> ou <strong>Reprovado</strong> dentro da janela. Bipes só com Registrado ficam de fora.</p>
              <p>Ex.: 45 aprovados e 5 reprovados = 90%. Com meta 95, alerta; com meta 90, não.</p>
              <p>A conta é refeita a cada 5 minutos.</p>
            </Explica>
          </div>
          <Input id="taxa" value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="minimo">Mínimo de bipes</Label>
            <Explica titulo="Mínimo de bipes">
              <p>Quantos bipes com resultado (aprovados + reprovados) a janela precisa ter para a regra avaliar.</p>
              <p>Evita alarme falso com poucas peças: com 1 reprova em 2 bipes a taxa seria 50%. Abaixo do mínimo, a regra não abre nem encerra alerta.</p>
            </Explica>
          </div>
          <Input id="minimo" value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Janela
          <Explica titulo="Janela">
            <p>Quais bipes entram na conta da taxa:</p>
            <p><strong>Últimos X minutos</strong>: os bipes do posto nesse período, de todas as OPs (até 7 dias).</p>
            <p><strong>Últimos N bipes</strong>: os N bipes com resultado mais recentes do posto, de todas as OPs, olhando no máximo 30 dias. Precisa ser maior ou igual ao mínimo de bipes.</p>
            <p><strong>OP em andamento</strong>: todos os bipes do posto na OP do último bipe dele. Se o posto está parado há mais de 2 horas, não avalia.</p>
          </Explica>
        </legend>
        {/* Rádio e campo ficam FORA de um <label> comum de propósito: um label envolvendo dois
            controles deixa "Últimos minutos" ambíguo (para o leitor de tela e para o teste). */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="janela"
            aria-label="Janela por tempo"
            checked={janelaTipo === 'tempo'}
            onChange={() => setJanelaTipo('tempo')}
          />
          <span>Últimos</span>
          <Input
            aria-label="Últimos minutos"
            className="w-20"
            value={minutos}
            onChange={(e) => setMinutos(e.target.value)}
            inputMode="numeric"
            disabled={janelaTipo !== 'tempo'}
          />
          <span>minutos</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="janela"
            aria-label="Janela por bipes"
            checked={janelaTipo === 'bipes'}
            onChange={() => setJanelaTipo('bipes')}
          />
          <span>Últimos</span>
          <Input
            aria-label="Quantidade de bipes"
            className="w-20"
            value={bipes}
            onChange={(e) => setBipes(e.target.value)}
            inputMode="numeric"
            disabled={janelaTipo !== 'bipes'}
          />
          <span>bipes</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="janela"
            aria-label="OP em andamento"
            checked={janelaTipo === 'op'}
            onChange={() => setJanelaTipo('op')}
          />
          OP em andamento
        </label>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="lembrete">Lembrar a cada (min)</Label>
          <Explica titulo="Lembrar a cada (min)">
            <p>Enquanto o posto continuar abaixo da meta e ninguém apertar <strong>Resolvido</strong>, o alerta é reenviado a cada X minutos.</p>
            <p>Vazio = só um alerta quando cai e um aviso quando normaliza.</p>
          </Explica>
        </div>
        <Input
          id="lembrete"
          value={lembrete}
          onChange={(e) => setLembrete(e.target.value)}
          inputMode="numeric"
          placeholder="vazio = sem lembrete"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Canais</legend>
        <div className="flex gap-4">
          {CANAIS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={NOME_CANAL[c]}
                checked={canaisSel.includes(c)}
                onChange={() => setCanaisSel((atual) => alterna(atual, c))}
              />
              {NOME_CANAL[c]}
              {!configurados[c] && <span className="text-xs text-muted-foreground">(não configurado)</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Destinatários</legend>
        <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
          {destinatarios.map((d) => (
            <label key={d.usuarioId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={d.nome}
                checked={destSel.includes(d.usuarioId)}
                onChange={() => setDestSel((atual) => alterna(atual, d.usuarioId))}
              />
              {d.nome}
              <span className="text-xs text-muted-foreground">
                Telegram {d.telegram ? '✓' : '—'} · Discord {d.discord ? '✓' : '—'}
              </span>
            </label>
          ))}
        </div>
        {inicioDest.descartados > 0 && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {inicioDest.descartados} destinatário(s) inativo(s) removido(s) da regra — salve para confirmar.
          </p>
        )}
        {avisos.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </fieldset>

      {previa && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
          <span className="font-medium">Taxa de agora</span>
          {previa.map((p) => (
            <span key={p.posto} className="text-muted-foreground">
              {p.avaliavel
                ? `${p.posto}: ${formatarTaxa(p.aprovados, p.reprovados)}% (${p.aprovados} aprovados, ${p.reprovados} reprovados)`
                : `${p.posto}: bipes insuficientes na janela (${p.aprovados + p.reprovados})`}
            </span>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancelar} disabled={pendente}>
          Cancelar
        </Button>
        <Button variant="outline" onClick={verPrevia} disabled={pendente}>
          Ver prévia
        </Button>
        <Button onClick={salvar} disabled={pendente} className="bg-enterplak hover:bg-enterplak-700">
          {pendente ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
