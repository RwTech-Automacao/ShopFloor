-- SPI passa a coletar defeito (código) na reprova, igual aos outros testes de defeito
-- (o autocomplete usa uma lista fixa de solda no front). Antes: reprova por posição.
update public.sf_posto_perfis set reprova = 'defeitos' where chave = 'spi';
