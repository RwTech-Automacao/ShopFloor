const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  OP_INEXISTENTE: 'OP não encontrada no ShopFloor.',
  PMO_INEXISTENTE: 'Essa PMO não existe no ShopFloor.',
  EQUIPAMENTO_INVALIDO: 'Esse equipamento não está cadastrado ou está inativo.',
  FACE_INVALIDA: 'Face inválida.',
  FACE_SOBREPOSTA: 'Já existe setup dessa OP nesse equipamento com uma face que se sobrepõe (TOP E BOT).',
  SN_OBRIGATORIO: 'Informe o número de série.',
  SN_FORA_DA_FAIXA: 'O número de série não pertence à faixa da OP.',
  COPIA_INCOMPATIVEL: 'O setup de origem é de outra PMO, equipamento ou face.',
  SETUP_INEXISTENTE: 'Setup não encontrado.',
  SETUP_LIBERADO: 'O setup já foi liberado. Só um administrador pode alterá-lo.',
  SETUP_NAO_LIBERADO: 'O setup ainda não foi liberado.',
  CAMPOS_OBRIGATORIOS: 'Preencha todos os campos.',
  ROLO_INVALIDO: 'Código do rolo inválido. O formato é CÓDIGO-LOTE (ex.: CAPJ41-8521556004).',
  COMPONENTE_FORA_DA_ESTRUTURA: 'Esse componente não está na estrutura da PMO.',
  COMPONENTE_OUTRO_PROCESSO: 'Esse componente é de outro processo (SMD × PTH).',
  COMPONENTE_DIFERENTE_DA_POSICAO: 'O rolo é de um componente diferente do cadastrado nessa posição.',
  POSICAO_JA_CADASTRADA: 'Essa posição já está cadastrada com rolo nesse setup.',
  POSICAO_COM_OUTRO_FEEDER: 'Essa posição já está com outro feeder.',
  FEEDER_EM_OUTRA_POSICAO: 'Esse feeder já está em outra posição.',
  ROLO_JA_MONTADO: 'Esse rolo já está montado em outra posição do setup.',
  SETUP_VAZIO: 'O setup não tem nenhuma posição.',
  FALTA_ROLO: 'Ainda há posições sem rolo bipado.',
  ITEM_INEXISTENTE: 'Posição não encontrada.',
  COMPONENTE_INVALIDO: 'Código de componente inválido.',
  PROCESSO_INVALIDO: 'Processo inválido.',
}

/** Traduz o código (`raise exception 'CODIGO'`) que chega dentro da mensagem de erro do Postgres. */
export function mensagemErroSetup(textoErro: string): string {
  const texto = textoErro ?? ''
  for (const [codigo, mensagem] of Object.entries(MENSAGENS)) {
    if (texto.includes(codigo)) return mensagem
  }
  return 'Não foi possível concluir a operação.'
}
