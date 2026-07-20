-- Correção de texto: o rótulo do campo `di_inpi` passa de "Nº DI/INPI" para
-- "Nº DI/DUINPI" (nomenclatura correta). O rótulo é o que aparece na tela em
-- todo lugar (grid, formulário do processo, mapeamento da importação), então
-- esta é a única fonte a mudar. Migração corretiva (não editamos a 0003 já
-- aplicada) — assim a prod é corrigida no apply e um banco novo (Dev×Prod)
-- termina com o rótulo certo após o replay.
update public.configuracao_campos
set rotulo = 'Nº DI/DUINPI'
where campo = 'di_inpi';
