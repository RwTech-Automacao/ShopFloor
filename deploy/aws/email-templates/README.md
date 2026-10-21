# E-mail de recuperação de senha (GoTrue na Lightsail)

Arquivos:
- `recuperar-senha.html`: template real (variáveis do GoTrue). Link do botão: `{{ .SiteURL }}/auth/redefinir?token_hash={{ .TokenHash }}&type=recovery`.
- `previa-recuperar-senha.html`: cópia com valores de exemplo, só para abrir no navegador e conferir o visual. Não vai para o servidor.
- `recuperar-senha.test.ts`: teste que protege o link e as regras de e-mail.

Assunto sugerido: `Redefinir sua senha do ShopFloor`

## Como o GoTrue lê o template

`GOTRUE_MAILER_TEMPLATES_RECOVERY` aceita uma **URL** (`http://...`) que o container auth busca ao enviar o e-mail. Não é caminho de arquivo. Então o HTML precisa ser servido por HTTP, acessível de dentro da rede do Docker. A opção mais simples, sem mexer no nginx do host: um container nginx estático no mesmo compose.

Observação: o `deploy/aws/docker-compose.override.yml` e o `nginx-shopfloor-aws.conf` deste repo não definem nada de e-mail. O nginx do host só faz proxy para 3000 e 8000 e não é alcançável de forma confiável de dentro do container auth, por isso a opção abaixo usa um serviço no compose.

## Passo a passo (na Lightsail)

1. Traga o template da main para a pasta do docker (rode na própria Lightsail; só funciona depois do merge na main):

```bash
mkdir -p ~/supabase/docker/email-templates && cd ~/ShopFloor && git fetch origin main && git show origin/main:deploy/aws/email-templates/recuperar-senha.html > ~/supabase/docker/email-templates/recuperar-senha.html && head -c 200 ~/supabase/docker/email-templates/recuperar-senha.html
```

Deve aparecer o início do HTML (`<!doctype html>`). Se aparecer erro de "path does not exist", o merge ainda não foi feito.

2. No servidor, crie o override do e-mail (arquivo novo, não altera o seu override atual):

```bash
cd ~/supabase/docker
cat > docker-compose.email.yml <<'YAML'
services:
  email-templates:
    image: nginx:alpine
    restart: unless-stopped
    volumes:
      - ./email-templates:/usr/share/nginx/html:ro
  auth:
    environment:
      GOTRUE_MAILER_TEMPLATES_RECOVERY: http://email-templates/recuperar-senha.html
      GOTRUE_MAILER_SUBJECTS_RECOVERY: Redefinir sua senha do ShopFloor
YAML
```

3. Suba o servidor estático e recrie só o auth, incluindo o novo arquivo na lista `-f`:

```bash
cd ~/supabase/docker
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.email.yml up -d email-templates
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.email.yml up -d --no-deps auth
```

4. Confira que o auth enxerga o template:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.email.yml exec auth wget -qO- http://email-templates/recuperar-senha.html | head -5
```

(Se `wget` não existir na imagem do auth, o teste do passo 5 já valida.)

## Testar

Em `https://shopfloor.enterplak.com.br/esqueci-senha`, peça a recuperação com o seu próprio e-mail. O e-mail deve chegar em português, com o cabeçalho vinho, e o botão deve levar a `/redefinir-senha` (precisa estar no ar o deploy do app com a correção de `src/app/auth/redefinir/route.ts`). Se chegar o e-mail antigo em inglês, o auth não leu a variável: veja `docker compose ... logs auth --tail 50`.

## Voltar atrás

```bash
cd ~/supabase/docker
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.email.yml stop email-templates
mv docker-compose.email.yml docker-compose.email.yml.off
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps auth
```

O auth volta ao template padrão do GoTrue.

## Atenção

Estes comandos assumem que o seu compose usa os arquivos `docker-compose.yml` + `docker-compose.override.yml` no `~/supabase/docker` (como descrito no cabeçalho do override do repo). Se o seu deploy usa outra combinação de `-f`, mantenha a sua e acrescente apenas `-f docker-compose.email.yml`.
