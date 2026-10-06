# nginx: liberar o iframe do Dashboard em `/embed` (PRÉ-REQUISITO do smoke)

O ShopFloor agora manda `Content-Security-Policy: frame-ancestors <dashboard>` nas rotas `/embed/*`
e `frame-ancestors 'self'` no resto (`next.config.ts`).

**Problema:** o navegador honra `X-Frame-Options` **independentemente** do CSP. A revisão de segurança
de 21/09 ligou HSTS, X-Frame e nosniff, e **`X-Frame-Options` não está em nenhum arquivo versionado**
(`deploy/aws/nginx-shopfloor-aws.conf` não tem `add_header`; o Next também não o define). Logo ele
vem do nginx do servidor. Se for `SAMEORIGIN` ou `DENY`, o iframe do dashboard **não carrega**,
mesmo com o CSP certo. Sem este ajuste o smoke do embed falha.

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

```nginx
# Embed: SEM X-Frame-Options (o frame-ancestors da aplicação decide quem embute)
location /embed/ {
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
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
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
