/**
 * Gera o SQL de carga dos defeitos do SAT (Compels `sat/defeito/findAll`, SÓ LEITURA) para `sat_defeitos` (0198).
 * Imprime o SQL na saída padrão; contagem e avisos vão para a saída de erro. Nunca imprime senha nem token.
 *
 * Uso: node tools/compels/defeitos-sat.mjs [--amostra] > defeitos-sat.sql
 *   --amostra: mostra (na saída de erro) a 1ª linha crua, para conferir os nomes dos campos.
 * Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (opcionais: COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL,
 * COMPELS_API_URL) — as mesmas do .env.production.
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/defeitos-sat.ts --file tools/compels/defeitos-sat.mjs --format esm --platform node
 */
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente } from '../../src/modules/compels/infra/config'
import { defeitosDaResposta, sqlDaCargaDeDefeitos } from '../../src/modules/sat/domain/defeitos-compels'

const amostra = process.argv.slice(2).includes('--amostra')
const linhas = await new ClienteCompels(configDoAmbiente()).listarDefeitosSat()
if (amostra) console.error(JSON.stringify(linhas[0] ?? null, null, 2))
const defeitos = defeitosDaResposta(linhas)
console.error(`${defeitos.length} defeitos lidos do Compels.`)
process.stdout.write(sqlDaCargaDeDefeitos(defeitos, new Date()))
