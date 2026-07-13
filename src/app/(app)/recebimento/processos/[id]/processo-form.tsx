'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { salvarSecaoProcesso, type Secao } from '@/modules/recebimento/application/salvar-secao-processo'
import { calcularCamposCalculados, type CampoCalc, type FaixaNqa } from '@/modules/recebimento/domain/calculos'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { cn } from '@/lib/utils'

// Sentinela para "nenhum valor selecionado": o Select (base-ui) não aceita
// string vazia como value de item, então usamos um marcador único que nunca
// colide com um valor real de lista.
const SEM_VALOR = '__sem_valor__'

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
                    onChange={(valor) => atualizarValor(campo.campo, valor)}
                  />
                ))}
              </div>

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

interface CampoControleProps {
  campo: CampoFormulario
  valor: string
  /** Valor recalculado ao vivo (só usado quando `campo.calculado`); `undefined` se a fórmula não gerou saída para este campo. */
  valorCalculado: string | number | null | undefined
  itens: string[]
  somenteLeitura: boolean
  onChange: (valor: string) => void
}

function CampoControle({ campo, valor, valorCalculado, itens, somenteLeitura, onChange }: CampoControleProps) {
  const inputId = `campo-${campo.campo}`

  if (campo.calculado) {
    return <CampoCalculadoControle campo={campo} valor={valorCalculado} />
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>
        {campo.rotulo}
        {campo.obrigatorioFinalizacao && <span className="text-red-600"> *</span>}
      </Label>

      {campo.tipo === 'lista' ? (
        <Select
          value={valor === '' ? SEM_VALOR : valor}
          onValueChange={(novoValor) => onChange(novoValor === SEM_VALOR ? '' : (novoValor ?? ''))}
          disabled={somenteLeitura}
        >
          <SelectTrigger id={inputId} className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VALOR}>—</SelectItem>
            {/* Preserva o valor atual mesmo que não esteja mais entre os
                itens ativos da lista (ex.: item foi desativado depois que o
                processo recebeu esse valor). */}
            {valor !== '' && !itens.includes(valor) && <SelectItem value={valor}>{valor}</SelectItem>}
            {itens.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={inputId}
          type={campo.tipo === 'numero' ? 'number' : campo.tipo === 'data' ? 'date' : 'text'}
          step={campo.tipo === 'numero' ? 'any' : undefined}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={somenteLeitura}
        />
      )}
    </div>
  )
}

interface CampoCalculadoControleProps {
  campo: CampoFormulario
  valor: string | number | null | undefined
}

/**
 * Renderização somente-leitura de um campo `calculado=true` (atraso,
 * divergencia, critico, amostral): nunca vira um input/select editável,
 * mesmo que `campo.tipo` seja 'lista' — o valor vem sempre do recálculo ao
 * vivo (`calcularCamposCalculados`) feito no componente pai, nunca de
 * digitação do usuário. O estilo (fundo mutado + ícone de cadeado) sinaliza
 * visualmente que o campo é automático.
 */
function CampoCalculadoControle({ campo, valor }: CampoCalculadoControleProps) {
  const inputId = `campo-${campo.campo}`
  const vazio = valor === null || valor === undefined || String(valor).trim() === ''
  const textoExibido = vazio ? '—' : String(valor)

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId} className="flex items-center gap-1 text-muted-foreground">
        {campo.rotulo}
      </Label>
      <div
        id={inputId}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-input/30 px-2.5 py-1 text-base text-foreground md:text-sm',
          vazio && 'italic text-muted-foreground',
        )}
      >
        <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{textoExibido}</span>
      </div>
    </div>
  )
}
