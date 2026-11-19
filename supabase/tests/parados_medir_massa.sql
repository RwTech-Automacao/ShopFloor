-- Complemento da massa de volume (alertas_travados_massa.sql) para medir a tela "Peças paradas" (sf_pecas_paradas,
-- 0180, sobre a alerta_travados_sns da 0188). Usado por supabase/tests/rodar-parados-medir.sh; NÃO roda nos runners
-- de teste (é lento de propósito). Acrescenta o que a 0183/0188 lê e a massa da 0172 não tem:
--   - caixas: toda peça embalada leva um número de caixa (50 por caixa); as caixas FECHADAS existem em sf_caixas
--     com o código definitivo; nas OPs ativas a ÚLTIMA caixa está ABERTA (registro com o provisório CX[n]);
--   - bipe FORA da rota (Integração) depois da Embalagem em 2% das peças;
--   - Manutenção com posto de origem e retorno (posto_retorno) em 1% das peças;
--   - o cadastro de postos (sf_postos) com os postos das rotas.
begin;
-- Caixa = 50 peças por OP, pela posição do SN (SN<op>-<s>).
update public.sf_registros r
   set numero_caixa = case
         when o.status = 'ATIVA' and (split_part(r.numero_serie, '-', 2)::int - 1) / 50 + 1 = 20
           then 'CX[20]'
         else 'CX[' || ((split_part(r.numero_serie, '-', 2)::int - 1) / 50 + 1) || '][50]' || r.op || '-' || r.pmo
       end
  from public.sf_ordens o
 where o.pmo = r.pmo and o.op = r.op and r.posto = 'Embalagem';

insert into public.sf_caixas (pmo, op, posto, seq, codigo, qtd, fechada, fechada_em)
select o.pmo, o.op, 'Embalagem', k,
       case when o.status = 'ATIVA' and k = 20 then '' else 'CX[' || k || '][50]' || o.op || '-' || o.pmo end,
       case when o.status = 'ATIVA' and k = 20 then 0 else 50 end,
       not (o.status = 'ATIVA' and k = 20),
       case when o.status = 'ATIVA' and k = 20 then null else now() - interval '1 day' end
  from public.sf_ordens o
 cross join generate_series(1, 20) k;

-- Bipe fora da rota (a placa integrada no produto de outra OP), depois do último registro da peça.
insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora, pecas)
select r.pmo, r.op, r.numero_serie, r.numero_serie_norm, 'Integração', 'Aprovado', r.data_hora + interval '1 hour', 1
  from public.sf_registros r
 where r.posto = 'Inicial' and abs(hashtext(r.numero_serie || 'fora')) % 100 < 2;

-- Manutenção com origem e retorno.
insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora, pecas,
                                 posto_origem, posto_retorno)
select r.pmo, r.op, r.numero_serie, r.numero_serie_norm, 'Manutenção', 'Aprovado', r.data_hora + interval '2 hours', 1,
       'Teste', case when abs(hashtext(r.numero_serie || 'ret')) % 2 = 0 then 'Teste' else null end
  from public.sf_registros r
 where r.posto = 'Teste' and r.status = 'Reprovado' and abs(hashtext(r.numero_serie || 'man')) % 3 = 0;

insert into public.sf_posto_perfis (chave, recurso) values ('perfil_massa', '') on conflict do nothing;
insert into public.sf_postos (chave, perfil)
values ('Inicial', 'perfil_massa'), ('Teste', 'perfil_massa'), ('Embalagem', 'perfil_massa'),
       ('Inspeção', 'perfil_massa'), ('Almoxarifado', 'perfil_massa'), ('Integração', 'perfil_massa')
on conflict do nothing;
commit;
