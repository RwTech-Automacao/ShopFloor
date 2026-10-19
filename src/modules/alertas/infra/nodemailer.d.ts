/**
 * Tipos mínimos do nodemailer — só o que `email.ts` usa.
 *
 * Por que não `@types/nodemailer`: ele depende de `@aws-sdk/client-sesv2`, e instalá-lo fazia o npm
 * subir 20 pacotes de PRODUÇÃO da cadeia do `@aws-sdk/client-s3` (o armazenamento do Recebimento no
 * R2) para versões novas, sem relação nenhuma com e-mail. Não se troca a versão do que sobe arquivo
 * em produção por causa de um pacote de tipos. Se um dia o que usamos do nodemailer crescer, esta
 * declaração cresce junto — ou se reavalia o `@types/nodemailer` com o lock sob controle.
 */
declare module 'nodemailer' {
  export interface OpcoesTransporte {
    host: string
    port: number
    secure: boolean
    auth: { user: string; pass: string }
    pool?: boolean
    maxConnections?: number
    connectionTimeout?: number
    greetingTimeout?: number
    socketTimeout?: number
  }

  export interface MensagemEnviada {
    from: string
    to: string
    subject: string
    text: string
  }

  export interface Transporte {
    sendMail(mensagem: MensagemEnviada): Promise<{ messageId?: string }>
  }

  export function createTransport(opcoes: OpcoesTransporte): Transporte
}
