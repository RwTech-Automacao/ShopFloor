import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { alertasSatLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados, canalDiscordConfigurado } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from '@/modules/alertas/ui/alertas-tela'

/**
 * Alertas do SAT (spec 2026-11-18-sat-alerta-entrada-design.md) — a MESMA tela do ShopFloor e do Recebimento,
 * montada com `modulo="sat"`. Permissão `sat.administrar` (a mesma do menu, das actions e do banco) e a trava
 * própria `ALERTAS_SAT_LIBERADO_PARA` (vazia = fechada em produção, como a do Recebimento).
 *
 * ⚠️ Como na do Recebimento, NÃO carrega postos nem PMOs: são do ShopFloor (RLS/SEM_PERMISSAO para quem
 * administra só o SAT), e o único tipo do SAT (Entrada no SAT) não usa nenhum dos dois.
 */
export default async function AlertasSatPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'administrar') || !alertasSatLiberados(sessao.email)) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, destinatarios, ocorrencias] = await Promise.all([
    listarRegras('sat'),
    listarDestinatarios('sat'),
    listarOcorrencias('sat', filtro),
  ])

  return (
    <AlertasTela
      modulo="sat"
      regras={regras}
      postos={[]}
      pmos={[]}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      canalConfigurado={canalDiscordConfigurado()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
