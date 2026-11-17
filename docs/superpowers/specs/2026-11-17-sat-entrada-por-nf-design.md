# SAT — entrada por NF (redesenho da tela de entrada)

Data: 17/11/2026 · Branch: `feat/sat-entrada-por-nf` · Substitui as decisões 5, 6, 7 e 10 de
`2026-11-17-sat-entrada-design.md` (o resto continua valendo: planilha no banco, normalização do NS, lista e ficha).

## Por quê

Entrada e saída do equipamento giram em torno da **nota que chega com ele**, e uma NF pode trazer **vários
relógios**. Quem recebe não entende de OS: não escolhe OS, só registra a nota e bipa os relógios.

## Decisões (aprovadas pelo usuário em 17/11)

1. **A entrada é uma NF com N relógios.** Uma vez por nota: **CNPJ** (primeiro campo, digitado da nota), **empresa**,
   **número da NF**, **valor da nota**, **situação** (aprovada / reprovada + 1 ou mais motivos). Depois bipa os
   relógios um atrás do outro; cada um tem **número de série**, **produto**, **itens que vieram junto** (bobina,
   chave, fonte, outros + texto) e **locação** (texto livre). NS repetido na mesma nota é recusado.
2. **Data** = hoje; **responsável** = usuário logado (como antes).
3. **Empresa pelo CNPJ no Compels** (cadastro de negociante): `GET negociante/list?filter={…cpfCnpj…}` (só
   leitura; é o filtro da grade da tela de negociantes). Tenta o CNPJ com máscara (`99.999.999/9999-99`, formato de
   quase todo o cadastro) e, sem resultado, só os dígitos. Usa `nome` (razão social); sem `nome`, `nomeFantasia`.
   Ignora negociante `inativo`. Não achou ou Compels fora → a pessoa digita a empresa. CNPJ aceito: 14 dígitos
   (CNPJ) ou 11 (CPF), gravado com máscara.
4. **OS automática, escolhida pelo banco** ao gravar: a mais recente (data, depois número) daquele modelo +
   sequência com solução "Envio ao SAT" ou "Troca do Relógio" **que ainda não esteja ligada a outra entrada**.
   Nenhuma → sem OS. Índice único parcial em `sat_entradas(os_id)`: uma OS liga no máximo um relógio.
5. **Garantia e defeito vêm da OS** (lidos dela, não digitados nem guardados na entrada). Na tela de entrada
   aparecem só como leitura, em letra pequena, abaixo do relógio ("Sem OS" quando não houver).
6. **O técnico troca a OS depois**, na ficha do equipamento, com a permissão nova **`sat.associar_os`**: escolhe
   entre as OS daquele NS que não estão em outra entrada, ou "sem OS". Vai para o histórico.
7. **Produto** por relógio: sugerido pelo código do produto da OP do ShopFloor (ex.: `PMOC31`) quando o relógio
   passou pela produção acompanhada; senão em branco, para digitar. **Não** usa mais a coluna EQUIPAMENTO da
   planilha ("BLUE"). Puxar pela OP do teste de produção do repinmetro fica para depois de confirmado que
   `op_codigo` é a OP do Compels.
8. **NF depois da entrada** (permissão `aprovar_nf`, na ficha de qualquer relógio da nota): **corrigir** (mesma
   nota, muda a situação/motivos) ou **trocar** (nota nova: número, CNPJ, empresa, valor, situação, motivos; a
   antiga fica no histórico). Vale para **todos os relógios da nota**.
9. **Discord: um aviso por nota** ao gravar ("📦 Chegou no SAT: NF 1234 — EMPRESA (CNPJ) — aprovada ✅ /
   reprovada ❌ (motivos) — 3 relógios: NS1, NS2, NS3") e a cada mudança da NF. Falha no Discord não impede a
   gravação.
10. **Saem da entrada:** produto da planilha, custo, frete, defeito digitado e a escolha manual de OS.
11. **Cartão do repinmetro:** visível só a linha "Revenda · saída da expedição"; o teste de produção e os números de
    série das peças internas ficam num acordeão fechado.
12. **Motivos de reprovação:** a lista virá por migração (a tela saiu em 17/11); até lá "reprovada" não grava.

## Banco — migração `0187_sat_entrada_por_nf.sql`

- **`sat_nfs`** (nova): `id`, `numero`, `cnpj`, `empresa`, `negociante_codigo` (Compels, opcional), `valor`,
  `situacao` (`aprovada`/`reprovada`), `motivos text[]` (reprovada ⇔ tem motivo), `responsavel`,
  `responsavel_nome`, `data`, `criado_em`, `atualizado_em`.
- **`sat_entradas`** (um relógio): ganha `nf_id` (not null, FK `sat_nfs`); perde `nf`, `valor`, `empresa`, `cnpj`,
  `frete`, `custo`, `defeito`, `nf_situacao`, `nf_motivos`. Ficam NS, modelo, sequência, OS, produto, itens,
  locação, responsável, data. Índice único parcial em `os_id`.
- **`sat_historico`** (substitui `sat_entradas_historico`): `nf_id` (not null), `entrada_id` (só no tipo `os`),
  `tipo` (`entrada` · `correcao` · `troca` · `os`), `de`/`para` em jsonb, `motivos`, usuário, quando.
- **Dados existentes:** cada entrada vira uma `sat_nfs` com os dados dela; o histórico é copiado. Em produção as
  tabelas estão vazias ou quase (perfis do SAT ainda não criados), mas a migração não supõe isso.
- **Funções** (security definer, `tem_permissao` no padrão `(select …)`): `sat_registrar_nf(p jsonb)` (substitui
  `sat_registrar_entrada`; escolhe a OS de cada relógio), `sat_corrigir_nf`, `sat_trocar_nf` (agora por `nf_id`),
  `sat_associar_os(p_entrada, p_os)`. Saem `sat_registrar_entrada` e `sat_motivo_salvar`.
- Permissão `associar_os` no módulo `sat` (sem flag legada).

## Telas

- **`/sat/entrada`:** bloco da nota (CNPJ → empresa preenchida; NF; valor; situação/motivos) + bloco dos relógios
  (campo de bipe; cada NS bipado consulta planilha/repinmetro/ShopFloor e vira um cartão com produto, itens,
  locação, OS prevista com garantia/defeito, repinmetro com revenda e o acordeão do teste). "Registrar entrada (N
  relógios)". A OS mostrada na tela é a prevista; a que vale é a que o banco escolhe ao gravar.
- **`/sat/equipamentos`:** uma linha por relógio, com NF, empresa e situação vindas da nota; mesmos filtros.
- **Ficha do equipamento:** dados do relógio + da nota (com "outros relógios desta NF") + OS (com o botão "Trocar
  OS" para `associar_os`) + mudar NF + histórico da nota e da OS.

## Erros

CNPJ inválido, NF vazia, nenhum relógio, NS repetido na nota, reprovada sem motivo, OS já ligada a outra entrada
(na troca de OS), sem permissão → mensagem em PT-BR, nada gravado (a nota e os relógios gravam numa transação).

## Testes

Domínio: CNPJ/CPF (dígitos, máscara), NS repetido, validação da nota. Compels: leitura do negociante (máscara →
dígitos → nada; inativo ignorado). Aplicação: um aviso por nota; produto pela OP do ShopFloor e não pela planilha.
SQL no harness: escolha da OS (só as que voltam, mais recente, não reutiliza), índice único, migração dos dados
antigos, corrigir/trocar valem para a nota, `associar_os` com e sem permissão, RLS.
