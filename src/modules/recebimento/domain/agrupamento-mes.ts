const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** 'Julho/2026' ou 'Aguardando chegada'. */
export function rotuloMes(chave: string): string {
  if (chave === 'sem_data') return 'Aguardando data de chegada'
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
