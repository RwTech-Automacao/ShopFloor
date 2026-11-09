'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PlanilhaDivergencias } from '@/modules/recebimento/domain/emb-relatorio-excel'

/**
 * Baixa as divergências do relatório da EMB em .xlsx, gerado no navegador. A página já monta as linhas
 * (`planilhaDivergencias`); o `xlsx` só é carregado no clique, para não pesar na abertura da página.
 */
export function BotaoExportarExcel({ planilha }: { planilha: PlanilhaDivergencias }) {
  const [exportando, setExportando] = useState(false)

  async function exportar() {
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(planilha.linhas), planilha.nomeAba)
      XLSX.writeFile(wb, planilha.nomeArquivo)
    } catch {
      toast.error('Não foi possível exportar a planilha.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={exportar} disabled={exportando}>
      <Download className="mr-1 size-4" /> {exportando ? 'Exportando…' : 'Exportar para Excel'}
    </Button>
  )
}
