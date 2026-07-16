import 'server-only'
import { Readable } from 'node:stream'
import { google, type drive_v3 } from 'googleapis'
import type { ArmazenamentoFotos } from '../../domain/armazenamento-fotos'

/** Lê uma env obrigatória do Google ou lança um erro claro. */
function env(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Configuração do Google Drive ausente: ${nome}.`)
  return valor
}

let clienteCache: drive_v3.Drive | null = null

function driveClient(): drive_v3.Drive {
  if (clienteCache) return clienteCache
  const oauth = new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'))
  oauth.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') })
  clienteCache = google.drive({ version: 'v3', auth: oauth })
  return clienteCache
}

/** Último segmento da chave (a chave sugerida vem como `processoId/uuid.ext`). */
function nomeArquivo(chave: string): string {
  const partes = chave.split('/')
  return partes[partes.length - 1] || chave
}

/** Adapter Google Drive (OAuth + refresh token). Pasta única; escopo drive.file. */
export function criarArmazenamentoDrive(): ArmazenamentoFotos {
  const folder = env('GOOGLE_DRIVE_FOLDER_ID')
  return {
    async subir(chave, dados, mime) {
      const drive = driveClient()
      const res = await drive.files.create({
        requestBody: { name: nomeArquivo(chave), parents: [folder] },
        media: { mimeType: mime, body: Readable.from(Buffer.from(dados)) },
        fields: 'id',
      })
      const id = res.data.id
      if (!id) throw new Error('O Google Drive não retornou o id do arquivo.')
      return id
    },
    async urlAssinada(chave) {
      // Drive não tem URL assinada: a foto é servida pela rota proxy autenticada.
      return `/api/anexos/${encodeURIComponent(chave)}`
    },
    async remover(chave) {
      const drive = driveClient()
      await drive.files.delete({ fileId: chave })
    },
  }
}

/** Baixa o binário de um arquivo do Drive (usado pela rota de proxy). */
export async function baixarFotoDrive(
  fileId: string,
): Promise<{ dados: ArrayBuffer; mime: string }> {
  const drive = driveClient()
  const meta = await drive.files.get({ fileId, fields: 'mimeType' })
  const mime = meta.data.mimeType ?? 'application/octet-stream'
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  return { dados: res.data as ArrayBuffer, mime }
}
