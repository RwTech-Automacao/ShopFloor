export interface GrupoMes {
  chave: string // 'YYYY-MM' ou 'sem_data'
  rotulo: string
  total: number
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** Chave a partir de uma data 'YYYY-MM-DD' (ou nula). Usa os 7 primeiros
 *  caracteres — nada de `new Date()` — para não sofrer conversão de fuso. */
export function chaveMes(data: string | null | undefined): string {
  if (!data) return 'sem_data'
  const m = /^(\d{4})-(\d{2})/.exec(data)
  return m ? `${m[1]}-${m[2]}` : 'sem_data'
}

/** 'Julho/2026' ou 'Aguardando chegada'. */
export function rotuloMes(chave: string): string {
  if (chave === 'sem_data') return 'Aguardando chegada'
  const [ano, mes] = chave.split('-')
  const nome = MESES_PT[Number(mes) - 1] ?? mes
  return `${nome}/${ano}`
}

/** Primeiro dia do mês seguinte, 'YYYY-MM-01', para o recorte `< próximo`. */
export function inicioProximoMes(chave: string): string {
  const parts = chave.split('-').map(Number)
  const ano = parts[0]!
  const mes = parts[1]!
  const proximoMes = mes === 12 ? 1 : mes + 1
  const proximoAno = mes === 12 ? ano + 1 : ano
  return `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01`
}

/** Adiciona o rótulo e ordena os grupos `{chave, total}` já agregados pelo
 *  banco (RPC `processos_meses`): 'sem_data' primeiro, depois os meses do mais
 *  recente ao mais antigo. */
export function montarGrupos(contagens: { chave: string; total: number }[]): GrupoMes[] {
  return contagens
    .map(({ chave, total }) => ({ chave, rotulo: rotuloMes(chave), total }))
    .sort((a, b) => {
      if (a.chave === 'sem_data') return -1
      if (b.chave === 'sem_data') return 1
      return b.chave.localeCompare(a.chave)
    })
}
