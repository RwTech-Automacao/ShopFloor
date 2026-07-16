import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ArmazenamentoFotos } from '../../domain/armazenamento-fotos'

/** Lê uma env obrigatória do R2 ou lança um erro claro (evita erro críptico do SDK). */
function env(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Configuração do R2 ausente: ${nome}.`)
  return valor
}

/** Adapter Cloudflare R2 (S3-compatível). Bucket privado; exibição por URL assinada. */
export function criarArmazenamentoR2(): ArmazenamentoFotos {
  const bucket = env('R2_BUCKET')
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  })

  return {
    async subir(chave, dados, mime) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: chave,
          Body: new Uint8Array(dados),
          ContentType: mime,
        }),
      )
    },
    async urlAssinada(chave, segundos = 3600) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: chave }), {
        expiresIn: segundos,
      })
    },
    async remover(chave) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: chave }))
    },
  }
}
