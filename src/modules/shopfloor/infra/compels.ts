import 'server-only'
import type { EnvioEstoqueReservado, PortaCompels, ResultadoEnvioEstoque } from '../application/enviar-estoque'

/**
 * O ÚLTIMO METRO DA INTEGRAÇÃO COM O COMPELS — A CHAMADA QUE NÃO EXISTE AINDA.
 *
 * Este arquivo é de propósito o único lugar do ShopFloor que fala com o ERP, e hoje ele NÃO fala:
 * devolve uma falha dizendo que a integração não está configurada. Todo o resto da Fase 2 (a fila
 * com idempotência, a reversão, o laço de envio, o cron, a tela de pendências) não depende do que
 * falta saber, e por isso foi construído antes. No dia da resposta do fornecedor, falta ESTE arquivo
 * — e só ele: nada no laço tem caminho especial para "não configurado".
 *
 * ⚠️ ENQUANTO ISTO AQUI NÃO FOR ESCRITO, A FILA ACUMULA E NÃO ESVAZIA. É esperado: a fila existir
 * antes é o que faz o primeiro erro real ter onde aparecer, em vez de a peça sumir entre os dois
 * sistemas.
 *
 * ---------------------------------------------------------------------------------------------
 * O QUE FALTA SABER — as perguntas estão com o Valdeí (Compels) e o estudo da API pública está em
 * `docs/estudo-api-compels.md` (826 endpoints, CRUD gerado sobre as tabelas, nenhum campo declarado
 * obrigatório, nenhum esquema de autenticação declarado). Quem assumir não precisa procurar:
 *
 *  1. ENDPOINT. Qual é o caminho oficial para dar entrada de estoque. O candidato aparente é
 *     `POST /v1/itemLoteEstoque` (campos `codigoEstoque`, `codigoItem`, `numeroLote`, `saldo`,
 *     `estoque`/`itemLote` como URL), mas o ERP TEM endpoints de chão de fábrica escritos à mão
 *     (`findProximaRotaEstacao`, `verificaIntegracao`, `findOneByNumeroSerie`) — pode existir um
 *     caminho de integração já pensado por eles, e é por ele que se deve entrar.
 *  2. AUTENTICAÇÃO. Token, usuário/senha, chave por empresa? A especificação não declara nada e a
 *     documentação abre sem credencial. O segredo entra por variável de ambiente, nunca no código
 *     nem no `argv` (o mesmo cuidado do segredo do cron).
 *  3. FORMATO DA CARGA. Que campos são exigidos de verdade, e como amarrar PMO/OP daqui à ordem de
 *     produção deles (`ordemProducaoSimples`: `numero`, `codigoProduto`, `numeroPedidoVenda`). E se
 *     eles querem a peça a peça (o modelo deles tem `itemLoteNumeroSerie`) ou a quantidade da caixa.
 *     Falta também saber se a carga precisa da IDENTIDADE DO BIPE (o `alvo` da fila): se precisar, o
 *     certo é acrescentá-la ao `returns table` da `sf_estoque_reservar`, porque no banco ela é coluna
 *     GERADA — recalculá-la aqui reabre a divergência que a coluna existe pra fechar.
 *  4. GRAVAR `saldo` MOVIMENTA O ESTOQUE DE VERDADE? Ou só escreve um número na tabela, sem custo,
 *     rastreio nem histórico contábil? Esta é a pergunta mais importante das seis: se as regras do
 *     ERP não rodarem nesse caminho, o estoque fica certo na tela e errado na contabilidade, e
 *     ninguém descobre até o inventário.
 *  5. EXISTE ENDPOINT DE LEITURA DE ESTOQUE? É dele que depende a métrica do estoque do Compels no
 *     card do Fluxo (deixada fora desta fase) e, mais importante, qualquer conferência de "o que
 *     mandamos chegou" — hoje o único registro de entrega que existe é o `ok` da nossa própria fila.
 *  6. QUAL O PERÍODO ACEITÁVEL DA FILA? Quanto tempo pode passar entre o bipe e a movimentação
 *     chegar lá, e se uma movimentação de dias atrás ainda é aceita (a fila NÃO descarta nada por
 *     idade — ver DIFERENÇA 3 na 0132). A resposta é o que define o teto de tentativas, a frequência
 *     do cron e o que a tela de pendências pode prometer.
 *
 * Fora dessas seis, duas respostas mudariam o desenho JÁ FEITO e por isso valem revisão quando
 * vierem: se chamada repetida duplica a entrada (a `chave` da 0132 é nossa aposta contra isso, e
 * pressupõe que eles aceitem um identificador nosso), e se existe ambiente de teste — testar escrita
 * de estoque na base real é criar divergência de propósito.
 * ---------------------------------------------------------------------------------------------
 */

/** Como a movimentação se chama no texto do erro (é o que o gestor lê na tela de pendências). */
const MOVIMENTACAO: Record<EnvioEstoqueReservado['operacao'], string> = {
  entrada: 'A entrada',
  estorno: 'O estorno',
}

/**
 * Manda UMA movimentação de estoque ao Compels. Devolve sucesso, ou o motivo da falha em português.
 *
 * NÃO IMPLEMENTADA: devolve falha. Para o laço de envio isso é uma falha de envio como qualquer
 * outra — conta tentativa, guarda o motivo, a linha fica na fila —, e é assim que tem que ser: no
 * dia em que esta função existir, nada mais muda.
 *
 * Quando for implementada, três coisas que já estão decididas do lado de cá e não se negociam aqui:
 *   • a `chave` vai na chamada, é ela que impede a mesma entrada de virar duas no ERP num reenvio;
 *   • `quantidade` é sempre POSITIVA — quem diz o sentido é `operacao` ('estorno' é a saída);
 *   • timeout curto e erro com mensagem legível: o texto devolvido aqui é o que aparece na tela de
 *     pendências, e é por ele que alguém decide se aperta Reenviar ou chama o fornecedor.
 */
export const enviarMovimentacaoCompels: PortaCompels = async function enviarMovimentacaoCompels(
  envio: EnvioEstoqueReservado,
): Promise<ResultadoEnvioEstoque> {
  return {
    ok: false,
    erro:
      'Integração com o Compels ainda não configurada (faltam endpoint, autenticação e formato da '
      + `carga). ${MOVIMENTACAO[envio.operacao]} continua na fila e será enviada quando a `
      + 'integração existir.',
  }
}
