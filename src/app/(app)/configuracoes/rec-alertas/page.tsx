import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { alertasRecebimentoLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados, canalDiscordConfigurado } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from '@/modules/alertas/ui/alertas-tela'

/**
 * Alertas do Recebimento — a MESMA tela do ShopFloor, montada com `modulo="recebimento"`
 * (spec de 2026-10-09, decisão 2). O que muda é só o que esta página carrega:
 *
 * ⚠️ NÃO chama `listarPostos`/`mapaPostoPerfil`/`listarPmosAlerta`, e isso não é economia: posto e
 * PMO são do ShopFloor. `alerta_pmos()` levanta SEM_PERMISSAO para quem não administra o ShopFloor,
 * e `sf_postos` é lido por RLS de ShopFloor — chamar qualquer um dos três aqui faria a tela do
 * Recebimento estourar (ou vir vazia) na mão de quem administra só o Recebimento, que é exatamente
 * a pessoa do caso de aceitação 7. Os tipos de regra do Recebimento não usam posto nem PMO.
 */
export default async function AlertasRecebimentoPage() {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'recebimento', 'administrar') ||
    !alertasRecebimentoLiberados(sessao.email)
  ) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, destinatarios, ocorrencias] = await Promise.all([
    listarRegras('recebimento'),
    listarDestinatarios('recebimento'),
    listarOcorrencias('recebimento', filtro),
  ])

  return (
    <AlertasTela
      modulo="recebimento"
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
