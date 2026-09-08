# Smoke — ShopFloor na AWS (staging)

> **URL:** https://awsshopfloor.enterplak.com.br
> Marque cada item. Objetivo: provar que **tudo que funciona no Prod atual funciona igual na AWS**.
> Ideal fazer de **2 aparelhos**: PC (mini pc/desktop) e **tablet** (retrato + paisagem).

## 0) Antes de começar (deixar aberto pra ver erro ao vivo)
Na instância (SSH), num terminal separado, deixe rolando os logs:
```bash
pm2 logs shopfloor --lines 0            # o app (erros de SSR/server action aparecem aqui)
```
Regra de ouro do smoke: **qualquer coisa vermelha nesse terminal enquanto você clica = anotar** (qual tela, qual ação).

---

## 1) Acesso & Login
- [ ] Abre a URL → **cadeado de HTTPS** ok, sem aviso de certificado.
- [ ] Faz login com **usuário real**. Resultado: entra e cai na home.
- [ ] Login com **senha errada** → mensagem de erro (não trava/branco).
- [ ] Menu lateral aparece só com os **módulos que esse perfil pode ver** (RBAC).

## 2) Leitura de dados (dado migrado)
- [ ] Abre **ShopFloor → Operar → Lançamento**: os selects de **Cliente/PMO/OP** carregam.
- [ ] Escolhe uma OP conhecida → **posto** e contexto batem com o que você espera.
- [ ] **Recebimento → Processos**: a lista de processos carrega (dado do Prod migrado).

## 3) Lançamento por peça — BIPE (o coração)
- [ ] Seleciona **Colaborador** + **Posto** de peça.
- [ ] **Bipa um SN válido** → **PainelResultado grande** (verde) aparece; peça vai pro **✓ Positivos**.
- [ ] Bipa um SN que **reprova** (ou força defeito) → painel **vermelho**; vai pro **✗ Negativos**.
- [ ] Confere no painel: **última peça bipada** (faixa horizontal) mostra o SN certo.
- [ ] Bipa **5+ peças** → os históricos ganham **scroll** (não empurram a tela).
- [ ] Layout: **Peça à esquerda | Contexto compacto à direita** na mesma linha, sem scroll da página.

## 4) Burn-in (entrada/saída por posto)
- [ ] Posto de **Burn-in**: bipa **entrada** → registra hora.
- [ ] Bipa **saída** antes do tempo mínimo → **bloqueia** com aviso.
- [ ] Bipa **saída** depois do tempo → **aprova**.

## 5) Integração (por bipe)
- [ ] Posto de **Integração**: bipa a placa/SN → sistema **acha a OP/PMO pela faixa** e integra.
- [ ] **Operar → Consultar/Cancelar Integração**: bipa o SN → mostra produto + placas + posto.
- [ ] **Cancelar** uma integração de teste → libera os SNs.

## 6) Embalagem por caixa
- [ ] Posto de **Embalagem**: define **limite** da caixa (1ª vez), bipa peças → contador **X/limite**.
- [ ] **Fechar caixa** → gera código `CX...` e **avança** pra próxima.
- [ ] Marca **☐ Última caixa** e fecha → comporta certo.

## 7) Análise
- [ ] **Análise → Pesquisa + Grade**: filtra por OP → lista os lançamentos que você acabou de fazer.
- [ ] **Análise → Fluxo da OP**: canvas abre, mostra **WIP por posto**; card de concluído com borda vinho.
- [ ] **Análise → Consultar Caixa**: escolhe OP → lista caixas (abertas+fechadas) → abre e vê os SNs.

## 8) Recebimento — foto (feature nova: câmera no PC)
- [ ] Recebimento → abre um processo → **Anexos**.
- [ ] Botão **Arquivo** → abre seletor de arquivo, anexa uma imagem → sobe (vai pro **Google Drive**).
- [ ] Botão **Câmera** → abre a **webcam** no PC, captura, confirma → anexa.
      *(precisa de HTTPS — na AWS já tem, ok. Navegador vai pedir permissão de câmera 1x.)*
- [ ] A foto anexada **aparece** na lista de anexos.

## 9) Cadastros (feedback = toast embaixo)
- [ ] Cadastrar **Posto** / **Defeito** / **OP**: ao salvar → **toast no rodapé** (bottom-center), não painel no topo.
- [ ] Salvar com campo faltando → erro claro.

## 10) Responsividade / menu
- [ ] No **PC**: botão do cabeçalho **recolhe/mostra** o menu lateral (e lembra ao recarregar).
- [ ] No **tablet retrato**: tela de Lançamento **cabe sem scroll** da página; drawer do menu abre.
- [ ] No **tablet paisagem**: idem, layout 2 colunas (bipe | resultado).

## 11) Logout
- [ ] Sai da conta → volta pro login; não acessa tela interna pela URL depois de sair.

---

## Relatório de verificação (rodar DEPOIS do smoke)
Confere se o que você bipou **gravou mesmo** no RDS e se teve erro nos logs.

```bash
# 1) App — teve erro durante o smoke?
pm2 logs shopfloor --lines 100 --nostream | grep -Ei 'error|unhandled|exception' || echo "sem erros no app ✅"

# 2) API (PostgREST) — falhas de request?
cd ~/supabase/docker && docker compose logs rest --tail 100 | grep -Ei 'error|fatal' || echo "sem erros na api ✅"
```

```sql
-- 3) No RDS: o que EU acabei de bipar (troca o nome do colaborador)
select numero_serie, posto, status, colaborador, data_hora
from sf_registros
where colaborador = 'SEU_NOME'
order by data_hora desc
limit 20;

-- 4) Contagem do dia (deve bater com o nº de bipes do smoke)
select posto, status, count(*)
from sf_registros
where data_hora::date = current_date
group by posto, status order by posto;
```

**Fechamento:** se (a) todos os itens marcados, (b) grep dos logs sem erro e (c) a query mostra os bipes do smoke → **staging aprovado**, pode pensar no CORTE (`checklist-corte.md`).
