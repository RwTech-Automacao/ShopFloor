import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarMesesAnexos } from '@/modules/recebimento/infra/anexo-export-repository'
import { rotuloMes } from '@/modules/recebimento/domain/agrupamento-mes'
import { ExportarFotosCliente } from './exportar-fotos-cliente'

export default async function ExportarFotosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para exportar fotos." />
  }

  const meses = await listarMesesAnexos()
  // 'sem_data' por último; meses reais em ordem decrescente (mais recente primeiro).
  const ordenados = [...meses].sort((a, b) => {
    if (a.chave === 'sem_data') return 1
    if (b.chave === 'sem_data') return -1
    return b.chave.localeCompare(a.chave)
  })

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Exportar Fotos</h1>
      {ordenados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto anexada ainda.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {ordenados.map((mes) => (
            <ExportarFotosCliente
              key={mes.chave}
              mes={mes.chave}
              rotulo={rotuloMes(mes.chave)}
              total={mes.total}
            />
          ))}
        </div>
      )}
    </div>
  )
}
