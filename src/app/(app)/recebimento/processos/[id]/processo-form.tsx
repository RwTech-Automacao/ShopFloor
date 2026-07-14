'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { salvarSecaoProcesso, type Secao } from '@/modules/recebimento/application/salvar-secao-processo'
import { calcularCamposCalculados, type CampoCalc, type FaixaNqa } from '@/modules/recebimento/domain/calculos'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { cn } from '@/lib/utils'
import { CampoControle } from '../campo-controle'

const GRUPOS: { chave: CampoFormulario['grupo']; rotulo: string }[] = [
  { chave: 'comercial', rotulo: 'Comercial' },
  { chave: 'material', rotulo: 'Material' },
  { chave: 'recebimento', rotulo: 'Recebimento' },
  { chave: 'qualidade', rotulo: 'Qualidade' },
]

interface ProcessoFormProps {
  processoId: string
  campos: CampoFormulario[]
  itensPorLista: Record<string, string[]>
  valoresIniciais: Record<string, string | number | null>
  somenteLeitura: boolean
  /**
   * Notifica o pai sempre que o estado "tem alterações não salvas" mudar —
   * usado para bloquear o botão Finalizar enquanto o formulário diverge dos
   * valores salvos (evita finalizar com dados desatualizados/incompletos).
   */
  onDirtyChange?: (dirty: boolean) => void
  /** Lista de fornecedores críticos, para o cálculo ao vivo de `critico` (presença = crítico). */
  fornecedoresCriticos: string[]
  /** Tabela NQA (faixas de quantidade -> amostra), para o cálculo ao vivo de `amostral`. */
  nqa: FaixaNqa[]
  /** Nome/e-mail do usuário logado, repassado ao contexto de cálculo ao vivo. */
  usuarioAtual: string
  /** Nome de quem salvou por último a seção Recebimento, ou `null` se ainda não salva. Somente exibição. */
  responsavelRecebimento: string | null
  /** Nome de quem salvou por último a seção Qualidade, ou `null` se ainda não salva. Somente exibição. */
  responsavelQualidade: string | null
}


function valoresIniciaisComoTexto(
  campos: CampoFormulario[],
  valoresIniciais: Record<string, string | number | null>,
): Record<string, string> {
  const inicial: Record<string, string> = {}
  for (const campo of campos) {
    const valor = valoresIniciais[campo.campo]
    inicial[campo.campo] = valor === null || valor === undefined ? '' : String(valor)
  }
  return inicial
}

export function ProcessoForm({
  processoId,
  campos,
  itensPorLista,
  valoresIniciais,
  somenteLeitura,
  onDirtyChange,
  fornecedoresCriticos,
  nqa,
  usuarioAtual,
  responsavelRecebimento,
  responsavelQualidade,
}: ProcessoFormProps) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    valoresIniciaisComoTexto(campos, valoresIniciais),
  )
  const [salvando, startTransition] = useTransition()

  const valoresIniciaisTexto = useMemo(
    () => valoresIniciaisComoTexto(campos, valoresIniciais),
    [campos, valoresIniciais],
  )
  // "Alterações não salvas" considera SOMENTE os campos editáveis. Os campos
  // calculados são recomputados pelo servidor ao salvar; após a revalidação, o
  // `valoresIniciais` passa a conter os novos valores calculados enquanto o
  // estado local ainda tem os antigos — se contados aqui, `dirty` ficaria
  // eternamente verdadeiro e travaria o botão Finalizar. Por isso os excluímos.
  const dirty = useMemo(
    () =>
      campos.some(
        (campo) =>
          !campo.calculado &&
          (valores[campo.campo] ?? '') !== (valoresIniciaisTexto[campo.campo] ?? ''),
      ),
    [campos, valores, valoresIniciaisTexto],
  )
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Campos calculados (atraso, divergencia, critico, amostral): recomputados
  // ao vivo no cliente conforme o usuário edita os campos de entrada, com a
  // mesma função pura usada autoritativamente pelo servidor em
  // `salvarSecaoProcesso`. Isto é só uma prévia — o servidor sempre recalcula
  // ao salvar.
  const camposCalculados: CampoCalc[] = useMemo(
    () =>
      campos
        .filter((campo) => campo.calculado)
        .map((campo) => ({ campo: campo.campo, formula: campo.formula, formulaConfig: campo.formulaConfig })),
    [campos],
  )
  const valoresCalculados = useMemo(
    () =>
      calcularCamposCalculados(valores, camposCalculados, {
        fornecedoresCriticos,
        nqa,
        usuarioAtual,
        valoresAtuais: valoresIniciais,
      }),
    [valores, camposCalculados, fornecedoresCriticos, nqa, usuarioAtual, valoresIniciais],
  )

  function atualizarValor(campo: string, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }))
  }

  // Monta o payload de uma seção (recebimento OU qualidade): valores dos
  // campos não-calculados dos grupos base (comercial + material) mais os do
  // próprio grupo da seção — os dois botões "Salvar" sempre regravam a base
  // junto, então qualquer um deles persiste as edições feitas em Comercial
  // ou Material mesmo que a seção salva não seja onde o usuário editou.
  function payloadSecao(secao: Secao): Record<string, unknown> {
    const gruposAceitos = new Set(['comercial', 'material', secao])
    const payload: Record<string, unknown> = {}
    for (const campo of campos) {
      // Campos calculados nunca são enviados: são somente-leitura no
      // formulário e o servidor os recomputa autoritativamente ao salvar
      // (enviá-los seria inofensivo — o servidor os descarta — mas omiti-los
      // deixa claro que o cliente nunca é a fonte da verdade).
      if (campo.calculado) continue
      if (!gruposAceitos.has(campo.grupo)) continue
      const bruto = valores[campo.campo] ?? ''
      // Campos numéricos são convertidos aqui (input type="number", ponto
      // decimal) para não passar pelo parser BR de `converterValor`
      // (pensado para células de planilha, vírgula decimal).
      payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
    }
    return payload
  }

  function onSalvarSecao(secao: Secao) {
    startTransition(async () => {
      const r = await salvarSecaoProcesso(processoId, secao, payloadSecao(secao))
      if (r.ok) toast.success(secao === 'recebimento' ? 'Recebimento salvo.' : 'Qualidade salva.')
      else toast.error(r.erro)
    })
  }

  const gruposComCampos = GRUPOS.map((grupo) => ({
    ...grupo,
    campos: campos
      .filter((campo) => campo.grupo === grupo.chave)
      .sort((a, b) => a.ordem - b.ordem),
  })).filter((grupo) => grupo.campos.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {gruposComCampos.map((grupo) => {
        // Só recebimento e qualidade têm botão Salvar próprio — cada um
        // grava a base (comercial + material) junto com os campos da sua
        // seção. Comercial/Material não têm botão: são salvos por qualquer
        // um dos dois botões de seção.
        const secao: Secao | null =
          grupo.chave === 'recebimento' || grupo.chave === 'qualidade' ? grupo.chave : null
        const rotuloBotao = secao === 'recebimento' ? 'Salvar Recebimento' : 'Salvar Qualidade'
        const responsavelSecao =
          secao === 'recebimento' ? responsavelRecebimento : secao === 'qualidade' ? responsavelQualidade : null

        return (
          <Card key={grupo.chave}>
            <CardHeader>
              <CardTitle>{grupo.rotulo}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grupo.campos.map((campo) => (
                  <CampoControle
                    key={campo.campo}
                    campo={campo}
                    valor={valores[campo.campo] ?? ''}
                    valorCalculado={valoresCalculados[campo.campo]}
                    itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                    somenteLeitura={somenteLeitura}
                    obrigatorio={campo.obrigatorioFinalizacao}
                    onChange={(valor) => atualizarValor(campo.campo, valor)}
                  />
                ))}
              </div>

              {secao && (
                <ResponsavelSecaoControle
                  rotulo={secao === 'recebimento' ? 'Responsável Recebimento' : 'Responsável Qualidade'}
                  nome={responsavelSecao}
                />
              )}

              {secao && !somenteLeitura && (
                <div className="flex items-center gap-3">
                  <Button onClick={() => onSalvarSecao(secao)} disabled={salvando}>
                    {salvando ? 'Salvando…' : rotuloBotao}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

interface ResponsavelSecaoControleProps {
  rotulo: string
  /** Nome do usuário que salvou por último a seção, ou `null` se ainda não salva. */
  nome: string | null
}

/**
 * Campo somente-leitura que exibe quem salvou por último uma seção
 * (Recebimento/Qualidade) — nunca faz parte do payload de salvar, é
 * meramente informativo. Mesmo visual de `CampoCalculadoControle` (sem o
 * ícone de cadeado, já que não é um valor calculado a partir de fórmula).
 */
function ResponsavelSecaoControle({ rotulo, nome }: ResponsavelSecaoControleProps) {
  const vazio = !nome
  const textoExibido = vazio ? '—' : nome

  return (
    <div className="flex max-w-sm flex-col gap-2">
      <Label className="text-muted-foreground">{rotulo}</Label>
      <div
        className={cn(
          'flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-input/30 px-2.5 py-1 text-base text-foreground md:text-sm',
          vazio && 'italic text-muted-foreground',
        )}
      >
        <span className="truncate">{textoExibido}</span>
      </div>
    </div>
  )
}
