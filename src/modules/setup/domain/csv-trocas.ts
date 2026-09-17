import type { Troca } from '../infra/setup-repository'

// `import type` é apagado na compilação: importar só o tipo de um módulo `server-only` é seguro
// mesmo este arquivo rodando no cliente (nenhum código do repositório entra no bundle).
const CAMPO = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const DATA = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

/** CSV das trocas de rolo: `;` como separador e BOM no início, mesma convenção do CSV da folha da caixa. */
export function trocasParaCsv(trocas: Troca[]): string {
  const cab = ['Data/hora', 'PMO', 'OP', 'Linha', 'Máquina/Bloco', 'Face', 'Posição', 'Feeder', 'Rolo que saiu', 'Rolo que entrou', 'SN Inicial', 'Resultado', 'Motivos', 'Operador']
  const linhas = trocas.map((t) => [DATA(t.dataHora), t.pmo, t.op, t.linha, t.equipamento, t.face, t.posicao, t.feeder, t.roloSaida, t.roloEntrada, t.snInicial, t.resultado, t.motivos.join(' '), t.operadorNome].map(CAMPO).join(';'))
  return '﻿' + [cab.join(';'), ...linhas].join('\n') + '\n'
}
