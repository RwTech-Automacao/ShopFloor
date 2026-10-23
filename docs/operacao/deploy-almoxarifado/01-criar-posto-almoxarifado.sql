-- Cria o posto Almoxarifado (perfil de recurso 'almoxarifado') em produção, se ainda não existir.
-- O perfil `almoxarifado` já foi semeado pela 0128. NÃO mexe nas OPs antigas: o posto só entra na rota das OPs
-- que forem cadastradas a partir de agora (ou na edição manual de uma OP). Idempotente.
-- Rode com: psql ... -v ON_ERROR_STOP=1 -f <este arquivo>
\set ON_ERROR_STOP on
begin;
insert into sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso)
values ('almoxarifado', 'Almoxarifado', false, 'nenhum', 'registrado', false, 'almoxarifado')
on conflict (chave) do nothing;
insert into sf_postos (chave, ordem, perfil, coletivo)
select 'Almoxarifado', (select coalesce(max(ordem), 0) + 10 from sf_postos), 'almoxarifado', false
 where not exists (select 1 from sf_postos where chave = 'Almoxarifado');
commit;
-- Resultado (só lê): deve aparecer UM posto com recurso almoxarifado.
select po.chave, po.ordem, po.perfil, pe.recurso
  from sf_postos po join sf_posto_perfis pe on pe.chave = po.perfil
 where pe.recurso = 'almoxarifado';
