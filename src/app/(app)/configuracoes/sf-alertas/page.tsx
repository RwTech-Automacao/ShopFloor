import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/postos-repository'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados } from '@/modules/alertas/infra/canais'
import { listarDestinatarios, listarOcorrencias, listarRegras } from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from './alertas-tela'

export default async function AlertasPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, postos, destinatarios, ocorrencias] = await Promise.all([
    listarRegras(),
    listarPostos(),
    listarDestinatarios(),
    listarOcorrencias(filtro),
  ])

  return (
    <AlertasTela
      regras={regras}
      postos={postos}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
