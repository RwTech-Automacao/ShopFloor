//#region src/modules/compels/domain/leituras-erp.ts
/**
* Converte as respostas CRUAS do Compels em `LeiturasOp`. As respostas vêm em formatos diferentes
* conforme o endpoint (lista direta, `{ data: [...] }` ou `{ results: [...] }`), então tudo passa
* por `listaDe`. Qualquer campo que falte ou não seja número vira `RespostaInesperada`: a
* integração para com "leitura inconsistente" em vez de assumir zero (zero é justamente o valor
* enganoso dos contadores das listas).
*/
var RespostaInesperada = class extends Error {
	constructor(onde) {
		super(`Resposta inesperada do Compels (${onde}).`);
		this.name = "RespostaInesperada";
	}
};
function objeto(valor, onde) {
	if (typeof valor !== "object" || valor === null || Array.isArray(valor)) throw new RespostaInesperada(onde);
	return valor;
}
function texto$1(o, campo, onde) {
	const v = o[campo];
	if (typeof v !== "string") throw new RespostaInesperada(`${onde}.${campo}`);
	return v;
}
function numero(o, campo, onde) {
	const v = o[campo];
	if (typeof v !== "number" || !Number.isFinite(v)) throw new RespostaInesperada(`${onde}.${campo}`);
	return v;
}
/** Aceita lista direta, `{ data: [...] }` ou `{ results: [...] }`. */
function listaDe(resposta, onde) {
	const bruta = Array.isArray(resposta) ? resposta : Array.isArray(resposta?.data) ? resposta.data : Array.isArray(resposta?.results) ? resposta.results : null;
	if (!bruta) throw new RespostaInesperada(onde);
	return bruta.map((linha) => objeto(linha, onde));
}
function leiturasDeRespostas(r) {
	const op = objeto(r.op?.data ?? r.op, "op");
	if (typeof op.status !== "string") throw new RespostaInesperada("op.status");
	return {
		status: op.status,
		tipoPropriedade: numero(op, "tipoPropriedade", "op"),
		quantidadeOp: numero(op, "quantidade", "op"),
		empenhos: listaDe(r.empenhos, "empenhos").map((e) => ({
			...typeof e.id === "number" ? { id: e.id } : {},
			quantidade: numero(e, "quantidade", "empenho"),
			quantidadeEstornar: numero(e, "quantidadeEstornar", "empenho"),
			situacao: texto$1(e, "situacao", "empenho")
		})),
		requisicoes: listaDe(r.requisicoes, "requisicoes").map((q) => ({
			...typeof q.id === "number" ? { id: q.id } : {},
			quantidade: numero(q, "quantidade", "requisicao"),
			quantidadeEstornar: numero(q, "quantidadeEstornar", "requisicao"),
			situacao: texto$1(q, "situacao", "requisicao")
		})),
		apontamentos: listaDe(r.apontamentos, "apontamentos").map((a) => ({
			quantidadeProduzida: numero(a, "quantidadeProduzida", "apontamento"),
			quantidadeCancelada: numero(a, "quantidadeCancelada", "apontamento"),
			...typeof a.dataInicio === "string" ? { dataInicio: a.dataInicio } : {}
		}))
	};
}
//#endregion
//#region src/modules/compels/domain/corpos.ts
/**
* Corpos que a tela do Compels envia ao Requisitar e ao Apontar, montados a partir das respostas das
* consultas que a tela faz ANTES de gravar (spec 16/10/2026, §2.6 e §2.10). Funções puras: não chamam
* o ERP. A ordem dos campos replica a captura, e os testes comparam o JSON byte a byte com ela.
*/
function booleano(o, campo, onde) {
	const v = o[campo];
	if (typeof v !== "boolean") throw new RespostaInesperada(`${onde}.${campo}`);
	return v;
}
function componentesDeRequisicao(resposta) {
	return listaDe(resposta, "verificaQuantidadeRequisitada").map((linha) => {
		const item = objeto(linha.item, "componente.item");
		return {
			itemId: numero(item, "id", "componente.item"),
			codigo: texto$1(item, "codigo", "componente.item"),
			rastreavel: booleano(item, "rastreavel", "componente.item"),
			precoCusto: numero(item, "precoCusto", "componente.item"),
			quantidadeRequisitar: numero(linha, "quantidadeRequisitar", "componente"),
			quantidadeComposicao: numero(linha, "quantidadeComposicao", "componente"),
			quantidadeRequisitadaDisponivel: numero(linha, "quantidadeRequisitadaDisponivel", "componente"),
			itemOrdemProducaoId: numero(linha, "itemOrdemProducaoId", "componente"),
			itemFantasma: booleano(linha, "itemFantasma", "componente"),
			saldo: numero(linha, "saldo", "componente")
		};
	});
}
/** Corpo (campo `jsonData`) de `verificaQuantidadeRequisitada`. */
function consultaRequisitada(p) {
	return {
		ordemProducaoSimples: {
			tipoPropriedade: p.tipoPropriedade,
			operacaoMista: false,
			composicaoProduto: { item: { id: p.produtoId } },
			negociante: { id: String(p.negocianteId) },
			id: String(p.opId)
		},
		quantidade: p.quantidade
	};
}
function componentesDeApontamento(resposta) {
	return listaDe(resposta, "verificaDisponibilidade").map((linha) => {
		const item = objeto(linha.item, "componente.item");
		const vinculo = objeto(linha.itemOrdemProducaoSimples, "componente.itemOrdemProducaoSimples");
		return {
			itemId: numero(item, "id", "componente.item"),
			codigo: texto$1(item, "codigo", "componente.item"),
			quantidadeUtilizada: numero(linha, "quantidadeUtilizada", "componente"),
			quantidadeComposicao: numero(linha, "quantidadeComposicao", "componente"),
			itemOrdemProducaoId: numero(vinculo, "id", "componente.itemOrdemProducaoSimples"),
			itemFantasma: booleano(linha, "itemFantasma", "componente"),
			saldoDisponivel: numero(linha, "saldoDisponivel", "componente")
		};
	});
}
/** Corpo (campos do formulário) de `apontamentoOrdemProducao/verificaDisponibilidade`. */
function consultaDisponibilidade(p) {
	return {
		idOrdemProducao: String(p.opId),
		quantidadeApontar: String(p.quantidade),
		itemPaiId: String(p.produtoId),
		page: "1",
		start: "0",
		limit: "50"
	};
}
//#endregion
//#region src/modules/compels/domain/arvore-op.ts
const num$1 = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function noDaLinhaOp(linha, detalhe) {
	const l = linha ?? {};
	const item = (detalhe?.data ?? detalhe ?? {}).composicaoProduto?.item;
	const numero = num$1(l.numero);
	if (numero === null || typeof item?.codigo !== "string" || item.codigo.trim() === "") return null;
	return {
		numero,
		codigo: item.codigo.trim(),
		descricao: typeof item.descricao === "string" ? item.descricao.trim() : "",
		nivel: num$1(l.nivel) ?? 1,
		mae: num$1(l.ordemProducaoMaeNumero),
		principal: num$1(l.ordemProducaoPrincipalNumero),
		status: typeof l.status === "string" ? l.status : ""
	};
}
//#endregion
//#region src/modules/compels/domain/espelho-ops.ts
/**
* ESPELHO DAS OPs ATIVAS DO COMPELS (spec 2026-11-18-cadastro-op-compels-design.md). A lista da tela de OPs
* (`ordemProducaoSimples/findAllFilter`, HAR 18/11) já traz o código/descrição do produto e a árvore (mãe,
* principal, nível): o cron grava cada linha em `sf_compels_ops` e o cadastro de OP só lê o espelho.
*/
const SITUACOES_ATIVAS = [
	"Aberta",
	"Planejada",
	"Empenhada",
	"Em Processo"
];
const TRES_ANOS_MS$1 = 3 * 365 * 24 * 60 * 60 * 1e3;
const dataIso$1 = (ms) => new Date(ms).toISOString().slice(0, 10) + "T00:00:00";
const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
const texto = (v) => typeof v === "string" ? v.trim() : "";
/** O filtro da busca de OP (o mesmo de `ClienteCompels.buscarOp`) sem número, só as situações ativas, janela de 3 anos (a mesma da busca de OP). */
function filtroOpsAtivas(agoraMs) {
	return {
		numero: "",
		codigoNegociante: null,
		nomeNegociante: null,
		cpfCnpjNegociante: null,
		clientePedido: "",
		item: "",
		linha: "",
		tipoPropriedade: null,
		statusList: [...SITUACOES_ATIVAS],
		selecionarPor: "Data Documento",
		dataInicial: dataIso$1(agoraMs - TRES_ANOS_MS$1),
		dataFinal: dataIso$1(agoraMs),
		numeroPedido: "",
		centroCusto: "",
		listarPendentes: false,
		prototipo: false,
		etapa: "",
		selecionarOPPor: "op",
		observacao: "",
		nivel: "",
		responsavelCriacao: "",
		responsavelAlteracao: "",
		situacaoId: null,
		semVinculoComSolicitacaoInternaCompra: false
	};
}
function data(v) {
	if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
	if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString().slice(0, 10);
	return null;
}
/** Uma linha da lista → OP do espelho. Sem número, id ou código do produto = null (nunca inventa). */
function opDaLinhaLista(linha) {
	const l = linha ?? {};
	const item = l.composicaoProduto?.item ?? {};
	const numero = num(l.numero);
	const id = num(l.id);
	const codigo = texto(item.codigo);
	if (numero === null || id === null || codigo === "") return null;
	return {
		numero,
		idCompels: id,
		codigo,
		descricao: texto(item.descricao),
		situacao: texto(l.status),
		nivel: num(l.nivel) ?? 1,
		quantidade: num(l.quantidade) ?? 0,
		quantidadeProduzida: num(l.quantidadeProduzida) ?? 0,
		maeNumero: num(l.ordemProducaoMaeNumero),
		principalNumero: num(l.ordemProducaoPrincipalNumero),
		cliente: texto(l.negociante?.codigo),
		dataDocumento: data(l.dataDocumento)
	};
}
//#endregion
//#region src/modules/compels/domain/negociante.ts
/**
* Cadastro de negociante lido de `GET /negociante/list` (a grade da tela de negociantes do Compels), para achar
* a empresa pelo CPF/CNPJ na entrada do SAT (spec 2026-11-17-sat-entrada-por-nf-design.md, decisão 3). Só leitura.
*
* O filtro `cpfCnpj` busca por trecho e o cadastro guarda o CNPJ com e sem máscara: por isso a linha só vale se
* tiver os MESMOS dígitos. Negociante `inativo` é ignorado.
*/
function filtroNegociante(cpfCnpj) {
	return filtroDaGrade("", cpfCnpj);
}
/**
* O mesmo filtro, pelo `codigo` do negociante (o `negociante.codigo` da lista de OPs): o espelho das OPs troca o
* código pelo nome do cliente. Também busca por trecho — quem confere o código exato é `nomeDoNegociante`.
*/
function filtroNegociantePorCodigo(codigo) {
	return filtroDaGrade(codigo.trim(), "");
}
function filtroDaGrade(codigo, cpfCnpj) {
	return {
		codigo,
		nome: "",
		cpfCnpj,
		telefone: "",
		tipoIdList: null,
		statusIdList: null,
		transportadora: "",
		cep: "",
		municipio: "",
		uf: "",
		pais: "",
		situacao: "ATIVO",
		codigoVendedor: null,
		observacao: "",
		limiteCreditoIdList: null,
		restricaoVendedor: false,
		carteiraRestricaoVendedor: false,
		exibirUltimaCompra: false,
		atendenteAlocadoId: null,
		cadastroLead: false
	};
}
//#endregion
//#region src/modules/compels/domain/saldo-item.ts
function saldoDoItem(resposta, codigo) {
	const alvo = codigo.trim().toUpperCase();
	const linhas = listaDe(resposta, "saldo do item");
	for (const linha of linhas) {
		const item = linha.item;
		if (typeof item !== "object" || item === null) throw new RespostaInesperada("saldo.item");
		const cadastro = item;
		if (typeof cadastro.codigo !== "string") throw new RespostaInesperada("saldo.item.codigo");
		if (cadastro.codigo.trim().toUpperCase() !== alvo) continue;
		const numero = (campo) => {
			const v = linha[campo];
			if (typeof v !== "number" || !Number.isFinite(v)) throw new RespostaInesperada(`saldo.${campo}`);
			return v;
		};
		const unidade = cadastro.unidade?.codigo;
		return {
			codigo: cadastro.codigo,
			descricao: typeof cadastro.descricao === "string" ? cadastro.descricao.trim() : "",
			unidade: typeof unidade === "string" ? unidade : "",
			proprio: numero("saldoItemEstoqueProprio"),
			pendencia: numero("saldoItemPendencia"),
			emTerceiros: numero("saldoItemEstoqueEmTerceiros"),
			deTerceiros: numero("saldoItemEstoqueDeTerceiros")
		};
	}
	return null;
}
//#endregion
//#region src/modules/compels/domain/saldo-por-estoque.ts
/** Linhas do item pedido (código EXATO, sem diferenciar maiúsculas: a busca do Compels não é exata). */
function saldosPorEstoque(resposta, codigo) {
	const alvo = codigo.trim().toUpperCase();
	const saida = [];
	for (const linha of listaDe(resposta, "saldo por estoque")) {
		const item = linha.item;
		if (typeof item?.codigo !== "string") throw new RespostaInesperada("saldoEstoque.item.codigo");
		if (item.codigo.trim().toUpperCase() !== alvo) continue;
		const estoque = linha.estoque;
		if (typeof estoque?.codigo !== "string") throw new RespostaInesperada("saldoEstoque.estoque.codigo");
		if (typeof linha.saldo !== "number" || !Number.isFinite(linha.saldo)) throw new RespostaInesperada("saldoEstoque.saldo");
		saida.push({
			estoque: estoque.codigo.trim(),
			descricao: typeof estoque.descricao === "string" ? estoque.descricao.trim() : "",
			saldo: linha.saldo
		});
	}
	return saida;
}
//#endregion
//#region src/modules/compels/domain/resposta-erp.ts
/** Tira as tags HTML e junta os espaços: a tela de pendências mostra texto simples. */
function textoLimpo(html) {
	return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function mensagemDe(corpo) {
	if (typeof corpo !== "object" || corpo === null) return "";
	const o = corpo;
	for (const campo of ["message", "msg"]) if (typeof o[campo] === "string" && o[campo].trim() !== "") return textoLimpo(o[campo]);
	return "";
}
function classificar(status, mensagem) {
	if (status === 401) return {
		codigo: "sessao_expirada",
		tentarDeNovo: true
	};
	if (status === 403) return {
		codigo: "sem_permissao",
		tentarDeNovo: false
	};
	if (status >= 500) return {
		codigo: "indisponivel",
		tentarDeNovo: true
	};
	if (/est[aá] sendo acessado pelo usu[aá]rio/i.test(mensagem)) return {
		codigo: "op_em_uso",
		tentarDeNovo: true
	};
	if (/maior que a quantidade|excede/i.test(mensagem)) return {
		codigo: "quantidade_acima",
		tentarDeNovo: false
	};
	if (/saldo/i.test(mensagem)) return {
		codigo: "sem_saldo",
		tentarDeNovo: true
	};
	return {
		codigo: "desconhecido",
		tentarDeNovo: false
	};
}
function resultadoDaGravacao(status, corpo) {
	const mensagem = mensagemDe(corpo);
	const recusadoNoCorpo = (typeof corpo === "object" && corpo !== null ? corpo : {}).success === false;
	if (status >= 200 && status < 300 && !recusadoNoCorpo) return {
		ok: true,
		mensagem
	};
	return {
		ok: false,
		...classificar(status, mensagem),
		mensagem: mensagem || `O Compels recusou a gravação (HTTP ${status}).`
	};
}
//#endregion
//#region src/modules/compels/domain/jwt.ts
/** Instante de expiração (ms) de um JWT, lido do campo `exp`. Não valida assinatura: só serve para renovar o token a tempo. */
function expiracaoDoJwt(jwt) {
	try {
		const carga = jwt.split(".")[1];
		if (!carga) return null;
		const dados = JSON.parse(Buffer.from(carga, "base64url").toString("utf8"));
		return typeof dados.exp === "number" && Number.isFinite(dados.exp) ? dados.exp * 1e3 : null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/modules/compels/infra/token.ts
/** Falha ao obter o token. Nunca carrega senha nem token na mensagem. */
var ErroDeLogin = class extends Error {
	constructor(etapa, status) {
		super(status === null ? `Sem conexão com o ezpointweb (${etapa}).` : `O ezpointweb recusou o ${etapa === "login" ? "login" : "pedido do token do Compels"} (HTTP ${status}).`);
		this.name = "ErroDeLogin";
	}
};
const MARGEM_MS = 300 * 1e3;
const VALIDADE_PADRAO_MS = 1800 * 1e3;
/** Guarda o token do Compels em memória e o renova antes de vencer, ou quando o ERP responde 401. */
var GerenciadorToken = class {
	constructor(config, buscar = fetch, agora = Date.now) {
		this.config = config;
		this.buscar = buscar;
		this.agora = agora;
		this.token = null;
		this.venceEm = 0;
	}
	invalidar() {
		this.token = null;
		this.venceEm = 0;
	}
	async obter() {
		if (this.token && this.agora() < this.venceEm - MARGEM_MS) return this.token;
		const tokenEzpoint = await this.loginEzpoint();
		const tokenCompels = await this.tokenDoCompels(tokenEzpoint);
		this.token = tokenCompels;
		this.venceEm = expiracaoDoJwt(tokenCompels) ?? this.agora() + VALIDADE_PADRAO_MS;
		return tokenCompels;
	}
	async chamar(etapa, url, init) {
		let r;
		try {
			r = await this.buscar(url, {
				...init,
				signal: AbortSignal.timeout(3e4)
			});
		} catch {
			throw new ErroDeLogin(etapa, null);
		}
		if (!r.ok) throw new ErroDeLogin(etapa, r.status);
		try {
			return await r.json();
		} catch {
			throw new ErroDeLogin(etapa, r.status);
		}
	}
	async loginEzpoint() {
		const token = (await this.chamar("login", `${this.config.ezpointUrl}/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				usuario: this.config.ezpointUsuario,
				senha: this.config.ezpointSenha
			})
		}))?.token;
		if (typeof token !== "string" || token === "") throw new ErroDeLogin("login", 200);
		return token;
	}
	async tokenDoCompels(tokenEzpoint) {
		const token = (await this.chamar("token", `${this.config.ezpointUrl}/getCompelsToken?empresa=${encodeURIComponent(this.config.empresa)}`, { headers: { Authorization: `Bearer ${tokenEzpoint}` } }))?.token;
		if (typeof token !== "string" || token === "") throw new ErroDeLogin("token", 200);
		return token;
	}
};
//#endregion
//#region src/modules/compels/infra/cliente.ts
const TRES_ANOS_MS = 3 * 365 * 24 * 60 * 60 * 1e3;
function dataIso(ms) {
	return new Date(ms).toISOString().slice(0, 10) + "T00:00:00";
}
/**
* Cliente da API interna da tela do Compels (spec 16/10/2026). Autentica com o token do ezpointweb,
* renova sozinho e tenta de novo UMA vez se o ERP responder 401. Por ora só leituras e a trava;
* Requisitar/Apontar entram na etapa seguinte.
*/
var ClienteCompels = class {
	constructor(config, token = new GerenciadorToken(config), buscar = fetch, agora = Date.now) {
		this.config = config;
		this.token = token;
		this.buscar = buscar;
		this.agora = agora;
	}
	async enviar(caminho, init = {}, tentouRenovar = false) {
		const bearer = await this.token.obter();
		const proprios = init.headers ?? {};
		const r = await this.buscar(`${this.config.apiUrl}${caminho}`, {
			...init,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...proprios,
				Authorization: `Bearer ${bearer}`
			},
			signal: AbortSignal.timeout(3e4)
		});
		if (r.status === 401 && !tentouRenovar) {
			this.token.invalidar();
			return this.enviar(caminho, init, true);
		}
		return r;
	}
	async json(caminho, init) {
		const r = await this.enviar(caminho, init);
		if (!r.ok) throw new RespostaInesperada(`${caminho} (HTTP ${r.status})`);
		try {
			return await r.json();
		} catch {
			throw new RespostaInesperada(caminho);
		}
	}
	formulario(campos) {
		return {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(campos)
		};
	}
	/** Acha a OP pelo NÚMERO (o que o ShopFloor conhece) e lê o cadastro dela. `null` se não existir. */
	async buscarOp(numero) {
		const filtro = {
			numero: String(numero),
			codigoNegociante: null,
			nomeNegociante: null,
			cpfCnpjNegociante: null,
			clientePedido: "",
			item: "",
			linha: "",
			tipoPropriedade: null,
			statusList: null,
			selecionarPor: "Data Documento",
			dataInicial: dataIso(this.agora() - TRES_ANOS_MS),
			dataFinal: dataIso(this.agora()),
			numeroPedido: "",
			centroCusto: "",
			listarPendentes: false,
			prototipo: false,
			etapa: "",
			selecionarOPPor: "op",
			observacao: "",
			nivel: "",
			responsavelCriacao: "",
			responsavelAlteracao: "",
			situacaoId: null,
			semVinculoComSolicitacaoInternaCompra: false
		};
		const achada = listaDe(await this.json("/ordemProducaoSimples/findAllFilter", this.formulario({
			sortFilter: "null",
			filtro: JSON.stringify(filtro),
			page: "1",
			start: "0",
			limit: "25"
		})), "busca de OP").find((o) => o.numero === numero);
		if (!achada || typeof achada.id !== "number") return null;
		const detalhe = await this.json("/ordemProducaoSimples/findById", this.formulario({
			id: String(achada.id),
			page: "1",
			start: "0",
			limit: "25"
		}));
		const d = detalhe?.data ?? detalhe;
		const item = d.composicaoProduto?.item;
		const unidade = (item?.unidade)?.codigo;
		const negociante = d.negociante?.id;
		if (typeof d.status !== "string" || typeof d.tipoPropriedade !== "number" || typeof d.quantidade !== "number" || typeof item?.codigo !== "string" || typeof item.id !== "number" || typeof unidade !== "string" || typeof negociante !== "number") throw new RespostaInesperada("cadastro da OP");
		return {
			id: achada.id,
			numero,
			status: d.status,
			tipoPropriedade: d.tipoPropriedade,
			quantidade: d.quantidade,
			produtoId: item.id,
			negocianteId: negociante,
			codigoItem: item.codigo,
			unidade
		};
	}
	/** Estado completo da OP (empenhos, requisições e apontamentos), pelas LISTAS. */
	async lerOp(op) {
		const id = String(op.id);
		const [empenhos, requisicoes, apontamentos] = await Promise.all([
			this.json(`/empenho/findByOrdemProducaoId?idOrdemProducao=${id}&page=1&start=0&limit=50`),
			this.json("/requisicaoOrdemProducao/findByOrdemProducaoId", this.formulario({
				id,
				page: "1",
				start: "0",
				limit: "50"
			})),
			this.json("/apontamentoOrdemProducao/findByOrdemProducaoId", this.formulario({
				id,
				page: "1",
				start: "0",
				limit: "50"
			}))
		]);
		return leiturasDeRespostas({
			op: {
				status: op.status,
				tipoPropriedade: op.tipoPropriedade,
				quantidade: op.quantidade
			},
			empenhos,
			requisicoes,
			apontamentos
		});
	}
	/** Trava de edição da OP: 201 = é nossa; 400 = outra pessoa está com a OP aberta. */
	async adquirirTrava(idOp) {
		const r = await this.enviar(`/lock/eng.ordemproducaosimples/${idOp}`, { method: "POST" });
		let corpo = null;
		try {
			corpo = await r.json();
		} catch {}
		return resultadoDaGravacao(r.status, corpo);
	}
	async liberarTrava(idOp) {
		await this.enviar(`/lock/release/eng.ordemproducaosimples/${idOp}`, { method: "DELETE" });
	}
	/** Consulta que a tela faz antes de requisitar: componentes, saldo e custo. Só leitura. */
	async consultarRequisicao(op, quantidade) {
		return componentesDeRequisicao(await this.json("/requisicaoOrdemProducao/verificaQuantidadeRequisitada", this.formulario({
			jsonData: JSON.stringify(consultaRequisitada({
				opId: op.id,
				tipoPropriedade: op.tipoPropriedade,
				produtoId: op.produtoId,
				negocianteId: op.negocianteId,
				quantidade
			})),
			page: "1",
			start: "0",
			limit: "50"
		})));
	}
	/** Consulta que a tela faz antes de apontar: consumo e saldo de cada componente. Só leitura. */
	async consultarDisponibilidade(op, quantidade) {
		return componentesDeApontamento(await this.json("/apontamentoOrdemProducao/verificaDisponibilidade", this.formulario(consultaDisponibilidade({
			opId: op.id,
			quantidade,
			produtoId: op.produtoId
		}))));
	}
	async gravar(caminho, corpo) {
		const r = await this.enviar(caminho, this.formulario({ jsonData: JSON.stringify(corpo) }));
		let resposta = null;
		try {
			resposta = await r.json();
		} catch {}
		return resultadoDaGravacao(r.status, resposta);
	}
	/** `requisicaoOrdemProducao/save`. GRAVA no Compels. */
	requisitar(corpo) {
		return this.gravar("/requisicaoOrdemProducao/save", corpo);
	}
	/** `apontamentoOrdemProducao/save`. GRAVA no Compels e dá entrada no estoque. */
	apontar(corpo) {
		return this.gravar("/apontamentoOrdemProducao/save", corpo);
	}
	/** Detalhe de UM empenho (`empenho/findById/{id}`), com os itens e a pendência de cada um. Só leitura. */
	lerEmpenho(id) {
		return this.json(`/empenho/findById/${id}?page=1&start=0&limit=25`);
	}
	/** Detalhe de UMA requisição (`requisicaoOrdemProducao/findById`), com os itens e a pendência. Só leitura. */
	lerRequisicao(id) {
		return this.json("/requisicaoOrdemProducao/findById", this.formulario({
			id: String(id),
			page: "1",
			start: "0",
			limit: "50"
		}));
	}
	/** Corpo em JSON puro (não `jsonData=` de formulário), como a tela manda nos dois "Pagar Pendência". */
	async gravarJson(caminho, corpo) {
		const r = await this.enviar(caminho, {
			method: "POST",
			body: JSON.stringify(corpo)
		});
		let resposta = null;
		try {
			resposta = await r.json();
		} catch {}
		return resultadoDaGravacao(r.status, resposta);
	}
	/** `empenho/pagarPendencia`. GRAVA no Compels (empenha o que faltou). O ERP processa depois ("consulte a situação"). */
	pagarPendenciaEmpenho(corpo) {
		return this.gravarJson("/empenho/pagarPendencia", corpo);
	}
	/** `requisicaoOrdemProducao/pagarPendencia`. GRAVA no Compels (requisita o que faltou). Também processa depois. */
	pagarPendenciaRequisicao(corpo) {
		return this.gravarJson("/requisicaoOrdemProducao/pagarPendencia", corpo);
	}
	/**
	* Notas de SAÍDA de emissão própria ainda NÃO baixadas, com o filtro exato da tela (HAR 16/11/2026): os
	* campos de negociante vão `null` (texto vazio filtra por nome '' e não acha nada). Todas as datas — o
	* corte por emissão é feito pelo domínio. Só leitura.
	*/
	async listarNfsPendentes() {
		const filtro = {
			tipo: "1 - Saída",
			emissaoPropria: true,
			numero: "",
			dataInicial: null,
			dataFinal: null,
			status: null,
			statusAceiteBaixa: "false",
			selecionarPor: "emissao",
			nomeNegociante: null,
			cpfCnpjNegociante: null,
			codigoNegociante: null,
			item: "",
			coc: "",
			cfop: ""
		};
		const todas = [];
		const limite = 100;
		for (let pagina = 1; pagina <= 20; pagina++) {
			const resposta = await this.json("/notaICMS/findFilterStockMoves", this.formulario({
				filter: JSON.stringify(filtro),
				page: String(pagina),
				start: String((pagina - 1) * limite),
				limit: String(limite)
			}));
			const linhas = listaDe(resposta, "notas pendentes de baixa");
			todas.push(...linhas);
			const total = resposta?.totalCount;
			if (linhas.length < limite || typeof total === "number" && todas.length >= total) break;
		}
		return todas;
	}
	/** As três listas de itens da nota que a tela de baixa carrega (estoque próprio, em terceiros, de terceiros). Só leitura. */
	async itensDaNf(idNota) {
		const ler = async (sufixo) => listaDe(await this.json(`/itemBaixaMercadoria/findAll${sufixo}ByNotaICMSId`, this.formulario({
			notaICMSId: String(idNota),
			page: "1",
			start: "0",
			limit: "500"
		})), `itens da NF (${sufixo})`);
		const [proprias, emTerceiros, deTerceiros] = await Promise.all([
			ler("EstoqueProprio"),
			ler("EstoqueEmTerceiros"),
			ler("EstoqueDeTerceiros")
		]);
		return {
			proprias,
			emTerceiros,
			deTerceiros
		};
	}
	/** Trava de edição da nota (a mesma da tela): 201 = é nossa; 400 = alguém está com a nota aberta. */
	async travarNf(idNota) {
		const r = await this.enviar(`/lock/lfi.notaicms/${idNota}`, { method: "POST" });
		let corpo = null;
		try {
			corpo = await r.json();
		} catch {}
		return resultadoDaGravacao(r.status, corpo);
	}
	async liberarNf(idNota) {
		await this.enviar(`/lock/release/lfi.notaicms/${idNota}`, { method: "DELETE" });
	}
	/** `baixaMercadoria/baixar` com corpo JSON, como a tela. GRAVA no Compels (baixa o estoque da nota). */
	baixarNf(corpo) {
		return this.gravarJson("/baixaMercadoria/baixar", corpo);
	}
	/**
	* Saldo de estoque de UM item (a PMO) pela tela Movimento de Item. Só leitura. `null` = o item não veio
	* na resposta (código exato). Pede os itens de saldo zero também, senão "não existe" e "zero" se
	* confundiriam.
	*/
	async consultarSaldoItem(codigo) {
		const filtro = {
			codigo: codigo.trim(),
			descricao: "",
			data: dataIso(this.agora()),
			exibeItensComSaldoZerado: true
		};
		return saldoDoItem(await this.json("/itemMovimento/findFilter", this.formulario({
			filter: JSON.stringify(filtro),
			page: "1",
			start: "0",
			limit: "50"
		})), codigo);
	}
	/**
	* Saldo do item POR ESTOQUE (PA, EINTER, EA…), a mesma consulta da linha expandida do Movimento de Item.
	* Só leitura. Data no formato da tela (`dd/mm/aaaa`, dia de Brasília); item sem saldo = lista vazia.
	*/
	async consultarSaldoPorEstoque(codigo) {
		const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(this.agora()));
		const params = new URLSearchParams({
			codigoItem: codigo.trim(),
			descricaoItem: "",
			data,
			exibeItensComSaldoZerado: "false",
			estoque: "",
			offset: "0",
			limit: "50"
		});
		return saldosPorEstoque(await this.json(`/estoque/consultaSaldoItemEstoque?${params}`), codigo);
	}
	/** Uma OP como nó da árvore (número, código, mãe, principal, nível). `null` = não existe ou resposta sem código. */
	async lerNoOp(numero) {
		const filtro = {
			numero: String(numero),
			codigoNegociante: null,
			nomeNegociante: null,
			cpfCnpjNegociante: null,
			clientePedido: "",
			item: "",
			linha: "",
			tipoPropriedade: null,
			statusList: null,
			selecionarPor: "Data Documento",
			dataInicial: dataIso(this.agora() - TRES_ANOS_MS),
			dataFinal: dataIso(this.agora()),
			numeroPedido: "",
			centroCusto: "",
			listarPendentes: false,
			prototipo: false,
			etapa: "",
			selecionarOPPor: "op",
			observacao: "",
			nivel: "",
			responsavelCriacao: "",
			responsavelAlteracao: "",
			situacaoId: null,
			semVinculoComSolicitacaoInternaCompra: false
		};
		const linha = listaDe(await this.json("/ordemProducaoSimples/findAllFilter", this.formulario({
			sortFilter: "null",
			filtro: JSON.stringify(filtro),
			page: "1",
			start: "0",
			limit: "25"
		})), "busca de OP").find((o) => o.numero === numero);
		if (!linha || typeof linha.id !== "number") return null;
		return noDaLinhaOp(linha, await this.json("/ordemProducaoSimples/findById", this.formulario({
			id: String(linha.id),
			page: "1",
			start: "0",
			limit: "25"
		})));
	}
	/**
	* Os DESCENDENTES de uma OP (filhas, netas…). No Compels a família é numerada em sequência (8681, 8682, 8683…),
	* então varre os números seguintes enquanto a OP principal for a mesma; para no primeiro que não existe ou é de
	* outra família. Devolve só quem descende da OP pedida (a fonte 8682 não leva o gabinete 8685, irmão dela).
	*/
	async lerDescendentes(numero) {
		const raiz = await this.lerNoOp(numero);
		if (!raiz) return [];
		const familia = raiz.principal ?? raiz.numero;
		const nos = [];
		for (let n = numero + 1, i = 0; i < 25; n++, i++) {
			const no = await this.lerNoOp(n);
			if (!no || (no.principal ?? no.numero) !== familia) break;
			nos.push(no);
		}
		const porNumero = new Map(nos.map((x) => [x.numero, x]));
		const desce = (x) => {
			let atual = x;
			for (let i = 0; i < 20 && atual; i++) {
				if (atual.mae === numero) return true;
				atual = atual.mae === null ? void 0 : porNumero.get(atual.mae);
			}
			return false;
		};
		return nos.filter(desce);
	}
	/**
	* As OPs ATIVAS (Aberta/Planejada/Empenhada/Em Processo) dos últimos 3 anos, pela lista da tela de OPs (HAR 18/11):
	* `POST ordemProducaoSimples/findAllFilter` paginado até o `totalCount`. Só leitura — é o espelho do cadastro de OP.
	* Lista que acaba antes do total é erro: o espelho inativa quem não veio, então lista incompleta nunca é gravada.
	*/
	async listarOpsAtivas() {
		const filtro = JSON.stringify(filtroOpsAtivas(this.agora()));
		const limite = 100;
		const maxPaginas = 50;
		const brutas = [];
		let total = null;
		let chegouAoFim = false;
		for (let pagina = 1; pagina <= maxPaginas; pagina++) {
			const resposta = await this.json("/ordemProducaoSimples/findAllFilter", this.formulario({
				sortFilter: "null",
				filtro,
				page: String(pagina),
				start: String((pagina - 1) * limite),
				limit: String(limite)
			}));
			const linhas = listaDe(resposta, "lista de OPs ativas");
			brutas.push(...linhas);
			const t = resposta?.totalCount;
			if (typeof t === "number") total = t;
			if (linhas.length < limite || total !== null && brutas.length >= total) {
				chegouAoFim = true;
				break;
			}
		}
		if (!chegouAoFim) throw new RespostaInesperada(`lista de OPs ativas passou de ${maxPaginas * limite} linhas`);
		if (total !== null && brutas.length < total) throw new RespostaInesperada(`lista de OPs ativas incompleta (${brutas.length} de ${total})`);
		const lidas = brutas.map(opDaLinhaLista);
		const ilegiveis = lidas.filter((o) => o === null).length;
		if (ilegiveis > 0) throw new RespostaInesperada(`${ilegiveis} linha(s) da lista de OPs ativas não puderam ser lidas`);
		const unicas = [...new Map(lidas.map((o) => [o.numero, o])).values()];
		if (total !== null && unicas.length < total) throw new RespostaInesperada(`lista de OPs ativas incompleta (${unicas.length} de ${total})`);
		return unicas;
	}
	/**
	* Negociantes pelo CPF/CNPJ (`GET negociante/list`, o filtro da grade da tela de negociantes). Só leitura — a
	* entrada do SAT acha a empresa da nota por aqui. A resposta crua vai para `negocianteDoCnpj`.
	*/
	buscarNegociantes(cpfCnpj) {
		const filtro = encodeURIComponent(JSON.stringify(filtroNegociante(cpfCnpj)));
		return this.json(`/negociante/list?sortFilter=${encodeURIComponent("[]")}&filter=${filtro}&true=1&offset=0&limit=50`);
	}
	/** Negociantes pelo código (o mesmo `GET negociante/list`). Só leitura — o espelho das OPs acha o nome do cliente. */
	buscarNegociantesPorCodigo(codigo) {
		const filtro = encodeURIComponent(JSON.stringify(filtroNegociantePorCodigo(codigo)));
		return this.json(`/negociante/list?sortFilter=${encodeURIComponent("[]")}&filter=${filtro}&true=1&offset=0&limit=50`);
	}
	/** Defeitos cadastrados no SAT do Compels (`POST sat/defeito/findAll`, formulário paginado). Só leitura. */
	async listarDefeitosSat() {
		const limite = 100;
		const todas = [];
		for (let pagina = 1; pagina <= 20; pagina++) {
			const resposta = await this.json("/sat/defeito/findAll", this.formulario({
				page: String(pagina),
				start: String((pagina - 1) * limite),
				limit: String(limite)
			}));
			const linhas = listaDe(resposta, "defeitos do SAT");
			todas.push(...linhas);
			const total = resposta?.totalCount;
			if (linhas.length < limite || typeof total === "number" && todas.length >= total) break;
		}
		return todas;
	}
	/** A composição (estrutura) de um item pelo código (`POST composicaoProduto/findByCodigoItem`). Só leitura. */
	composicaoDoItem(codigo) {
		return this.json("/composicaoProduto/findByCodigoItem", this.formulario({ codigoItem: codigo.trim() }));
	}
	/** A árvore inteira de uma composição (`POST composicaoProduto/findComposicaoByIdEntireTree`). Só leitura. */
	arvoreDaComposicao(id) {
		return this.json("/composicaoProduto/findComposicaoByIdEntireTree", this.formulario({ id: String(id) }));
	}
	/** Os itens que usam este item na estrutura (`GET composicaoProduto/findParentsByItemId/<id>`). Só leitura. */
	paisDoItem(itemId) {
		return this.json(`/composicaoProduto/findParentsByItemId/${itemId}`);
	}
	/**
	* Busca no cadastro de itens pela tela Movimento de Item (`itemMovimento/findFilter`), a mesma de
	* `consultarSaldoItem`. Só leitura. O filtro vem pronto (`filtroBuscaItem` no domínio do SAT).
	*/
	buscarItens(filtro) {
		return this.json("/itemMovimento/findFilter", this.formulario({
			filter: JSON.stringify(filtro),
			page: "1",
			start: "0",
			limit: "30"
		}));
	}
};
//#endregion
//#region src/modules/compels/infra/config.ts
var ConfiguracaoIncompleta = class extends Error {
	constructor(faltam) {
		super(`Faltam variáveis de ambiente do Compels: ${faltam.join(", ")}.`);
		this.name = "ConfiguracaoIncompleta";
	}
};
function configDoAmbiente(env = process.env) {
	const usuario = env.COMPELS_EZPOINT_USUARIO?.trim();
	const senha = env.COMPELS_EZPOINT_SENHA;
	const faltam = [];
	if (!usuario) faltam.push("COMPELS_EZPOINT_USUARIO");
	if (!senha) faltam.push("COMPELS_EZPOINT_SENHA");
	if (faltam.length > 0 || !usuario || !senha) throw new ConfiguracaoIncompleta(faltam);
	return {
		ezpointUrl: (env.COMPELS_EZPOINT_URL?.trim() || "https://admin.ezpointweb.com.br/admin-ws").replace(/\/$/, ""),
		ezpointUsuario: usuario,
		ezpointSenha: senha,
		empresa: env.COMPELS_EZPOINT_EMPRESA?.trim() || "enterplak",
		apiUrl: (env.COMPELS_API_URL?.trim() || "https://api.erpeasy.compels.net").replace(/\/$/, "")
	};
}
//#endregion
//#region src/modules/sat/domain/estrutura.ts
const obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : null;
const txt = (v) => typeof v === "string" ? v.trim() : "";
const PROFUNDIDADE_MAXIMA = 15;
/** `findByCodigoItem`: o id da composição do item; null = o item não tem estrutura. */
function idDaComposicao(resposta) {
	const r = obj(resposta);
	const d = r && "data" in r ? r.data : resposta;
	const alvo = Array.isArray(d) ? d[0] : d;
	const id = obj(alvo)?.id;
	return typeof id === "number" && Number.isFinite(id) ? id : null;
}
function lerNo(v, profundidade) {
	const o = obj(v);
	if (!o || profundidade > PROFUNDIDADE_MAXIMA) return null;
	const item = obj(o.item);
	const codigo = txt(item?.codigo).toUpperCase();
	if (codigo === "") return null;
	const filhos = Array.isArray(o.children) ? o.children : [];
	return {
		codigo,
		descricao: txt(item?.descricao),
		itemId: typeof item?.id === "number" ? item.id : null,
		filhos: filhos.map((f) => lerNo(f, profundidade + 1)).filter((x) => x !== null)
	};
}
/**
* `findComposicaoByIdEntireTree` devolve `{children, success}`. Devolve os nós de 1º nível (cada um com os filhos).
* Se a raiz vier como um nó só, que é o próprio produto, desce nele.
*/
function arvoreDaResposta(resposta, codigoProduto) {
	const r = obj(resposta);
	if (!r || !Array.isArray(r.children)) throw new RespostaInesperada("estrutura do produto");
	const nos = r.children.map((f) => lerNo(f, 1)).filter((x) => x !== null);
	if (nos.length === 1 && nos[0].codigo === codigoProduto.trim().toUpperCase()) return nos[0].filhos;
	return nos;
}
/** Prefixos que nunca entram na camada 3: PRT = etapa SMD/PTH da placa; RWSV = serviço (injeção, pintura). */
const PREFIXOS_FORA_DA_LISTA = ["PRT", "RWSV"];
const EMBALAGEM = /\b(EMBALAGEM|CAIXA DE PAPELAO|CAIXA PAPELAO|SACO|ETIQUETA|MANUAL|CALCO|PLASTICO BOLHA|FITA)\b/;
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
function foraDaLista(n) {
	return PREFIXOS_FORA_DA_LISTA.some((p) => n.codigo.startsWith(p)) || EMBALAGEM.test(semAcento(n.descricao));
}
/**
* Camada 3: as peças trocáveis do produto = nós de 1º e 2º nível que são subconjunto montado (têm filhos) ou têm
* código PMO*, fora os PRT, os RWSV e a embalagem. O nó PRT não entra, mas os filhos dele são olhados (até o 2º nível);
* serviço e embalagem não são abertos. Folha sem PMO* (parafuso, componente) fica fora. Sem repetir código.
*/
function pecasTrocaveis(arvore) {
	const saida = /* @__PURE__ */ new Map();
	const fila = arvore.map((n) => ({
		n,
		nivel: 1
	}));
	while (fila.length > 0) {
		const { n, nivel } = fila.shift();
		const ehPrt = n.codigo.startsWith("PRT");
		if (foraDaLista(n) && !ehPrt) continue;
		if (!foraDaLista(n) && (n.filhos.length > 0 || n.codigo.startsWith("PMO")) && !saida.has(n.codigo)) saida.set(n.codigo, n);
		if (nivel < 2) fila.push(...n.filhos.map((f) => ({
			n: f,
			nivel: nivel + 1
		})));
	}
	return [...saida.values()];
}
function pecaDaLinha(l) {
	const item = obj(l.item) ?? l;
	const codigo = txt(item.codigo).toUpperCase();
	return codigo === "" ? null : {
		codigo,
		descricao: txt(item.descricao)
	};
}
const semRepetir = (xs) => {
	const m = /* @__PURE__ */ new Map();
	for (const x of xs) if (x && !m.has(x.codigo)) m.set(x.codigo, x);
	return [...m.values()];
};
/** `findParentsByItemId`: os itens que usam este item na estrutura. */
function paisDaResposta(resposta) {
	return semRepetir(listaDe(resposta, "pais do item").map(pecaDaLinha));
}
/** `itemMovimento/findFilter`: as linhas viram código + descrição (até `limite`). */
function itensDaBusca(resposta, limite = 30) {
	return semRepetir(listaDe(resposta, "busca de itens").map(pecaDaLinha)).slice(0, limite);
}
/** Termo com cara de código (letras + dígito, sem espaço) vai em `codigo`; o resto em `descricao`. */
function filtroBuscaItem(termo, dataIso) {
	const t = termo.trim();
	const pareceCodigo = /^[A-Za-z]{2,}[A-Za-z0-9_.-]*\d[A-Za-z0-9_.-]*$/.test(t);
	return {
		codigo: pareceCodigo ? t.toUpperCase() : "",
		descricao: pareceCodigo ? "" : t,
		data: dataIso,
		exibeItensComSaldoZerado: true
	};
}
//#endregion
//#region tools/compels/sat-estrutura.ts
/**
* CONFERÊNCIA (SÓ LEITURA) das leituras do Compels que a manutenção do SAT usa (plano 2026-11-26, Tarefa 7):
*   1. composicaoProduto/findByCodigoItem → id da composição do PRODUTO;
*   2. findComposicaoByIdEntireTree → a árvore; imprime as chaves do 1º nó cru e a camada 3 (peças trocáveis);
*   3. --pais: findParentsByItemId dos 5 primeiros trocáveis que têm item.id, e os PMOE* entre os pais;
*   4. --busca TERMO: itemMovimento/findFilter com o termo (confere se a busca é PARCIAL: "fonte" acha "FONTE 12V").
* Nunca grava nada, nunca imprime senha nem token.
*
* Uso: node tools/compels/sat-estrutura.mjs PRODUTO [--pais] [--busca TERMO]      (ex.: PMOC31 --pais --busca fonte)
* Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (opcionais: COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL,
* COMPELS_API_URL) — as mesmas do .env.production.
*
* O `.mjs` ao lado é GERADO. Para gerar de novo:
*   npx rolldown tools/compels/sat-estrutura.ts --file tools/compels/sat-estrutura.mjs --format esm --platform node
*/
const args = process.argv.slice(2);
const produto = (args.find((a) => !a.startsWith("--")) ?? "").trim().toUpperCase();
const comPais = args.includes("--pais");
const iBusca = args.indexOf("--busca");
const termo = iBusca >= 0 ? (args[iBusca + 1] ?? "").trim() : "";
if (!produto) {
	console.log("uso: node tools/compels/sat-estrutura.mjs PRODUTO [--pais] [--busca TERMO]");
	process.exit(1);
}
const cliente = new ClienteCompels(configDoAmbiente());
const cru = await cliente.composicaoDoItem(produto);
console.log(`findByCodigoItem(${produto}): chaves do topo = ${Object.keys(cru ?? {}).join(", ")}`);
const id = idDaComposicao(cru);
if (id === null) {
	console.log("  → sem id de composição (o produto não tem estrutura OU o formato é outro). Resposta crua (1.000 caracteres):");
	console.log(JSON.stringify(cru).slice(0, 1e3));
	process.exit(2);
}
console.log(`  → id da composição: ${id}`);
const arvoreCrua = await cliente.arvoreDaComposicao(id);
const filhos = arvoreCrua?.children ?? [];
console.log(`findComposicaoByIdEntireTree(${id}): ${filhos.length} nó(s) na raiz; chaves do 1º nó = ${Object.keys(filhos[0] ?? {}).join(", ")}`);
console.log(`  chaves do item do 1º nó = ${Object.keys(filhos[0]?.item ?? {}).join(", ")}`);
const arvore = arvoreDaResposta(arvoreCrua, produto);
const trocaveis = pecasTrocaveis(arvore);
console.log(`Camada 3 (peças trocáveis): ${trocaveis.length}`);
for (const n of trocaveis) console.log(`  ${n.codigo.padEnd(12)} ${n.descricao}  (item.id ${n.itemId ?? "—"}, ${n.filhos.length} filho(s))`);
console.log("1º nível inteiro (para conferir a regra):");
for (const n of arvore) console.log(`  ${n.codigo.padEnd(12)} ${n.descricao}  (${n.filhos.length} filho(s))`);
if (comPais) for (const n of trocaveis.filter((t) => t.itemId !== null).slice(0, 5)) {
	const pais = paisDaResposta(await cliente.paisDoItem(n.itemId));
	const kits = pais.filter((p) => p.codigo.startsWith("PMOE"));
	console.log(`pais de ${n.codigo}: ${pais.length} (PMOE*: ${kits.map((k) => k.codigo).join(", ") || "nenhum"})`);
}
if (termo) {
	const hoje = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + "T00:00:00";
	const itens = itensDaBusca(await cliente.buscarItens(filtroBuscaItem(termo, hoje)), 10);
	console.log(`busca "${termo}": ${itens.length} item(ns)`);
	for (const i of itens) console.log(`  ${i.codigo.padEnd(12)} ${i.descricao}`);
}
//#endregion
export {};
