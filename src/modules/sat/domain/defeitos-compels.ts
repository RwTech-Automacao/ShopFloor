import { RespostaInesperada } from '../../compels/domain/leituras-erp'

/**
 * Carga única dos defeitos do SAT do Compels (`sat/defeito/findAll`) em `sat_defeitos` (spec 2026-11-26, decisão 7).
 * A migração não fala com o Compels: o script `tools/compels/defeitos-sat.mjs` lê e IMPRIME o SQL, que é aplicado
 * com `psql -1 -f` (Dev e RDS). Reaplicar não duplica: o código do Compels é a chave.
 */
export interface DefeitoCompels {
  codigo: string
  descricao: string
}

const texto = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim()

export function defeitosDaResposta(linhas: Record<string, unknown>[]): DefeitoCompels[] {
  if (linhas.length === 0) throw new RespostaInesperada('nenhum defeito do SAT veio do Compels')
  const porCodigo = new Map<string, DefeitoCompels>()
  for (const l of linhas) {
    const codigo = texto(l.codigo ?? l.id)
    const descricao = texto(l.descricao ?? l.nome)
    if (codigo === '' || descricao === '') {
      throw new RespostaInesperada(`defeito do SAT sem código ou descrição (campos: ${Object.keys(l).join(', ')})`)
    }
    if (!porCodigo.has(codigo)) porCodigo.set(codigo, { codigo, descricao: descricao.slice(0, 300) })
  }
  return [...porCodigo.values()]
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`

export function sqlDaCargaDeDefeitos(defeitos: DefeitoCompels[], quando: Date): string {
  const valores = defeitos.map((d) => `  (${sql(d.codigo)}, ${sql(d.descricao)})`).join(',\n')
  return [
    `-- ${defeitos.length} defeitos lidos do Compels em ${quando.toISOString()} (tools/compels/defeitos-sat.mjs).`,
    '-- Aplicar com: psql -1 -v ON_ERROR_STOP=1 -f <este arquivo>. Reaplicar não duplica (código do Compels).',
    'insert into public.sat_defeitos as d (codigo_compels, descricao) values',
    valores,
    'on conflict (codigo_compels) do update set descricao = excluded.descricao, atualizado_em = now()',
    ' where d.descricao is distinct from excluded.descricao;',
    '',
  ].join('\n')
}
