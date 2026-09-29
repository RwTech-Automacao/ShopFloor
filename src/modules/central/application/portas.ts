import type { Foto, LinhaOrdem, LinhaRecebimento } from '../domain/foto'

/** Busca as duas listas cruas (implementado por `infra/leitura.ts`; de mentira nos testes). */
export interface LeitorFoto {
  lerRecebimentos(): Promise<LinhaRecebimento[]>
  lerOrdens(): Promise<LinhaOrdem[]>
}

/** O que a Central respondeu — repassado como veio, sem reinterpretar o corpo. */
export interface RespostaCentral {
  status: number
  corpo: unknown
}

/** Manda a foto pronta pra Central (implementado por `infra/envio.ts`; de mentira nos testes). */
export interface EnviadorFoto {
  enviar(foto: Foto): Promise<RespostaCentral>
}
