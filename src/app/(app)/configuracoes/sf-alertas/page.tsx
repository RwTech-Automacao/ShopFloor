import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/postos-repository'
import { alertasLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarPmosAlerta,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from './alertas-tela'

export default async function AlertasPage() {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar') ||
    !alertasLiberados(sessao.email)
  ) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, postos, pmos, destinatarios, ocorrencias] = await Promise.all([
    listarRegras(),
    listarPostos(),
    listarPmosAlerta(),
    listarDestinatarios(),
    listarOcorrencias(filtro),
  ])

  return (
    <AlertasTela
      regras={regras}
      postos={postos}
      pmos={pmos}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
