import 'server-only'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { LinhaBipe, LinhaOrdem } from '../domain/ops-ativas'

/** O PostgREST corta em 1000 linhas por consulta (max_rows): tudo aqui é paginado. */
const PAGINA = 1000

/**
 * Sem recorte de data (`dias` ausente) a varredura de bipes seria a tabela INTEIRA — centenas de
 * milhares de linhas. Nesse caso ela olha só os bipes mais recentes: a OP cujo último bipe for mais
 * antigo que isso aparece na lista com `ultimoBipe` nulo, no fim — que é onde ela estaria de todo
 * modo. Com `dias`, a varredura vai até o fim do recorte (a regra de "teve bipe no período" é
 * exata).
 */
const PAGINAS_SEM_RECORTE = 20

/**
 * As duas leituras que a lista de OPs ativas precisa — SOMENTE leitura, com service role.
 *
 * Service role porque quem chama é o dashboard, autenticado por segredo: não há sessão de usuário
 * (e portanto nenhum `auth.uid()`) para a RLS de `sf_ordens`/`sf_registros` avaliar.
 *
 * O status NÃO é filtrado aqui: a regra do `FINALIZADA` é case-insensitive e mora num lugar só, em
 * `domain/ops-ativas.ts`. Um `not.ilike` aqui seria a mesma regra em dois lugares — a família de
 * defeito que já custou correções neste projeto.
 */
export async function carregarOpsEBipes(
  corte: string | null,
): Promise<{ ordens: LinhaOrdem[]; bipes: LinhaBipe[] }> {
  const supabase = createServiceSupabase()

  const ordens: LinhaOrdem[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_ordens')
      .select('pmo,op,cliente,descricao,status')
      .order('pmo', { ascending: true })
      .order('op', { ascending: true })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as LinhaOrdem[]
    ordens.push(...lote)
    if (lote.length < PAGINA) break
  }

  const bipes: LinhaBipe[] = []
  for (let i = 0; corte !== null || i < PAGINAS_SEM_RECORTE; i++) {
    // Decrescente (com o `id` desempatando, pra paginação não repetir nem pular linha): sem
    // recorte, as primeiras páginas são justamente as que respondem "qual foi o último bipe".
    let q = supabase
      .from('sf_registros')
      .select('pmo,op,data_hora')
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (corte !== null) q = q.gte('data_hora', corte)
    const { data, error } = await q
    if (error) throw error
    const lote = (data ?? []) as LinhaBipe[]
    bipes.push(...lote)
    if (lote.length < PAGINA) break
  }

  return { ordens, bipes }
}
