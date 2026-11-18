import { listaDe } from './leituras-erp'

/**
 * Cadastro de negociante lido de `GET /negociante/list` (a grade da tela de negociantes do Compels), para achar
 * a empresa pelo CPF/CNPJ na entrada do SAT (spec 2026-11-17-sat-entrada-por-nf-design.md, decisão 3). Só leitura.
 *
 * O filtro `cpfCnpj` busca por trecho e o cadastro guarda o CNPJ com e sem máscara: por isso a linha só vale se
 * tiver os MESMOS dígitos. Negociante `inativo` é ignorado.
 */
export function filtroNegociante(cpfCnpj: string): Record<string, unknown> {
  return filtroDaGrade('', cpfCnpj)
}

/**
 * O mesmo filtro, pelo `codigo` do negociante (o `negociante.codigo` da lista de OPs): o espelho das OPs troca o
 * código pelo nome do cliente. Também busca por trecho — quem confere o código exato é `nomeDoNegociante`.
 */
export function filtroNegociantePorCodigo(codigo: string): Record<string, unknown> {
  return filtroDaGrade(codigo.trim(), '')
}

function filtroDaGrade(codigo: string, cpfCnpj: string): Record<string, unknown> {
  return {
    codigo, nome: '', cpfCnpj, telefone: '', tipoIdList: null, statusIdList: null, transportadora: '',
    cep: '', municipio: '', uf: '', pais: '', situacao: 'ATIVO', codigoVendedor: null, observacao: '',
    limiteCreditoIdList: null, restricaoVendedor: false, carteiraRestricaoVendedor: false, exibirUltimaCompra: false,
    atendenteAlocadoId: null, cadastroLead: false,
  }
}

const digitos = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '')
const aparado = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** A primeira linha ativa com os mesmos dígitos; `nome` (razão social), senão `nomeFantasia`. Nenhuma → null. */
export function negocianteDoCnpj(resposta: unknown, cnpjDigitos: string): { codigo: string; nome: string } | null {
  for (const linha of listaDe(resposta, 'negociante/list')) {
    if (linha.inativo === true || digitos(linha.cpfCnpj) !== cnpjDigitos) continue
    const nome = aparado(linha.nome) || aparado(linha.nomeFantasia)
    const codigo = typeof linha.codigo === 'number' ? String(linha.codigo) : aparado(linha.codigo)
    if (nome !== '') return { codigo, nome }
  }
  return null
}

const codigoDe = (v: unknown) => (typeof v === 'number' ? String(v) : aparado(v))

/**
 * Nome do cliente para o espelho das OPs: a linha com o código EXATO, de preferência ativa (inativo só vale se não
 * houver ativo com o mesmo código); `nomeFantasia`, senão `nome` (razão social). Nenhuma com nome → null.
 */
export function nomeDoNegociante(resposta: unknown, codigo: string): string | null {
  const alvo = codigo.trim()
  const doCodigo = listaDe(resposta, 'negociante/list').filter((l) => codigoDe(l.codigo) === alvo)
  const ordenadas = [...doCodigo.filter((l) => l.inativo !== true), ...doCodigo.filter((l) => l.inativo === true)]
  for (const l of ordenadas) {
    const nome = aparado(l.nomeFantasia) || aparado(l.nome)
    if (nome !== '') return nome
  }
  return null
}
