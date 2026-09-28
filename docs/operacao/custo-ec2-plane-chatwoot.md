# Custo das instâncias EC2: plane-server e chatwoot-new

> Levantamento de 15/09/2026. Valores **estimados** pelos preços públicos da AWS (us-east-1, Linux, sob demanda), em dólar e sem impostos.
> Não é o ShopFloor: são duas aplicações da mesma conta AWS (5457-7943-2470), na mesma VPC do banco do ShopFloor (`vpc-066a312a087468d41`, us-east-1a).

## Dados coletados

| | plane-server | chatwoot-new |
|---|---|---|
| Tipo | `t3.large` (2 vCPU, 8 GB) | `t3.medium` (2 vCPU, 4 GB) |
| Sistema | Ubuntu 24.04 (Linux) | Linux (imagem própria `chatwoot-backup`) |
| Compra | Sob demanda (ciclo de vida normal), créditos `unlimited` | Sob demanda, créditos `unlimited` |
| Disco | gp3 100 GB (3000 IOPS / 125 MB/s) | gp3 60 GB (3000 IOPS / 125 MB/s) |
| IP | Elástico `35.170.115.38` (plane-eip) | Elástico `54.242.17.140` |
| Horário | 24h, **pode ser desligada** | 24h, **não pode desligar** (pode diminuir) |
| CPU | 4–9,5% em 2 semanas; créditos cheios (864) | ~5–10% em 2 semanas, com 1 pico isolado de 91% (~10/09); créditos cheios (576), só uma queda leve no pico |
| Memória | 2,2 GB usados de 7,6 GB (5,5 GB disponíveis), sem swap | não medida |
| Disco usado | 15 GB de 96 GB (16%) | não medido |
| Tráfego de saída | picos de ~3,8 MB | picos de ~12 MB a cada 5 min (estimado ~10–20 GB/mês) |

## Custo atual

### plane-server
| Item | O que é | Cálculo | US$/mês |
|---|---|---|---|
| Máquina `t3.large` | 2 processadores, 8 GB, 24h | 0,0832/h × 730 h | 60,74 |
| Disco gp3 100 GB | Sistema, Docker e dados | 100 × 0,08 | 8,00 |
| IP elástico | Endereço fixo; cobra mesmo desligada | 0,005/h × 730 h | 3,65 |
| CPU extra (`unlimited`) | Uso acima dos 30% inclusos | CPU ≤ 9,5% | 0,00 |
| Tráfego | Saída pra internet | poucos MB | 0,00 |
| Backup | Nenhum snapshot | — | 0,00 |
| **Total** | | | **≈ 72,39** |

### chatwoot-new
| Item | O que é | Cálculo | US$/mês |
|---|---|---|---|
| Máquina `t3.medium` | 2 processadores, 4 GB, 24h | 0,0416/h × 730 h | 30,37 |
| Disco gp3 60 GB | Armazenamento | 60 × 0,08 | 4,80 |
| IP elástico | Endereço fixo | 0,005/h × 730 h | 3,65 |
| CPU extra (`unlimited`) | Uso acima dos 20% inclusos | média ~5–10%; o pico de 91% foi pago com créditos acumulados | 0,00 |
| Tráfego | Dentro dos 100 GB grátis/mês da conta | — | 0,00 |
| Imagem `chatwoot-backup` | Snapshot guardado | até 60 GB × 0,05 | até 3,00 |
| **Total** | | | **≈ 38,82** (+ até 3,00) |

**As duas hoje: ≈ US$ 111,21/mês** (+ até US$ 3 do snapshot).

## Possibilidades de economia

### plane-server
| Opção | O que muda | Total/mês | Economia/mês | Condição |
|---|---|---|---|---|
| A. Desligar fora do horário (06:00–19:00, dias úteis) | Máquina ligada ~288 h; disco e IP seguem cobrando | ≈ 35,61 | −36,78 | Ninguém usar o Plane à noite ou no fim de semana |
| B. Diminuir pra `t3.medium` (4 GB), 24h | Metade da RAM | ≈ 42,02 | −30,37 | **Medido: usa 2,2 GB e CPU ≤ 9,5% → cabe.** Criar swap de 2 GB por segurança. |
| **C. `t3.medium` + desligar fora do horário (recomendado)** | A + B | **≈ 23,63** | **−48,76** | As duas condições |
| D. Disco de 100 GB → 40 GB | Usa só 15 GB. Exige copiar pra um volume novo (não dá pra encolher o disco) | −4,80 a mais | −4,80 | Vale o trabalho? |

### chatwoot-new
| Opção | O que muda | Total/mês | Economia/mês | Condição |
|---|---|---|---|---|
| **A. Savings Plan de 1 ano, sem adiantamento (recomendado)** | Mesma máquina, ~30% mais barata | **≈ 29,71** | **−9,11** | Manter a máquina 1 ano |
| B. `t4g.medium` (ARM) | Mesmo tamanho, ~19% mais barata; exige migrar | ≈ 32,98 | −5,84 | Testar compatibilidade (Chatwoot tem imagem ARM) |
| C. `t3.small` (2 GB) | Metade da RAM | ≈ 23,63 | −15,19 | **Arriscado:** Chatwoot costuma precisar de 4 GB; medir `free -h` antes |
| D. Apagar a imagem `chatwoot-backup` | Tira o snapshot guardado | — | até −3,00 | Não precisar mais desse backup |

Savings Plan não combina com desligar: ele cobra as 24h. Por isso vale só pro chatwoot.

## Resumo

| Cenário | plane-server | chatwoot-new | Total/mês | Economia |
|---|---|---|---|---|
| Hoje | 72,39 | 38,82 | ≈ 111,21 | — |
| Sem trocar máquina (plane com horário + chatwoot com Savings Plan) | 35,61 | 29,71 | ≈ 65,32 | −45,89 (41%) |
| **Recomendado** (plane `t3.medium` com horário + chatwoot com Savings Plan) | 23,63 | 29,71 | **≈ 53,34** | **−57,87 (52%) · ~US$ 694/ano** |

## Pendências
- [x] chatwoot-new: CPU em 2 semanas (15/09): média baixa, 1 pico de 91%, créditos cheios → sem custo extra; Savings Plan confirmado
- [ ] chatwoot-new: `free -h; df -h /` (EC2 → Conectar → EC2 Instance Connect)
- [ ] Confirmar o horário de uso do Plane (06:00–19:00 em dias úteis?)
- [ ] Opcional: identificar os 4 IPs elásticos sem instância (EC2 → Interfaces de rede, pelo IP privado 172.31.34.6, 172.31.4.70, 172.31.12.236, 172.31.22.211). O último é o RDS do ShopFloor. Se algum for NAT Gateway (~US$ 32/mês) ou Load Balancer (~US$ 16/mês), é mais economia possível na conta.
- [ ] Opcional: plane-server sem nenhum backup (snapshot semanal custa pouco)

## Como fazer cada ação

### plane-server: diminuir pra `t3.medium` (≈ 5–10 min fora do ar)
1. Fora do horário, criar um snapshot do volume (segurança; opcional).
2. Dentro do servidor, criar swap de 2 GB: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`
3. EC2 → Instâncias → plane-server → **Estado da instância → Interromper**.
4. **Ações → Configurações da instância → Alterar tipo de instância → `t3.medium`**.
5. **Estado da instância → Iniciar**. O IP elástico continua o mesmo.
6. Conferir se o Plane abre e se os containers subiram (`docker ps`); se não, `docker compose up -d` na pasta do Plane.

### plane-server: ligar e desligar no horário
1. Garantir que o Plane sobe sozinho quando a máquina liga (containers com `restart: unless-stopped` ou `always`). Testar com um reinício.
2. IAM → criar um papel pro EventBridge Scheduler com permissão só de `ec2:StartInstances` e `ec2:StopInstances` nessa instância.
3. EventBridge → Scheduler → criar 2 agendamentos, fuso `America/Sao_Paulo`, alvo **EC2 StartInstances / StopInstances** com o ID da instância:
   - Ligar: `cron(45 5 ? * MON-FRI *)`
   - Desligar: `cron(0 19 ? * MON-FRI *)`
4. Nas primeiras semanas, conferir às 06:00 se o Plane está no ar.

### chatwoot-new: Savings Plan de 1 ano
1. Billing and Cost Management → **Savings Plans → Comprar Savings Plans**.
2. Tipo **Compute Savings Plans** (vale pra qualquer EC2, mesmo trocando o tipo), prazo **1 ano**, **Sem pagamento adiantado**.
3. Compromisso por hora: o valor que a tela recomenda pra `t3.medium` (em torno de US$ 0,029/h, ~US$ 21/mês). Não comprometer acima do uso fixo 24h (só o chatwoot), porque a plane-server vai desligar à noite.
4. ⚠️ Compromisso de 1 ano: se a máquina for desligada ou apagada, o valor continua sendo cobrado.
