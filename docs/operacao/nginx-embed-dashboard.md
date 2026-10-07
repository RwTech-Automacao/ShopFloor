# nginx: liberar o iframe do Dashboard em `/embed` (PRÉ-REQUISITO do smoke)

O ShopFloor agora manda `Content-Security-Policy: frame-ancestors <dashboard>` nas rotas `/embed/*`
e `frame-ancestors 'self'` no resto (`next.config.ts`).

**Problema:** o navegador honra `X-Frame-Options` **independentemente** do CSP. A revisão de segurança
de 21/09 ligou HSTS, X-Frame e nosniff, e **`X-Frame-Options` não está em nenhum arquivo versionado**
(`deploy/aws/nginx-shopfloor-aws.conf` não tem `add_header`; o Next também não o define). Logo ele
vem do nginx do servidor. Se for `SAMEORIGIN` ou `DENY`, o iframe do dashboard **não carrega**,
mesmo com o CSP certo. Sem este ajuste o smoke do embed falha.


## Medido em produção (06/10/2026)

`curl -sSI https://shopfloor.enterplak.com.br/login` devolve **hoje**:

```
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=86400
```

Ou seja: **a mudança abaixo é necessária** — o `SAMEORIGIN` bloqueia o iframe vindo de
`dashboard.enterplak.com.br`, que é outra **origem** ainda que seja o mesmo site. Não há
`Content-Security-Policy` hoje; o `frame-ancestors` passa a existir com esta feature.

⚠️ O HSTS de produção é **`max-age=86400`** (um dia), não o ano que costuma ser padrão. Os
`add_header` repetidos dentro do `location /embed/` usam **esse** valor, para o `/embed` não acabar
com uma política diferente do resto do site por acidente. Se um dia o HSTS do site mudar, mude os
dois juntos.

## 1. Conferir (no servidor, o TI)

```bash
curl -sSI https://shopfloor.enterplak.com.br/login | grep -iE "x-frame|content-security|strict-transport"
curl -sSI https://shopfloor.enterplak.com.br/embed/fluxo/x/y | grep -iE "x-frame|content-security"
sudo grep -rn "X-Frame-Options" /etc/nginx/
```

## 2. Mudar

No `server` do `shopfloor.enterplak.com.br` (HTTPS), **remover** o `add_header X-Frame-Options ...`
do bloco geral. O `frame-ancestors 'self'` da aplicação já cobre o que ele cobria (navegadores
modernos priorizam o CSP). Se quiser manter o X-Frame nas demais rotas, use `location` separado:

⚠️ O `^~` não é enfeite: ele faz o nginx **parar de procurar** quando este prefixo casa. Sem ele,
uma `location` por expressão regular (de arquivo estático, por exemplo) pode vencer este bloco e
recolocar o `X-Frame-Options` — e aí o iframe continua bloqueado com a configuração "certa" no
arquivo.

```nginx
# Embed: SEM X-Frame-Options (o frame-ancestors da aplicação decide quem embute)
location ^~ /embed/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_hide_header X-Frame-Options;   # garante que nada upstream o repõe
    # NÃO repetir add_header X-Frame-Options aqui
    # Atenção: add_header de nível superior NÃO é herdado se este location tiver add_header próprio;
    # repita aqui HSTS e nosniff:
    add_header Strict-Transport-Security "max-age=86400" always;   # o valor REAL de hoje, medido
    add_header X-Content-Type-Options "nosniff" always;
}

# Resto do site: mantém X-Frame-Options como está
location / {
    # ... proxy atual ...
    add_header X-Frame-Options "SAMEORIGIN" always;
}
```

Ajuste os valores de HSTS ao que já está em produção. Depois: `sudo nginx -t && sudo systemctl reload nginx`.

## 3. Variáveis no servidor do ShopFloor

`DASHBOARD_ORIGIN=https://dashboard.enterplak.com.br` (e opcionalmente `EMBED_FRAME_ANCESTORS`).
**Ambas vazias = ninguém embute** (cai em `'self'`). O `headers()` é avaliado no **build**: mudar a
variável exige novo build/deploy.

## 4. Validar

O segundo `curl` acima deve mostrar `frame-ancestors https://dashboard.enterplak.com.br` e **nenhum**
`x-frame-options`; o primeiro deve mostrar `frame-ancestors 'self'`.
