import { Bloco, Carregando } from '@/shared/ui/carregando'

/**
 * Enquanto o servidor calcula as peças paradas: o título e o esqueleto dos filtros e da lista, no mesmo desenho
 * da tela (page.tsx + parados-tela.tsx), para a troca não "pular".
 */
export default function CarregandoParados() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-tinta">Peças paradas</h2>
        <Carregando />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Bloco className="h-4 w-28" />
            <Bloco className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <Bloco className="h-4 w-12" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => <Bloco key={i} className="h-7 w-24 rounded-full" />)}
        </div>
      </div>
      <Bloco className="h-6 w-72 max-w-full" />
      {Array.from({ length: 4 }, (_, i) => <Bloco key={i} className="h-20 w-full" />)}
    </div>
  )
}
