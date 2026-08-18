# Automação do conector repinmetro (systemd timer, 6/6h)

Roda o conector automaticamente **de 6 em 6 horas** (00h, 06h, 12h, 18h) na máquina do
banco (`10.0.0.210`). Sync **incremental** (só os testes novos) via marca d'água; idempotente.

## Pré-requisitos na máquina
- **Node ≥ 20.6** (recomendado Node 20 LTS ou 22 LTS). Confere: `node -v`.
- A pasta `tools/repinmetro-conector` copiada pra máquina.
- Acesso de rede: ao Postgres do repinmetro (aqui é **localhost**) + saída HTTPS pro Supabase.

## Passo a passo

1. **Copiar a pasta** do conector pra máquina (ex.: `/opt/repinmetro-conector` ou o home).

2. **Instalar dependências** (dentro da pasta):
   ```bash
   npm install
   ```

3. **Criar o `.env.prod`** (a partir do `.env.example`) com os valores do **Prod**:
   ```
   SUPABASE_URL=https://ykwkacfviarhfmxeisqk.supabase.co
   SUPABASE_SERVICE_ROLE=<service_role do Prod>
   REPINMETRO_HOST=localhost          # nesta máquina o banco é local
   REPINMETRO_PORT=5432
   REPINMETRO_DB=repinmetro
   REPINMETRO_USER=<usuário read-only>
   REPINMETRO_PASSWORD=<senha read-only>
   # REPINMETRO_SINCE fica VAZIO → sync incremental (só os novos).
   ```
   > O `.env.prod` fica **só nesta máquina** (nunca no repo/Vercel). Já está no `.gitignore`.

4. **Testar manualmente** uma vez:
   ```bash
   ./run.sh
   ```
   Deve imprimir `Concluído: N registro(s) novo(s)` (provável poucos/0, já que o Prod está backfillado).

5. **Instalar o timer** (ajuste `User`, `WorkingDirectory` e `ExecStart` no `.service` pro caminho real):
   ```bash
   sudo cp deploy/repinmetro-conector.service /etc/systemd/system/
   sudo cp deploy/repinmetro-conector.timer   /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now repinmetro-conector.timer
   ```

6. **Conferir**:
   ```bash
   systemctl list-timers repinmetro-conector.timer   # próxima execução
   systemctl status repinmetro-conector.service      # última rodada
   journalctl -u repinmetro-conector.service -n 50   # log da última rodada
   ```

## Rodar na hora (fora do horário), pra testar:
```bash
sudo systemctl start repinmetro-conector.service
journalctl -u repinmetro-conector.service -n 30
```

## Mudar a frequência (systemd)
Edite `OnCalendar` no `.timer` e `daemon-reload` + `restart` do timer. Exemplos:
- 6/6h (atual): `OnCalendar=*-*-* 00,06,12,18:00:00`
- 2x/dia (12h e 18h): `OnCalendar=*-*-* 12,18:00:00`
- 1x/hora: `OnCalendar=hourly`

---

## Alternativa: cron (usado em produção, 2026-08-18)

Em vez do systemd timer, foi usado **cron** na máquina do banco. Duas coisas foram ajustadas:

1. **`run.sh` com o caminho ABSOLUTO do node** (o cron tem PATH mínimo e não acha o node do nvm).
   No servidor, a última linha do `run.sh` ficou:
   ```bash
   exec /root/.nvm/versions/node/v20.20.2/bin/node --env-file=.env.prod conector.mjs
   ```
   (o caminho do node vem de `which node`; aqui é o node do nvm do **root**.)

2. **Linha no crontab** (root — `sudo crontab -e`), de 6 em 6 horas, com log:
   ```
   0 */6 * * * /home/enterplak/Documentos/tools/repinmetro-conector/run.sh >> /var/log/repinmetro-conector.log 2>&1
   ```
   - `0 */6 * * *` = minuto 0, a cada 6 horas (00/06/12/18h). **São 5 campos** (min hora dia mês diadasemana) — `*/6` (não `/6`).
   - `>> ...log 2>&1` = grava a saída (stdout+erros) no log.

**Conferir:**
```bash
sudo crontab -l                              # confere a linha do cron
cat /var/log/repinmetro-conector.log         # vê os "Concluído: N novos" de cada rodada
sudo run-parts --test /etc/cron.d 2>/dev/null # (opcional)
```

⚠️ **Consistência (rodando como root):** o node é `/root/.nvm/...`, o log é `/var/log/...` e o crontab é do root → tudo como root, coerente. Se algum dia mudar pra rodar como outro usuário, o caminho do node (`/root/.nvm`) e a escrita em `/var/log` precisam ser revistos.
