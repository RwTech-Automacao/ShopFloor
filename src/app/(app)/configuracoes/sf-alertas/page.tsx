import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { PERFIL_PADRAO } from '@/modules/shopfloor/domain/perfil-posto'
import { listarPostos, mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { alertasLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { postoRegraDe } from '@/modules/alertas/domain/postos-regra'
import { canaisConfigurados, canalDiscordConfigurado } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarPmosAlerta,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from '@/modules/alertas/ui/alertas-tela'

/**
 * Alertas do ShopFloor. A tela mora em `@/modules/alertas/ui` porque serve DUAS rotas (spec de
 * 2026-10-09, decisão 2); esta página só carrega o que é do ShopFloor e passa `modulo="shopfloor"`.
 */
export default async function AlertasShopFloorPage() {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar') ||
    !alertasLiberados(sessao.email)
  ) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, postos, perfis, pmos, destinatarios, ocorrencias] = await Promise.all([
    listarRegras('shopfloor'),
    listarPostos(),
    mapaPostoPerfil(),
    listarPmosAlerta(),
    listarDestinatarios('shopfloor'),
    listarOcorrencias('shopfloor', filtro),
  ])

  // O perfil do posto decide quais tipos de regra fazem sentido nele. `listarPostos` já vem na ordem
  // do fluxo; posto sem perfil cai no padrão (passagem), como no resto do módulo.
  const postosRegra = postos.map((chave) => postoRegraDe(chave, perfis[chave] ?? PERFIL_PADRAO))

  return (
    <AlertasTela
      modulo="shopfloor"
      regras={regras}
      postos={postosRegra}
      pmos={pmos}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      canalConfigurado={canalDiscordConfigurado()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
