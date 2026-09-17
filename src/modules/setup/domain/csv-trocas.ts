import type { Troca } from '../infra/setup-repository'

// `import type` é apagado na compilação: importar só o tipo de um módulo `server-only` é seguro
// mesmo este arquivo rodando no cliente (nenhum código do repositório entra no bundle).

// Protege contra "CSV injection": célula que começa com =, +, - ou @ é interpretada como fórmula
// por Excel/Sheets ao abrir o CSV. Prefixamos com aspas simples pra virar texto literal.
const PROTEGER_FORMULA = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v)
const CAMPO = (v: string) => {
  const p = PROTEGER_FORMULA(v)
  return /[;"\r\n]/.test(p) ? `"${p.replace(/"/g, '""')}"` : p
}
const DATA = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

/** CSV das trocas de rolo: `;` como separador e BOM no início, mesma convenção do CSV da folha da caixa. */
export function trocasParaCsv(trocas: Troca[]): string {
  // Bloco e máquina em colunas separadas (no PTH a máquina fica vazia): a planilha filtra melhor
  // do que com o texto junto de rotuloEquipamento.
  const cab = ['Data/hora', 'PMO', 'OP', 'Processo', 'Linha', 'Bloco', 'Máquina', 'Face', 'Posição', 'Feeder', 'Rolo que saiu', 'Rolo que entrou', 'SN Inicial', 'Resultado', 'Motivos', 'Operador']
  const linhas = trocas.map((t) => [DATA(t.dataHora), t.pmo, t.op, t.processo, t.linha, t.bloco, t.maquina ?? '', t.face, t.posicao, t.feeder, t.roloSaida, t.roloEntrada, t.snInicial, t.resultado, t.motivos.join(' '), t.operadorNome].map(CAMPO).join(';'))
  return '﻿' + [cab.join(';'), ...linhas].join('\n') + '\n'
}
