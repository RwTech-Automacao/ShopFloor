/**
 * Mensagem quando o cancelamento de uma integração é recusado porque a peça já passou por outros
 * postos depois dela (0116). `postos` vem do banco separado por vírgula ("Embalagem, Inspeção NQA").
 */
export function mensagemPecaAvancou(postos: string): string {
  const lista = postos.trim() || 'outros postos'
  return (
    `Esta peça já passou por ${lista} depois da integração. ` +
    'Para refazer a integração, cancele antes esses lançamentos (Cancelar lançamento, do mais recente para o mais antigo).'
  )
}
