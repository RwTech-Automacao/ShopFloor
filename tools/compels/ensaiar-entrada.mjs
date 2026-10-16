// GERADO por rolldown a partir de ensaiar-entrada.ts. Nao edite: veja o cabecalho do .ts.
//#region src/modules/compels/domain/estado-op.ts
const ESCALA = 1e6;
/** Quantidades do ERP têm até 6 casas: compara em inteiros para não tropeçar em ponto flutuante. */
function q6(valor) {
	return Math.round(valor * ESCALA) / ESCALA;
}
function soma(valores) {
	return q6(valores.reduce((total, v) => total + v, 0));
}
function estadoDaOp(leituras) {
	const temEstorno = leituras.empenhos.some((e) => q6(e.quantidadeEstornar) !== 0) || leituras.requisicoes.some((r) => q6(r.quantidadeEstornar) !== 0) || leituras.apontamentos.some((a) => q6(a.quantidadeCancelada) !== 0);
	const temPendencia = leituras.empenhos.some((e) => e.situacao === "Pendente") || leituras.requisicoes.some((r) => r.situacao === "Pendente");
	const inicios = leituras.apontamentos.flatMap((a) => a.dataInicio ? [a.dataInicio.slice(0, 10)] : []);
	const inicioApontamento = inicios.length > 0 ? `${[...inicios].sort()[0]}T00:00:00` : null;
	return {
		status: leituras.status,
		tipoPropriedade: leituras.tipoPropriedade,
		quantidadeOp: q6(leituras.quantidadeOp),
		empenhada: soma(leituras.empenhos.map((e) => e.quantidade)),
		requisitada: soma(leituras.requisicoes.map((r) => r.quantidade)),
		apontada: soma(leituras.apontamentos.map((a) => a.quantidadeProduzida)),
		temEstorno,
		temPendencia,
		inicioApontamento
	};
}
//#endregion
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
function texto(o, campo, onde) {
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
			quantidade: numero(e, "quantidade", "empenho"),
			quantidadeEstornar: numero(e, "quantidadeEstornar", "empenho"),
			situacao: texto(e, "situacao", "empenho")
		})),
		requisicoes: listaDe(r.requisicoes, "requisicoes").map((q) => ({
			quantidade: numero(q, "quantidade", "requisicao"),
			quantidadeEstornar: numero(q, "quantidadeEstornar", "requisicao"),
			situacao: texto(q, "situacao", "requisicao")
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
			codigo: texto(item, "codigo", "componente.item"),
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
/** Corpo (campo `jsonData`) de `requisicaoOrdemProducao/save`. O nome `itemRequisicaOrdemProducaoList` (sem o "r") é o do ERP. */
function corpoRequisicao(p) {
	return {
		ordemProducao: {
			id: String(p.opId),
			tipoPropriedade: p.tipoPropriedade
		},
		itemRequisicaOrdemProducaoList: p.componentes.map((c) => ({
			item: {
				id: c.itemId,
				codigo: c.codigo,
				rastreavel: c.rastreavel,
				precoCusto: c.precoCusto
			},
			quantidade: c.quantidadeRequisitar,
			quantidadeRequisitadaDisponivel: c.quantidadeRequisitadaDisponivel,
			quantidadeComposicao: c.quantidadeComposicao,
			itemEstoqueRequisicaoList: [],
			itemOrdemProducaoId: c.itemOrdemProducaoId,
			motivoRequisicao: "",
			itemFantasma: c.itemFantasma
		})),
		quantidade: p.quantidade
	};
}
function componentesDeApontamento(resposta) {
	return listaDe(resposta, "verificaDisponibilidade").map((linha) => {
		const item = objeto(linha.item, "componente.item");
		const vinculo = objeto(linha.itemOrdemProducaoSimples, "componente.itemOrdemProducaoSimples");
		return {
			itemId: numero(item, "id", "componente.item"),
			codigo: texto(item, "codigo", "componente.item"),
			quantidadeUtilizada: numero(linha, "quantidadeUtilizada", "componente"),
			quantidadeComposicao: numero(linha, "quantidadeComposicao", "componente"),
			itemOrdemProducaoId: numero(vinculo, "id", "componente.itemOrdemProducaoSimples"),
			itemFantasma: booleano(linha, "itemFantasma", "componente"),
			saldoDisponivel: numero(linha, "saldoDisponivel", "componente")
		};
	});
}
/** Componentes cujo saldo não cobre o consumo do apontamento (a tela pinta de vermelho, "Saldo indisponível"). */
function componentesSemSaldo(componentes) {
	return componentes.filter((c) => !c.itemFantasma && c.saldoDisponivel < c.quantidadeUtilizada);
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
/**
* Corpo (campo `jsonData`) de `apontamentoOrdemProducao/save`. `dataInicio` e `dataFim` no formato
* local da tela, `AAAA-MM-DDTHH:MM:SS`, sem fuso.
*/
function corpoApontamento(p) {
	return {
		ordemProducao: { id: String(p.opId) },
		item: { id: String(p.produtoId) },
		quantidadeProduzida: p.quantidade,
		refugo: 0,
		quantidadeCancelada: 0,
		dataInicio: p.dataInicio,
		dataFim: p.dataFim,
		ordemProducaoSimplesInspecao: { id: null },
		itemApontamentoOrdemProducaoList: p.componentes.map((c) => ({
			item: { id: c.itemId },
			quantidadeUtilizada: c.quantidadeUtilizada,
			quantidadePerda: 0,
			quantidadePerdaRefugo: 0,
			quantidadeCancelada: 0,
			quantidadeComposicao: c.quantidadeComposicao,
			motivo: "",
			itemOrdemProducaoSimples: { id: c.itemOrdemProducaoId },
			itemFantasma: c.itemFantasma
		})),
		produziu: false,
		tipoApontamento: 0,
		observacao: p.observacao ?? "",
		taraPorTipoMaterial: { id: null },
		quantidadePesada: 0,
		taraMaterialTotal: 0,
		quantidadeGanho: 0,
		classificacaoApontamento: { id: null },
		estoqueRemanejamento: { id: null },
		itemLote: {
			itemLoteEstoque: {
				estoque: {
					id: p.destino.estoqueId,
					descontaPendenciaProducao: false
				},
				itemLoteEstoqueLocacao: { locacao: { id: p.destino.locacaoId } }
			},
			numeroLoteFabricacao: "",
			dataFabricacao: null,
			dataValidade: null,
			estoque: { id: p.destino.estoqueId }
		},
		empenhar: true
	};
}
/** Data/hora no formato da tela, no fuso de São Paulo (o ERP não recebe fuso). */
function dataHoraLocal(instante) {
	const partes = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Sao_Paulo",
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit"
	}).formatToParts(instante);
	const g = (t) => partes.find((x) => x.type === t)?.value ?? "";
	return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
}
/** Meia-noite do dia local de `instante` (é o `dataInicio` quando o apontamento é o primeiro da OP). */
function inicioDoDia(instante) {
	return `${dataHoraLocal(instante).slice(0, 10)}T00:00:00`;
}
//#endregion
//#region src/modules/compels/domain/reconciliar.ts
/** Textos mostrados na tela de pendências. Em português claro, sem termo de API. */
const MENSAGEM_ERRO = {
	quantidade_invalida: "Quantidade da entrada inválida.",
	propriedade_nao_suportada: "OP com estoque que não é próprio (ex.: em terceiros). Faça a entrada à mão no Compels.",
	acima_da_op: "A entrada passa da quantidade da OP no Compels.",
	estorno_na_op: "A OP tem estorno ou cancelamento no Compels. Confira antes de reenviar.",
	abaixo_do_enviado: "Leitura inconsistente: o Compels mostra menos apontado do que já enviamos.",
	fora_do_esperado: "OP com apontamento fora do esperado no Compels. Confira antes de reenviar.",
	requisicao_fora_do_esperado: "OP com requisição fora do esperado no Compels (alguém requisitou à mão). Confira antes de reenviar.",
	sem_empenho: "OP sem empenho suficiente no Compels.",
	pendencia_no_erp: "Há pendência de material no Compels (falta saldo de componente). Resolva lá e reenvie."
};
function erro(codigo) {
	return {
		tipo: "erro",
		codigo,
		mensagem: MENSAGEM_ERRO[codigo]
	};
}
function decidirEntrada(estado, acumulado) {
	const anterior = q6(acumulado.anterior);
	const novo = q6(acumulado.novo);
	const quantidade = q6(novo - anterior);
	if (quantidade <= 0 || anterior < 0) return erro("quantidade_invalida");
	if (estado.tipoPropriedade !== 0) return erro("propriedade_nao_suportada");
	if (novo > estado.quantidadeOp) return erro("acima_da_op");
	if (estado.temEstorno) return erro("estorno_na_op");
	if (estado.apontada >= novo) return { tipo: "ja_enviada" };
	if (estado.apontada < anterior) return erro("abaixo_do_enviado");
	if (estado.apontada !== anterior) return erro("fora_do_esperado");
	if (estado.temPendencia) return erro("pendencia_no_erp");
	if (estado.empenhada < novo) return erro("sem_empenho");
	if (estado.requisitada === anterior) return {
		tipo: "enviar",
		requisitar: quantidade,
		apontar: quantidade
	};
	if (estado.requisitada === novo) return {
		tipo: "enviar",
		requisitar: 0,
		apontar: quantidade
	};
	return erro("requisicao_fora_do_esperado");
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
//#region src/modules/compels/application/enviar-entrada.ts
const recusa = (erro, tentarDeNovo = false) => ({
	tipo: "erro",
	erro,
	tentarDeNovo
});
function numeroDaOp(texto) {
	return /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : null;
}
function faltas(componentes) {
	return `Falta saldo de componente no Compels: ${componentes.map((c) => `${c.codigo} (precisa ${c.precisa}, tem ${c.tem})`).join("; ")}.`;
}
/** Conferências que não precisam da trava: a OP existe, é desta PMO, em UN e de estoque próprio. */
async function conferir(erp, e) {
	const numero = numeroDaOp(e.op);
	if (numero === null) return { erro: recusa(`OP "${e.op}" não é numérica; a integração só atende OP numérica. Faça a entrada à mão no Compels.`) };
	const op = await erp.buscarOp(numero);
	if (!op) return { erro: recusa(`OP ${numero} não encontrada no Compels.`) };
	if (op.codigoItem.trim().toUpperCase() !== e.pmo.trim().toUpperCase()) return { erro: recusa(`O produto da OP ${numero} no Compels (${op.codigoItem}) é diferente da PMO ${e.pmo}.`) };
	if (op.unidade !== "UN") return { erro: recusa(`Produto em ${op.unidade || "unidade desconhecida"}: a integração só atende UN. Faça a entrada à mão no Compels.`) };
	return { op };
}
/** Com a OP já conferida: lê o estado, decide, consulta os componentes e monta os corpos. Não grava. */
async function planejar(erp, op, e, opcoes) {
	const agora = (opcoes.agora ?? (() => /* @__PURE__ */ new Date()))();
	const novo = e.acumuladoAnterior + e.quantidade;
	const estado = estadoDaOp(await erp.lerOp(op));
	const decisao = decidirEntrada(estado, {
		anterior: e.acumuladoAnterior,
		novo
	});
	if (decisao.tipo === "erro") return recusa(decisao.mensagem, decisao.codigo === "sem_empenho" || decisao.codigo === "pendencia_no_erp");
	if (decisao.tipo === "ja_enviada") return { tipo: "ja_enviada" };
	let requisitar = null;
	if (decisao.requisitar > 0) {
		const componentes = await erp.consultarRequisicao(op, decisao.requisitar);
		const sem = componentes.filter((c) => !c.itemFantasma && c.saldo < c.quantidadeRequisitar).map((c) => ({
			codigo: c.codigo,
			precisa: c.quantidadeRequisitar,
			tem: c.saldo
		}));
		if (sem.length > 0) return recusa(faltas(sem), true);
		requisitar = corpoRequisicao({
			opId: op.id,
			tipoPropriedade: op.tipoPropriedade,
			quantidade: decisao.requisitar,
			componentes
		});
	}
	const componentes = await erp.consultarDisponibilidade(op, decisao.apontar);
	const sem = componentesSemSaldo(componentes).map((c) => ({
		codigo: c.codigo,
		precisa: c.quantidadeUtilizada,
		tem: c.saldoDisponivel
	}));
	if (sem.length > 0) return recusa(faltas(sem), true);
	const apontar = corpoApontamento({
		opId: op.id,
		produtoId: op.produtoId,
		quantidade: decisao.apontar,
		dataInicio: estado.inicioApontamento ?? inicioDoDia(agora),
		dataFim: dataHoraLocal(agora),
		componentes,
		destino: opcoes.destino,
		...e.marca ? { observacao: e.marca } : {}
	});
	return {
		tipo: "enviar",
		op,
		novoAcumulado: novo,
		requisitar,
		apontar
	};
}
function erroDeExcecao(e) {
	if (e instanceof RespostaInesperada) return {
		ok: false,
		erro: `${e.message} Confira o Compels antes de reenviar.`,
		tentarDeNovo: false
	};
	if (e instanceof ErroDeLogin) return {
		ok: false,
		erro: e.message,
		tentarDeNovo: true
	};
	return {
		ok: false,
		erro: `Erro ao falar com o Compels: ${e instanceof Error ? e.message : String(e)}`,
		tentarDeNovo: true
	};
}
/**
* ENSAIO: faz tudo menos gravar e menos pegar a trava. Devolve o plano com os corpos que SERIAM
* enviados, para conferir contra a captura da tela antes da primeira gravação real.
*/
async function ensaiarEntrada(erp, e, opcoes) {
	try {
		const c = await conferir(erp, e);
		if ("erro" in c) return c.erro;
		return await planejar(erp, c.op, e, opcoes);
	} catch (erro) {
		const r = erroDeExcecao(erro);
		return {
			tipo: "erro",
			erro: r.erro,
			tentarDeNovo: r.tentarDeNovo
		};
	}
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
function inteiroPositivo(valor, padrao, nome) {
	const texto = valor?.trim();
	if (!texto) return padrao;
	const n = Number(texto);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${nome} precisa ser um número inteiro positivo.`);
	return n;
}
function destinoDoAmbiente(env = process.env) {
	return {
		estoqueId: inteiroPositivo(env.COMPELS_ESTOQUE_ID, 217, "COMPELS_ESTOQUE_ID"),
		locacaoId: inteiroPositivo(env.COMPELS_LOCACAO_ID, 5314, "COMPELS_LOCACAO_ID")
	};
}
//#endregion
//#region tools/compels/ensaiar-entrada.ts
/**
* ENSAIO de uma entrada, SEM GRAVAR e SEM PEGAR A TRAVA: lê a OP no Compels, decide, consulta os
* componentes e mostra os corpos que SERIAM enviados no Requisitar e no Apontar.
*
* Uso: node tools/compels/ensaiar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE [ACUMULADO_ANTERIOR]
*   PMO = o código do produto, ou `-` para usar o que o Compels mostra na OP (a PMO é impressa).
*   ACUMULADO_ANTERIOR = peças desta OP já enviadas antes (padrão 0), ou `auto` para assumir que tudo
*   o que o Compels já mostra apontado foi enviado por nós (a quantidade apontada é impressa).
* Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias); COMPELS_EZPOINT_EMPRESA,
*   COMPELS_EZPOINT_URL, COMPELS_API_URL, COMPELS_ESTOQUE_ID, COMPELS_LOCACAO_ID (opcionais).
* Nunca imprime senha nem token. O custo dos componentes sai mascarado.
*
* O arquivo `.mjs` ao lado é GERADO a partir deste. Para gerar de novo:
*   npx esbuild tools/compels/ensaiar-entrada.ts --bundle --platform=node --format=esm --target=node20 \
*     --outfile=tools/compels/ensaiar-entrada.mjs
*/
const [numeroOp, pmo, quantidadeTexto, anteriorTexto] = process.argv.slice(2);
const quantidade = Number(quantidadeTexto);
const automatico = anteriorTexto === "auto";
let acumuladoAnterior = automatico ? 0 : Number(anteriorTexto ?? 0);
if (!numeroOp || !pmo || !(quantidade > 0) || !(acumuladoAnterior >= 0)) {
	console.log("uso: node tools/compels/ensaiar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE [ACUMULADO_ANTERIOR]");
	process.exit(1);
}
function mascarar(valor) {
	return JSON.parse(JSON.stringify(valor, (chave, v) => chave === "precoCusto" ? "[custo]" : v));
}
try {
	const cliente = new ClienteCompels(configDoAmbiente());
	let pmoUsada = pmo;
	if (pmo === "-" || automatico) {
		const op = /^\d+$/.test(numeroOp) ? await cliente.buscarOp(Number(numeroOp)) : null;
		if (!op) throw new Error(`OP ${numeroOp} não encontrada no Compels.`);
		if (pmo === "-") {
			pmoUsada = op.codigoItem;
			console.log(`PMO usada (lida do Compels): ${pmoUsada}`);
		}
		if (automatico) {
			acumuladoAnterior = estadoDaOp(await cliente.lerOp(op)).apontada;
			console.log(`Acumulado anterior assumido (apontado no Compels): ${acumuladoAnterior}`);
		}
	}
	const plano = await ensaiarEntrada(cliente, {
		pmo: pmoUsada,
		op: numeroOp,
		quantidade,
		acumuladoAnterior
	}, { destino: destinoDoAmbiente() });
	if (plano.tipo === "erro") console.log(`ENSAIO: a entrada NÃO seria enviada.\nMotivo: ${plano.erro}\nTentaria de novo: ${plano.tentarDeNovo ? "sim" : "não"}`);
	else if (plano.tipo === "ja_enviada") console.log("ENSAIO: o Compels já tem esta entrada; nada seria enviado.");
	else {
		console.log(`ENSAIO: seria enviada. OP ${plano.op.numero} (id ${plano.op.id}), produto ${plano.op.codigoItem}, novo acumulado ${plano.novoAcumulado}.`);
		console.log(plano.requisitar ? "\n--- Requisitar (requisicaoOrdemProducao/save) ---" : "\n--- Requisitar: não precisa (a requisição desta entrada já existe) ---");
		if (plano.requisitar) console.log(JSON.stringify(mascarar(plano.requisitar), null, 1));
		console.log("\n--- Apontar (apontamentoOrdemProducao/save) ---");
		console.log(JSON.stringify(mascarar(plano.apontar), null, 1));
	}
	console.log("\nFIM: só leitura, nada foi gravado e a trava não foi pega.");
} catch (e) {
	console.log(`FALHOU: ${e instanceof Error ? e.message : "erro desconhecido"}`);
	process.exit(1);
}
//#endregion
export {};
