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

## Mudar a frequência
Edite `OnCalendar` no `.timer` e `daemon-reload` + `restart` do timer. Exemplos:
- 6/6h (atual): `OnCalendar=*-*-* 00,06,12,18:00:00`
- 2x/dia (12h e 18h): `OnCalendar=*-*-* 12,18:00:00`
- 1x/hora: `OnCalendar=hourly`
