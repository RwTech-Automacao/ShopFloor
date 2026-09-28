# Plano de economia da AWS (parcial)

> Card da sprint 09/09/2026: "Verificar tamanho do lambda no servidor" [4h].
> Objetivo: diminuir o custo da AWS.
> Estado: **parcial, 15/09/2026.** Os valores ainda são estimativa pelos preços públicos. Falta conferir na fatura real (Billing → Bills).
> Câmbio usado: **US$ 1 = R$ 5,15**. Não inclui IOF nem impostos da fatura.

O nome do card é antigo: "lambda" eram as funções serverless da Vercel. Hoje o app roda num servidor Lightsail e não existe Lambda na conta.

## 1. Custo mensal atual (estimado)

| Serviço | O que é | US$/mês | R$/mês |
|---|---|---|---|
| Lightsail `shopfloor-prod` (4 GB, 2 vCPU, 80 GB, 4 TB de tráfego, IP incluso) | App + Supabase | 24,00 | 123,60 |
| RDS `shopfloor-prod-db` `db.t4g.small` (2 GB, uma zona só, sob demanda, US$ 0,032/h) | Banco de produção | 23,36 | 120,30 |
| Disco do RDS (gp3, 20 GB, US$ 0,115/GB) | Armazenamento | 2,30 | 11,85 |
| IP público do RDS (US$ 0,005/h) | Banco aberto pra internet | 3,65 | 18,80 |
| Backups do RDS (7 dias + snapshots) | Grátis até 20 GB | ~0 | ~0 |
| Tráfego Lightsail ↔ RDS pelo IP público | Variável | ~1 | ~5 |
| **Total** | | **≈ 54** | **≈ 280** |

## 2. O que as medições mostraram (RDS, 5 dias; instância, 15/09)

- **CPU do RDS:** fica entre 4% e 7% parada e chega a 15,7% no pico.
- **Conexões:** de 2 a 8.
- **Uso só em dia útil e horário da fábrica:** noite, sábado (12/09) e domingo (13/09) ficam parados.
- **Memória livre do RDS:** cerca de 1 GB dos 2 GB, caindo até 930 MB.
  - **Descartado diminuir pra `db.t4g.micro` (1 GB):** o banco já ocupa perto de 1 GB e ficaria sem folga.
- **Lightsail:** usa 1,1 GB de 3,7 GB (sobram 2,6 GB), com 590 MB de swap e 17 GB de disco ocupados de 77 GB.
  - O aperto de memória (93%) acontece só no build do deploy.
  - Os containers `studio` (145 MB), `imgproxy` (43 MB) e `storage` (25 MB) não são usados em produção.

## 3. Ações do plano

### 3.1 Desligar o RDS fora do horário (06:00 às 19:00, dias úteis)

**Economia: ~US$ 14,30/mês (R$ 74).** O banco passa a ficar ligado ~282 h por mês em vez de 730 h.

Como funciona:
- **Parado:** o RDS não cobra as horas da máquina, só o disco e os backups.
- **Agendamento:** o **EventBridge Scheduler** chama direto `StopDBInstance` e `StartDBInstance`, sem Lambda. O custo é praticamente zero.
- **Limite de 7 dias:** o RDS fica parado no máximo 7 dias seguidos e depois religa sozinho. Não afeta um agendamento diário.

Horários sugeridos (fuso `America/Sao_Paulo`):

| Agendamento | Cron | Por quê |
|---|---|---|
| Ligar | `cron(45 5 ? * MON-FRI *)` | O banco leva de 5 a 10 minutos pra subir. Às 06:00 já está pronto (produção começa 07:00). |
| Desligar | `cron(0 19 ? * MON-FRI *)` | Produção termina 17:30; build e smoke às vezes vão até 18:45/18:50 |

Antes de ativar:
1. **Janela de backup** (hoje 02:40) e **janela de manutenção** (hoje 03:10): mover pra dentro do horário ligado. Com o banco parado, o backup automático não roda.
2. **Repinmetro:** o cron da 10.0.0.210 roda às 00, 06, 12 e 18. Trocar pra `0 7,12,18 * * 1-5`, porque as rodadas com o banco parado falham. Não perde dado: a próxima rodada recupera.
3. **Testar uma vez à mão:** parar o RDS, ligar de novo e conferir se o Supabase (auth e API) reconecta sozinho, sem reiniciar containers.
4. **Permissão:** criar o papel IAM do Scheduler com permissão só de `rds:StopDBInstance` e `rds:StartDBInstance` nesse banco.

Riscos:
- **Fora do horário o ShopFloor inteiro fica sem banco:** login, bipe, SSO do portal e tela do Repinmetro. O Lightsail continua ligado e mostra erro.
- **Hora extra ou sábado:** alguém precisa ligar o RDS pelo console (RDS → Ações → Iniciar) e esperar de 5 a 10 minutos.
- **Feriado em dia útil:** o banco liga à toa. É só custo, sem impacto.
- **Não combina com a reserva de 1 ano:** a reserva paga 24h por dia, ligada ou não. Com o desligamento agendado, a reserva fica de fora.

### 3.2 Tirar o RDS da internet (VPC peering com o Lightsail)

**Economia: ~US$ 4–5/mês (R$ 23).** Some o IP público e o tráfego pela internet. **O ganho principal é segurança**: hoje a porta 5432 do banco fica aberta pra internet.

Não precisa criar VPC. O Lightsail roda numa rede própria da AWS e só consegue se ligar à **VPC padrão (default)** da região. O RDS precisa estar nela. O peering e a VPC padrão não têm custo; o que custa em VPC é NAT Gateway, e não precisamos de um.

Passo a passo:
1. **Ligar o peering no Lightsail:** Lightsail → Account (canto superior direito) → Advanced → VPC peering → marcar us-east-1.
2. **Liberar a rede interna no Security Group do RDS** (`shopfloor-rds-sg`): nova regra de entrada, porta 5432, origem `172.26.0.0/16` (rede interna do Lightsail).
3. **Tirar o acesso público do RDS:** RDS → `shopfloor-prod-db` → Modify → Connectivity → Additional configuration → Not publicly accessible → aplicar imediatamente. O endereço do banco continua o mesmo; ele só passa a responder pelo IP interno.
4. **Testar** o app e o psql a partir da instância.
5. **Limpar o Security Group:** apagar a regra do IP público do Lightsail e a do IP `177.17.162.21`.

**O que se perde:** conectar no banco direto do PC. O acesso passa a ser pela instância ou por túnel SSH.

**Andamento (22/09/2026) — passos 1 e 2 FEITOS, sem custo e sem afetar produção:**
- Peering ligado: Lightsail → Account → Advanced → VPC peering → **Virginia (us-east-1) = Enabled**.
- `shopfloor-rds-sg` ganhou a regra 5432 de origem `172.26.0.0/16` ("Lightsail via VPC peering"), ao lado das duas antigas: `35.168.119.35/32` (IP público do Lightsail) e `177.17.162.21/32` (PC do Matheus).
- Validado da instância: `psql … -c "select 1 as ok, inet_server_addr()"` → `ok = 1`, `172.31.22.211`; `getent hosts shopfloor-prod-db…` → **172.31.22.211**. Ou seja, o endereço do banco já resolve para o IP interno e o tráfego da aplicação **já vai pela rede interna** antes de tirar o acesso público.
- Custo: peering e regras de Security Group são grátis. Nada foi cobrado por esses dois passos.

**Falta (passos 3 a 5), na janela 17:30–18:45 e com o banco ligado:**
1. RDS → `shopfloor-prod-db` → Modify → Connectivity → **"Não acessível publicamente"** → Aplicar imediatamente (leva alguns minutos e reinicia as conexões).
2. Testar: `getent hosts` do endpoint, `psql` da instância, login, bipe e Fluxo.
3. **No dia seguinte**, apagar do `shopfloor-rds-sg` as regras `35.168.119.35/32` e `177.17.162.21/32`.

Depois do passo 3 ninguém conecta mais no banco direto do PC (passa a ser pela instância ou túnel SSH). **Rollback:** religar "acessível publicamente" — questão de minutos.

**Onde conferir a VPC e o acesso público:** RDS → Databases → `shopfloor-prod-db` → aba **Segurança e conexão**. Role a página abaixo do bloco "Conectar usando":
- **Seção "Rede":** mostra a **VPC** (clicar nela mostra **VPC padrão: Sim/Não**).
- **Seção "Segurança":** mostra **Acessível publicamente: Sim/Não**.

### 3.3 Desligar containers sem uso na instância (sem custo direto)

Desligar `supabase-studio`, `supabase-imgproxy` e `supabase-storage` libera ~210 MB de RAM e dá mais folga pro build.
- **`storage`:** as fotos vão pro Google Drive (`FOTOS_STORAGE=drive`).
- **`studio`:** é o painel web do Supabase, sem uso em produção.

Isso não diminui a conta, mas evita precisar de um plano maior.

## 4. Informativo: Lightsail parado cobra igual

O Lightsail é um plano de valor fixo: cobra por hora até o teto do mês, **ligado ou parado**. Só para de cobrar se a instância for **apagada**. Documentação da AWS: *"Lightsail instances and managed databases incur charges until they are deleted. These resources accrue charges even when they are in the stopped state."*

Por isso **desligar o Lightsail à noite não economiza nada**. Mudar de plano também não é algo pra fazer todo dia: exige snapshot e criar outra instância.

## 5. Resultado esperado do plano

| Serviço | Hoje (US$) | Com o plano (US$) |
|---|---|---|
| Lightsail | 24,00 | 24,00 |
| RDS (máquina) | 23,36 | ~9,05 (282 h) |
| Disco do RDS | 2,30 | 2,30 |
| IP público do RDS | 3,65 | 0 |
| Tráfego | ~1 | ~0 |
| **Total** | **≈ 54 (R$ 280)** | **≈ 35 (R$ 183)** |

**Economia ≈ US$ 19/mês (R$ 98), cerca de 35%, ou ~R$ 1.170 por ano.**

## 6. Estudo: migrar o app do Lightsail pra EC2

Premissas:
- **Máquina:** EC2 `t4g.medium`, igual à de hoje (2 vCPU, 4 GB), a US$ 0,0336/h.
- **Disco:** 30 GB gp3, US$ 2,40/mês.
- **IP fixo:** Elastic IP, US$ 3,65/mês, cobrado mesmo com a máquina parada.
- **Horário:** o mesmo do RDS, 06:00–19:00 em dias úteis (~282 h).

| Cenário | App (US$) | Conta inteira (US$) | R$/mês |
|---|---|---|---|
| Plano da seção 5 (fica no Lightsail) | 24,00 | ≈ 35 | ≈ 183 |
| EC2 ligada 24h | 30,60 | ≈ 42 | ≈ 217 |
| EC2 ligada 06–19 em dias úteis | 15,50 | ≈ 27 | ≈ 139 |

**A EC2 com horário economizaria mais ~US$ 8,50/mês (R$ 44), ~R$ 530 por ano**, além do plano da seção 5. Ligada 24h, sai mais cara que o Lightsail.

**Ganhos:**
- Paga só pelas horas ligada.
- Muda de tamanho em ~2 minutos (parar → trocar tipo → ligar), inclusive pra builds pesados.
- Fica na mesma rede do RDS: o banco sai da internet sem precisar de peering, e o tráfego na mesma zona é grátis.
- Dá pra usar Savings Plans, agendamento e papéis IAM (sem chave guardada no servidor).

**Perdas e riscos:**
- **Migração do servidor inteiro:** Docker do Supabase, nginx, certificado, pm2, variáveis de ambiente, troca do DNS e janela com o sistema fora. É cerca de 1 dia de trabalho.
- **Sobe duas coisas todo dia:** EC2 e RDS precisam subir juntos toda manhã, na ordem certa. Se algo falhar às 06:00, a produção começa parada. Já vimos o pm2 voltar vazio depois de um reinício.
- **Perde a franquia de 4 TB de tráfego do Lightsail:** na EC2, passa de 100 GB paga US$ 0,09 por GB (pra nós é pouco).
- **Mais coisa pra administrar:** Security Groups, snapshots de disco (EBS) e IAM.
- **A mesma limitação de horário do RDS:** hora extra ou sábado exigem ligar à mão.

**Recomendação:**
1. **Primeiro:** executar a seção 3 (RDS com horário + fora da internet) e acompanhar 1 mês de fatura.
2. **Depois:** migrar pra EC2 só se o horário fixo funcionar sem problema e se os ~R$ 44 por mês compensarem o dia de migração e o risco de subir duas máquinas todo dia.

## 7. Pendências pra fechar o card
- [ ] Fatura real de agosto e setembro (Billing → Bills, por serviço) e a forma de pagamento (IOF/impostos)
- [ ] Confirmar a VPC padrão e o "Acessível publicamente" do RDS
- [ ] Confirmar com a produção o horário 06:00–19:00 (hora extra, sábado, feriado)

## Fontes
- [Lightsail — Billing FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html)
- [Lightsail Pricing](https://aws.amazon.com/lightsail/pricing/)
- [Stopping an Amazon RDS DB instance temporarily](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)
- [db.t4g.small (Vantage)](https://instances.vantage.sh/aws/rds/db.t4g.small)
- [Public IPv4 address charge (AWS News Blog)](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights)

---

## 8. Esboço: Plano A (fica no Lightsail) × Plano B (migra pra EC2)

Nos dois planos o **RDS continua o mesmo banco** (sem migrar dado) e fica ligado 06:00–19:00 em dias úteis.

### Plano A — fica no Lightsail
1. Conferir a fatura real e a VPC do RDS (tem que ser a padrão).
2. **Peering** Lightsail ↔ VPC padrão + RDS "não acessível publicamente" (seção 3.2).
3. **Mover as janelas** de backup e manutenção pra dentro do horário (backup 12:00–12:30; manutenção sexta 06:05–06:35).
4. **Cron do Repinmetro** na 10.0.0.210: `0 7,12,18 * * 1-5`.
5. **Teste manual** de parar e ligar o RDS fora do expediente.
6. **EventBridge Scheduler:** liga 05:45, desliga 19:00, dias úteis.
7. **Desligar containers sem uso** (studio, imgproxy, storage).
8. **Procedimento de hora extra:** quem pode ligar o RDS e como.

- **Custo:** ≈ US$ 35/mês (R$ 183). **Economia:** ≈ US$ 19 (R$ 98, ~35%).
- **Esforço:** ~3–4 h.
- **Risco:** baixo a médio (só o banco desliga).

### Plano B — migra o app pra EC2
1. Conferir a fatura real e o tráfego de saída do Lightsail (métrica NetworkOut).
2. Criar a **EC2** (`t4g.medium` ARM ou `t3.medium` x86) **na mesma VPC e zona do RDS** (us-east-1a), com disco gp3 de 40 GB e **Elastic IP**.
3. **Montar o servidor igual ao Lightsail:** Docker + pasta `~/supabase/docker` com `.env` (copiado de máquina pra máquina, nunca pelo chat), Node 20, repo + `.env.production`, build, pm2 com início no boot, nginx, `/etc/hosts` (hairpin) e cliente psql 17.
4. **Testar antes do corte** pelo arquivo `hosts` do PC apontando pro IP novo.
5. **Corte:** no Locaweb, trocar o registro A de `shopfloor` e `apiawsshopfloor` pro Elastic IP, e emitir o certificado (certbot) na EC2.
6. **Tirar o RDS da internet:** "não acessível publicamente" + Security Group liberando só o grupo da EC2. **Sem peering.**
7. **Janelas** de backup e manutenção + **cron do Repinmetro** (iguais ao plano A).
8. **Scheduler:** liga RDS 05:40 e EC2 05:50; desliga EC2 19:00 e RDS 19:05.
9. **Aviso se não subir:** checagem às 06:00 (ex.: alarme do CloudWatch por e-mail).
10. **Manter o Lightsail parado 1 semana** como volta atrás. Depois, snapshot e apagar.

- **Custo:** ≈ US$ 28/mês (R$ 145):
  - EC2 ~290 h: 9,75
  - Disco de 40 GB: 3,20
  - Elastic IP: 3,65
  - RDS: 11,35
- **Economia:** ≈ US$ 26 (R$ 135, ~48%).
- **Esforço:** ~1 a 1,5 dia.
- **Risco:** médio (duas máquinas sobem todo dia).
- **Custo único:** ~US$ 6 da semana extra de Lightsail.

### Comparação

| | Hoje | Plano A | Plano B |
|---|---|---|---|
| US$/mês | ≈ 54 | ≈ 35 | ≈ 28 |
| R$/mês | ≈ 280 | ≈ 183 | ≈ 145 |
| Economia/mês | — | R$ 98 (35%) | R$ 135 (48%) |
| Economia/ano | — | ~R$ 1.170 | ~R$ 1.620 |
| Esforço | — | ~3–4 h | ~1–1,5 dia |
| O que desliga fora do horário | — | Só o banco | Banco e app |
| Peering | — | Precisa | Não precisa |
| Troca de DNS | — | Não | Sim |
| Hora extra | — | Ligar o RDS | Ligar RDS e EC2 |

**Diferença entre os planos:** o B economiza **~R$ 37 a mais por mês (~R$ 450 por ano)**, em troca de ~1 dia de migração e duas máquinas subindo todo dia.

### Informações que faltam
- [ ] Fatura real (agosto e setembro) e forma de pagamento
- [ ] VPC do RDS é a padrão? (plano A) — Aurora and RDS → Grupos de sub-redes, ou console da VPC → Suas VPCs
- [ ] Tráfego de saída do Lightsail (métrica NetworkOut) (plano B)
- [x] Horário e hora extra: ver seção 11
- [x] ARM ou x86: ver seção 12

---

## 9. Confirmações e detalhes (15/09, tarde)

### O que já foi confirmado
- **RDS acessível publicamente: SIM.**
  - O endereço do banco responde com IP público (`54.147.108.75`).
  - O Security Group libera o IP público do Lightsail (`35.168.119.35/32`) e o IP `177.17.162.21/32`.
- **VPC do RDS: `vpc-066a312a087468d41`**, pelo grupo de sub-redes `default-vpc-066a312a087468d41`. O nome `default-vpc-…` é o que o RDS gera quando usa a VPC padrão, então **o peering do plano A deve funcionar**. Confirmação final: VPC → Suas VPCs → coluna "VPC padrão".
- **Tráfego de saída do Lightsail (NetworkOut, 2 semanas):**
  - **Dia útil:** picos de 100 a 170 MB por hora.
  - **Noite e fim de semana:** quase zero.
  - **Estimativa:** **~10 a 25 GB por mês**.
  - **Consequência:** bem abaixo da franquia de 4 TB do Lightsail e dos **100 GB grátis por mês** da EC2. Não gera custo em nenhum dos planos.

### Informativo: peering e a conta
- **Plano A:** o peering é o que permite tirar o RDS da internet. É ele que elimina o IP público do banco (**−US$ 3,65/mês**) e o tráfego pela internet.
  - O peering é grátis.
  - Tráfego pela ponte dentro da mesma zona é grátis; entre zonas custa US$ 0,01 por GB. Com ~20 GB/mês, são centavos.
- **Plano B:** a EC2 fica na mesma VPC e zona do RDS, então **não precisa de peering** e a economia do IP público vem do mesmo jeito.

### Janelas de backup e manutenção
- **Janela de manutenção:** horário em que a AWS **pode** aplicar atualizações obrigatórias (patch do sistema operacional, versão menor do PostgreSQL).
  - Só age quando existe atualização pendente, poucas vezes por ano.
  - Quando age, o banco reinicia e fica **alguns minutos fora**.
  - A AWS avisa antes: aba **Manutenção e backups** do RDS e e-mail da conta. Dá pra **aplicar na hora que quiser** ou adiar pra próxima janela.
- **Janela de backup:** o snapshot diário. No RDS atual, o banco **não fica fora**; no máximo fica um pouco mais lento por instantes.
- **Sugestão:**
  - **Backup:** todo dia, 12:00–12:30.
  - **Manutenção:** sexta, 06:05–06:35. Depois do banco ligar (05:45) e antes da produção (07:00). O fim da tarde foi descartado porque build e smoke vão até 18:50.
- **Conflito com build ou deploy:** o build do app **não usa o banco**. Só aplicar migração (psql) falharia se coincidir com um reinício de manutenção.
  - **Regra:** não aplicar migração no horário da janela.
  - Se aparecer manutenção pendente, aplicar à mão num horário combinado.

### Hora extra: dá pra automatizar?
| Opção | Como funciona | Precisa do console? | Esforço |
|---|---|---|---|
| **Agendamento avulso** (recomendado) | Quando a hora extra é combinada, o TI cria no EventBridge Scheduler um agendamento de uma vez só (ex.: `at(2026-09-20T06:40:00)`, fuso São Paulo), que liga o RDS (e a EC2, no plano B) e se apaga sozinho depois. Outro agendamento avulso desliga no fim. | Só quem cria (TI) | 5 min por hora extra |
| **Usuário restrito pro líder** | Usuário da AWS com permissão **só de ligar**. O líder entra no console e clica em Iniciar. | Sim, o líder | 30 min uma vez |
| **Botão "Ligar o sistema"** (futuro) | Quando o banco está desligado, a página de erro do ShopFloor mostra um botão com PIN. O servidor chama a AWS pra ligar o RDS com uma chave que **só pode ligar**. | Ninguém | ~3–4 h de desenvolvimento |

- **Hora extra sem aviso:** exige a 2ª ou a 3ª opção.
- **Botão "Ligar o sistema":** só faz sentido no plano A. No plano B a própria EC2 estaria desligada e não teria quem mostrasse o botão.

## 10. Migração pra EC2 (plano B): passo a passo e tempo estimado

O **banco não migra**: o RDS continua o mesmo, sem dump nem restore. Migra só o servidor do app.

| # | Etapa | Tempo |
|---|---|---|
| 1 | **Criar a EC2** (`t4g.medium` ou `t3.medium`, Ubuntu 24.04) na VPC `vpc-066a312a087468d41`, zona **us-east-1a** (a do RDS), disco gp3 de 40 GB, **Elastic IP** e Security Group (22 só do IP da empresa, 80 e 443 abertos) | 30–45 min |
| 2 | **Instalar a pilha:** Docker + compose, Node 20, pm2, nginx, certbot, cliente psql 17; swap de 4 GB | 45 min |
| 3 | **Supabase:** copiar `~/supabase/docker` com o `.env` **de servidor pra servidor** (scp, nunca pelo chat), liberar no Security Group do RDS o grupo da EC2, `docker compose up -d`, conferir que tudo fica healthy | 30–45 min |
| 4 | **App:** clonar o repositório (credencial nova, não o PAT antigo), copiar `.env.production`, `npm ci`, build, `pm2 start` + `pm2 startup` + `pm2 save` | 45–60 min |
| 5 | **nginx e certificado:** copiar a configuração e a pasta `/etc/letsencrypt` do Lightsail (evita esperar o DNS pra emitir), linha do `/etc/hosts` (hairpin) | 20–30 min |
| 6 | **Teste sem afetar ninguém:** no PC, apontar `shopfloor` e `apiawsshopfloor` pro Elastic IP no arquivo `hosts` e testar login, bipe, Dashboard, foto (Drive), SSO do portal e escrita do Repinmetro | 1 h |
| 7 | **Teste de reinício:** reiniciar a EC2 e conferir que pm2 e containers voltam sozinhos | 15 min |
| 8 | **Corte:** congelar deploys, trocar o registro A de `shopfloor` e `apiawsshopfloor` no Locaweb pro Elastic IP e acompanhar a propagação | 30–60 min (sistema fora só enquanto o DNS propaga; o Lightsail continua respondendo nesse meio tempo) |
| 9 | **Tirar o RDS da internet:** "não acessível publicamente" + Security Group só com o grupo da EC2 | 20 min |
| 10 | **Agendamentos:** papel IAM + 4 agendamentos (liga RDS 05:40, liga EC2 05:50, desliga EC2 19:00, desliga RDS 19:05) + alarme por e-mail se o site não responder às 06:15 | 45–60 min |
| 11 | **Janelas** de backup e manutenção + **cron do Repinmetro** (com o TI) | 20 min |
| 12 | **Pós-corte:** acompanhar a 1ª semana. Depois, snapshot do Lightsail e **apagar** (senão continua cobrando US$ 24) | 15 min + acompanhamento |

- **Total: ~7 a 9 horas de trabalho** (1 a 1,5 dia).
- **Sistema fora:** só alguns minutos, na troca de DNS.
- **Arquitetura:** se a EC2 for `t4g` (ARM), conferir no passo 3 se todas as imagens do Supabase têm versão ARM (as oficiais têm) e no passo 4 se o `npm ci` compila sem erro. Se for `t3` (x86), é igual ao Lightsail.

**Plano A, pra comparação:** peering + RDS privado (30 min) + janelas (10 min) + cron do Repinmetro (15 min, com o TI) + teste de parar/ligar (30 min) + agendamentos (45 min) + containers sem uso (20 min) + procedimento de hora extra (30 min) = **~3 horas**.

## 11. Informações que ainda faltam
- [ ] Fatura real (agosto e setembro): **sem acesso ao Billing (15/09)**. Os valores seguem como estimativa pelos preços públicos, sem IOF/impostos. Pedir a quem administra a conta.
- [x] VPC confirmada (15/09, coluna **VPC padrão = Sim**): `vpc-066a312a087468d41` é a **única** VPC da região, com CIDR `172.31.0.0/16` (o bloco fixo da VPC padrão). Não conflita com a rede do Lightsail (`172.26.0.0/16`), então o peering funciona.
- [x] Horário confirmado (15/09): produção 07:00–17:30; sistema ligado 06:00–19:00 (liga 05:45, desliga 19:00) por causa de build/smoke até 18:50
- [x] Hora extra é avisada **verbalmente** (15/09). Procedimento: quem recebe o aviso (Matheus/TI) cria o **agendamento avulso** (liga e desliga) no EventBridge Scheduler. Pra hora extra sem aviso, avaliar o usuário restrito pro líder ou o botão "Ligar o sistema" (seção 9).
- [ ] Resultado do teste de parar/ligar o RDS (15/09 após o expediente)
- [x] Plano B: as duas opções no plano, preferência `t3.medium` (seção 12). Escolha final na hora de criar.

## 12. ARM (`t4g`) ou x86 (`t3`) no plano B

| | `t4g.medium` (ARM, Graviton) | `t3.medium` (x86, Intel) |
|---|---|---|
| CPU / RAM | 2 vCPU / 4 GB | 2 vCPU / 4 GB |
| Preço | US$ 0,0336/h → ~US$ 9,70/mês (288 h) | US$ 0,0416/h → ~US$ 12/mês (288 h) |
| Diferença | **~US$ 2,30/mês (R$ 12) mais barata** | — |
| Desempenho | Igual ou um pouco melhor | Igual ao de hoje |
| Compatibilidade | Precisa que tudo tenha versão ARM. Imagens oficiais do Supabase, Node 20, Next/Turbopack, nginx e certbot têm. | Idêntica ao Lightsail (também x86). Zero surpresa. |
| Se der problema | Não dá pra só trocar o tipo pra `t3`. Precisa criar outra máquina (~1 h perdida). | — |

- **Decisão (15/09): as duas ficam no plano, com preferência pela `t3.medium`** (igual à de hoje). A escolha final acontece na hora de criar a máquina.
  - **Opção 1 — `t3.medium` (preferida):** sem risco de compatibilidade; o custo do plano B sobe ~US$ 2,30/mês (≈ US$ 30 → R$ 157/mês; economia ≈ R$ 123/mês, ~44%).
  - **Opção 2 — `t4g.medium`:** ~R$ 12/mês mais barata (≈ US$ 28 → R$ 145/mês; economia ≈ R$ 135/mês, ~48%). Validar as imagens ARM (etapa 3) e o `npm ci` (etapa 4) antes do corte.
