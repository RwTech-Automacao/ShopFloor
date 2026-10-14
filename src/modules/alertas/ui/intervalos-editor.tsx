'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { lerHhMm, sobraDoIntervalo, type Intervalo } from '@/modules/alertas/domain/intervalos'
import { formatarDuracao } from '@/modules/alertas/domain/relogio'

/** Linha nova: nasce vazia e o gestor digita os dois horários. */
const LINHA_VAZIA: Intervalo = { inicio: '', fim: '' }

function minutosDoIntervalo(i: Intervalo): number {
  return (lerHhMm(i.fim) ?? 0) - (lerHhMm(i.inicio) ?? 0)
}

/**
 * Os horários do turno da janela por blocos: uma linha por intervalo (ex.: 07:00–12:00 e
 * 13:30–17:30). O passo vem de fora porque é ele que fatia cada intervalo em blocos, e é só com ele
 * que dá para dizer se o último bloco da faixa fica mais curto.
 *
 * O aviso da sobra é AVISO, não erro: a configuração é válida e o gestor pode querer exatamente
 * isso (o último pedaço do turno também é medido, com a faixa real). Quem recusa de fato é
 * `validarIntervalos`, no salvar.
 */
export function IntervalosEditor({
  intervalos,
  passoMin,
  onChange,
}: {
  intervalos: Intervalo[]
  /** O passo em minutos como está no campo. Texto que não é inteiro = sem aviso de sobra. */
  passoMin: number
  onChange: (intervalos: Intervalo[]) => void
}) {
  /** Mexe SÓ na linha do índice: `filter`/`map` por índice, nunca a primeira por descuido. */
  function trocar(indice: number, campos: Partial<Intervalo>) {
    onChange(intervalos.map((it, i) => (i === indice ? { ...it, ...campos } : it)))
  }

  function remover(indice: number) {
    onChange(intervalos.filter((_, i) => i !== indice))
  }

  return (
    <div className="flex flex-col gap-2">
      {intervalos.map((it, i) => {
        const sobra = sobraDoIntervalo(it, passoMin)
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input
                type="time"
                aria-label={`Início do intervalo ${i + 1}`}
                className="w-28"
                value={it.inicio}
                onChange={(e) => trocar(i, { inicio: e.target.value })}
              />
              <span>até</span>
              <Input
                type="time"
                aria-label={`Fim do intervalo ${i + 1}`}
                className="w-28"
                value={it.fim}
                onChange={(e) => trocar(i, { fim: e.target.value })}
              />
              {/* O texto é "Remover" em todas as linhas; o `aria-label` numerado é o que diz QUAL
                  linha sai — para o leitor de tela e para o teste. */}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover intervalo ${i + 1}`}
                onClick={() => remover(i)}
              >
                Remover
              </Button>
            </div>
            {sobra && (
              <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                O passo não fecha com o intervalo: o último bloco de {it.inicio}–{it.fim} vai de{' '}
                {sobra.inicio} às {sobra.fim} ({formatarDuracao(minutosDoIntervalo(sobra) * 60_000)} em vez de{' '}
                {formatarDuracao(passoMin * 60_000)}). Ele será medido e avisado com a faixa real.
              </p>
            )}
          </div>
        )
      })}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...intervalos, LINHA_VAZIA])}
      >
        Adicionar intervalo
      </Button>
    </div>
  )
}
