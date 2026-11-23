import { redirect } from 'next/navigation'

/** A tela antiga saiu: links salvos e alertas que apontam para cá seguem para a lista de Ordens de Produção. */
export default function OrdensPage() {
  redirect('/shopfloor/ordens-nova')
}
