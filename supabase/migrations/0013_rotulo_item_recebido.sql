-- Renomeia o rótulo do campo `codigo_material` para "Item Recebido", alinhando
-- com a nomenclatura da planilha usada hoje pela Enterplak. Muda apenas o texto
-- exibido — o formulário do processo, a tela de importação e a tela de Campos
-- leem este rótulo. A coluna `codigo_material` do processo permanece a mesma.
update public.configuracao_campos
  set rotulo = 'Item Recebido'
  where campo = 'codigo_material';
