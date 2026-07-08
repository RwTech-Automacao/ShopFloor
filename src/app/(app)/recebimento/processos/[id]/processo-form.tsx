'use client'

import { useState, useTransition } from 'react'
import { AlertTriangleIcon, CheckIcon } from 'lucide-react'
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
import { salvarProcesso } from '@/modules/recebimento/application/salvar-processo'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'

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
}

type ResultadoSalvar = { ok: true } | { ok: false; erro: string }

export function ProcessoForm({
  processoId,
  campos,
  itensPorLista,
  valoresIniciais,
  somenteLeitura,
}: ProcessoFormProps) {
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {}
    for (const campo of campos) {
      const valor = valoresIniciais[campo.campo]
      inicial[campo.campo] = valor === null || valor === undefined ? '' : String(valor)
    }
    return inicial
  })
  const [salvando, startTransition] = useTransition()
  const [resultado, setResultado] = useState<ResultadoSalvar | null>(null)

  function atualizarValor(campo: string, valor: string) {
    setResultado(null)
    setValores((atual) => ({ ...atual, [campo]: valor }))
  }

  function onSalvar() {
    setResultado(null)
    startTransition(async () => {
      const payload: Record<string, unknown> = {}
      for (const campo of campos) {
        const bruto = valores[campo.campo] ?? ''
        // Campos numéricos são convertidos aqui (input type="number", ponto
        // decimal) para não passar pelo parser BR de `converterValor`
        // (pensado para células de planilha, vírgula decimal).
        payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
      }
      const r = await salvarProcesso(processoId, payload)
      setResultado(r.ok ? { ok: true } : { ok: false, erro: r.erro })
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
      {gruposComCampos.map((grupo) => (
        <Card key={grupo.chave}>
          <CardHeader>
            <CardTitle>{grupo.rotulo}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {grupo.campos.map((campo) => (
                <CampoControle
                  key={campo.campo}
                  campo={campo}
                  valor={valores[campo.campo] ?? ''}
                  itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                  somenteLeitura={somenteLeitura}
                  onChange={(valor) => atualizarValor(campo.campo, valor)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {!somenteLeitura && (
        <div className="flex items-center gap-3">
          <Button onClick={onSalvar} disabled={salvando} className="bg-enterplak hover:bg-enterplak-700">
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
          {resultado?.ok && (
            <span className="flex items-center gap-1.5 text-sm text-green-700">
              <CheckIcon className="size-4 shrink-0" /> Processo salvo.
            </span>
          )}
          {resultado && !resultado.ok && (
            <span className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertTriangleIcon className="size-4 shrink-0" /> {resultado.erro}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

interface CampoControleProps {
  campo: CampoFormulario
  valor: string
  itens: string[]
  somenteLeitura: boolean
  onChange: (valor: string) => void
}

function CampoControle({ campo, valor, itens, somenteLeitura, onChange }: CampoControleProps) {
  const inputId = `campo-${campo.campo}`

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
