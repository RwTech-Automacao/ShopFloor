/* Google Apps Script: Código principal roteando por Cliente (sem Integração) */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || '';
  const file =
      page === 'pesquisa'   ? 'pesquisa'   :
      page === 'dashboard'  ? 'dashboard'  :
      page === 'manutencao' ? 'manutencao' :
      page === 'integracao' ? 'integracao' :
                              'formulario';

  const titleMap = {
    formulario: 'Lançamento • ShopFloor',
    integracao: 'Integração • ShopFloor',
    manutencao: 'Manutenção • ShopFloor',
    dashboard : 'Dashboard • ShopFloor',
    pesquisa  : 'Pesquisa • ShopFloor'
  };

  return HtmlService
    .createHtmlOutputFromFile(file)
    .setTitle(titleMap[file] || 'ShopFloor')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}



/* =========================
   Constantes / Cabeçalhos
   ========================= */

const HEADERS = [
  'Data/Hora','Colaborador','Posto','PMO','OP','Nº Caixa','QTD por caixa',
  'Status','Nº de Série','Código do Defeito','Posição','Tipo',
  'Inspeção Visual NQA','Inspeção Funcional NQA',
  'ID Integração',
  'Reparo - Conserto',             // P (index 15)
  'Reparo - Posição',              // Q (index 16)
  'Posto de Origem',               // R (index 17) — posto em que a PCI reprovou
  'Data/Hora de Origem'            // S (index 18) — timestamp da reprova que originou o reparo
];



/* =========================
   Helpers de Sheet por Cliente
   ========================= */

/** Retorna o nome do cliente (coluna F = index 5) para a PMO/OP. */
function getClienteByPMO_OP(pmo, op, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  const sh = ss.getSheetByName('PMO_OPS');
  const rows = sh.getDataRange().getValues(); // com cabeçalho
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0] || '').toString().trim() === pmo &&
        (rows[i][1] || '').toString().trim() === op) {
      const cliente = (rows[i][5] || '').toString().trim();
      if (!cliente) throw new Error('Cliente não definido para esta PMO/OP (PMO_OPS coluna F).');
      return cliente;
    }
  }
  throw new Error('PMO/OP não encontrada na PMO_OPS.');
}

/**
 * Módulo profundo: lê a linha da OP em PMO_OPS UMA ÚNICA VEZ e devolve toda a
 * config que o submit precisa — { cliente, snIni, snFim, aplicabilidade }.
 * Concentra o que antes eram 3 leituras da aba por submit
 * (getClienteByPMO_OP + validarNumeroSeriePorIntervalo + obterAplicabilidadePostos).
 * Lança os mesmos erros de hoje: OP inexistente, cliente ausente, faixa não configurada.
 * As funções públicas acima continuam existindo como wrappers para dashboard/pesquisa/etc.
 */
function getOPConfig(pmo, op, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  const alvoPMO = (pmo || '').toString().trim();
  const alvoOP  = (op  || '').toString().trim();

  const sh   = ss.getSheetByName('PMO_OPS');
  const rows = sh.getDataRange().getValues(); // com cabeçalho — leitura única

  let linha = null;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0] || '').toString().trim() === alvoPMO &&
        (rows[i][1] || '').toString().trim() === alvoOP) {
      linha = rows[i];
      break;
    }
  }
  if (!linha) throw new Error('PMO/OP não encontrada na PMO_OPS.');

  const cliente = (linha[5] || '').toString().trim(); // F
  if (!cliente) throw new Error('Cliente não definido para esta PMO/OP (PMO_OPS coluna F).');

  const snIni = (linha[7] || '').toString().trim(); // H
  const snFim = (linha[8] || '').toString().trim(); // I
  if (!snIni || !snFim) throw new Error('Intervalo de SN não configurado para esta OP.');

  return { cliente, snIni, snFim, aplicabilidade: _aplicabilidadeFromRow_(linha) };
}

/** Sanitiza nome de aba para o Google Sheets. */
function sanitizeSheetName(name) {
  let s = (name || '').toString().trim();
  s = s.replace(/[\[\]\:\?\/\\\*]/g, ' ');
  if (s.length > 99) s = s.slice(0, 99);
  if (!s) s = 'Cliente';
  return s;
}

/** Cria (se precisar) e retorna a aba do cliente, com cabeçalho garantido. */
function getOrCreateClientSheet(cliente, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  const name = sanitizeSheetName(cliente);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // só cria o cabeçalho em abas novas
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Lista abas de clientes; por padrão NÃO inclui "Registros" (legado). */
function listClientSheets(ss = SpreadsheetApp.getActiveSpreadsheet(), includeLegacy = false) {
  const shP = ss.getSheetByName('PMO_OPS');
  const rows = shP.getDataRange().getValues().slice(1);
  const clienteSet = new Set(rows.map(r => (r[5] || '').toString().trim()).filter(Boolean));
  const names = new Set(); // sem 'Registros' por padrão
  if (includeLegacy) names.add('Registros');
  clienteSet.forEach(c => names.add(sanitizeSheetName(c)));
  const all = ss.getSheets().map(s => s.getName());
  return Array.from(names).filter(n => all.includes(n)).map(n => ss.getSheetByName(n));
}


/* =========================
   Helpers de SN
   ========================= */

/** Normaliza SN para COMPARAÇÃO (equivalência) */
function normalizeSN(sn) {
  return (sn || '')
    .toString()
    .replace(/[^A-Za-z0-9]/g, '')
    .replace(/^0+/, '')
    .trim()
    .toLowerCase();
}

/** Limpa SN para SALVAR (mantém zeros à esquerda) */
function cleanSNKeepLeadingZeros(sn) {
  return (sn || '')
    .toString()
    .replace(/[^A-Za-z0-9]/g, '')
    .trim();
}

/**
 * Parser canônico de Nº de Série (ver CONTEXT.md: Nº de Série / Faixa de SN).
 * Trata o SN (remove separadores) e o interpreta como [letras?][dígitos][letras?]:
 * um único bloco contíguo de dígitos, com letras opcionais antes (prefix) e depois (suffix).
 * Apenas o bloco de dígitos incrementa numa faixa. `num` é NaN quando não há bloco numérico
 * (ou quando há mais de um grupo de dígitos, ex.: "12AB34", fora do escopo suportado).
 * `width` é a quantidade de dígitos do bloco (para reconstrução com zero-padding).
 */
function parseSNParts(sn) {
  const cleaned = (sn || '').toString().replace(/[^A-Za-z0-9]/g, '').trim();
  const m = cleaned.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if (!m) return { cleaned, prefix: '', num: NaN, suffix: '', width: 0 };
  return {
    cleaned,
    prefix: m[1],
    num: parseInt(m[2], 10),
    suffix: m[3],
    width: m[2].length
  };
}

/* =========================
   Validação por intervalo H..I
   ========================= */

/**
 * Comparação pura de faixa de SN: numérica quando início/fim/alvo têm bloco de
 * dígitos, senão comparação lexical. Não lê planilha. Prefixo e sufixo fazem
 * parte da identidade da peça: o alvo precisa casar prefixo E sufixo da faixa
 * (ignorando caixa) antes da comparação do número — sufixo divergente ou ausente
 * fica fora da faixa. Reusada por validarNumeroSeriePorIntervalo (wrapper público)
 * e pelo submit, que já tem snIni/snFim de getOPConfig e não precisa reler a aba.
 */
function snDentroDoIntervalo_(snIni, snFim, numeroSerie) {
  const a = parseSNParts(snIni);
  const b = parseSNParts(snFim);
  const x = parseSNParts(numeroSerie);

  if (!isNaN(a.num) && !isNaN(b.num) && !isNaN(x.num)) {
    const lc = s => (s || '').toLowerCase();
    // Faixa mal configurada (H/I com prefixo/sufixo divergentes) → fora da faixa.
    if (lc(a.prefix) !== lc(b.prefix) || lc(a.suffix) !== lc(b.suffix)) return false;
    // Alvo precisa pertencer à mesma família (mesmo prefixo e sufixo da faixa).
    if (lc(x.prefix) !== lc(a.prefix) || lc(x.suffix) !== lc(a.suffix)) return false;
    const min = Math.min(a.num, b.num);
    const max = Math.max(a.num, b.num);
    return x.num >= min && x.num <= max;
  }

  const s1 = a.cleaned, s2 = b.cleaned, sx = x.cleaned;
  const lo = s1 < s2 ? s1 : s2;
  const hi = s1 > s2 ? s1 : s2;
  return sx >= lo && sx <= hi;
}

function validarNumeroSeriePorIntervalo(pmo, op, numeroSerie) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PMO_OPS');
  const dados = sh.getDataRange().getValues(); // inclui header
  let linha = null;
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] == pmo && dados[i][1] == op) { linha = dados[i]; break; }
  }
  if (!linha) throw new Error(`PMO/OP não encontrada na aba PMO_OPS.`);
  const snInicio = (linha[7] || '').toString().trim(); // H
  const snFim    = (linha[8] || '').toString().trim(); // I
  if (!snInicio || !snFim) throw new Error(`Intervalo de SN não configurado para esta OP.`);

  return snDentroDoIntervalo_(snInicio, snFim, numeroSerie);
}

/* =========================
   Envio (roteando por cliente)
   ========================= */

/**
 * Núcleo do envio: grava o registro e devolve { message, qtdCaixa }.
 * qtdCaixa é a contagem de peças na caixa APÓS este envio (só para Embalagem;
 * null nos demais postos), derivada da MESMA leitura da aba usada na checagem de
 * limite — evita a 2ª leitura/flush que o caminho de Embalagem fazia (PRD-004 issue 0003).
 * O wrapper público enviarFormulario devolve apenas a string message.
 */
function _enviarFormularioComContagem_(dados, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  // Instrumentação de tempo por fase (PRD-004, issue 0005). Só mede os passos
  // já existentes: não altera comportamento, retorno, nem lê a planilha a mais.
  const tmr = _phaseTimer_();
  let pecasNaCaixaAntes = null; // peças já na caixa antes deste envio (Embalagem)

  // ===== FORA DO LOCK (PRD-004 issue 0004) =====
  // Config da OP e validação de campos/faixa NÃO dependem da aba de registros:
  // rodam antes de adquirir o lock, então um erro aqui falha cedo, sem segurar o recurso.

  // Config da OP em UMA leitura de PMO_OPS: cliente + faixa de SN + aplicabilidade
  const opConfig = getOPConfig((dados.pmo||'').trim(), (dados.op||'').trim(), ss);
  const cliente  = opConfig.cliente;

  // Normalização e limpeza
  const colaborador = (dados.colaborador || '').trim();
  const postoRaw    = (dados.posto || '').trim();
  const posto       = postoRaw.toLowerCase();
  const pmo         = (dados.pmo || '').trim();
  const op          = (dados.op || '').trim();

  const numeroSerieDigitado   = (dados.numeroSerie || '').toString().trim();
  const numeroSerieParaSalvar = cleanSNKeepLeadingZeros(numeroSerieDigitado);
  const snClean               = normalizeSN(numeroSerieDigitado);

  const statusRaw   = (dados.status || '').trim();
  const statusNorm  = statusRaw.toLowerCase();
  const numeroCaixa = (dados.numeroCaixa || '').trim();
  const limiteRaw   = String(dados.limiteCaixa || '').trim();
  const limiteCaixa = limiteRaw ? parseInt(limiteRaw, 10) : null;
  const nqiVis      = (dados.nqaVisualStatus || '').trim();
  const nqiFunc     = (dados.nqaFuncionalStatus || '').trim();
  const cod         = (dados.cod || '').trim();
  const posicoes    = dados.pos ? dados.pos.split(',').map(p => p.trim()) : [];
  const tipo        = (dados.tipo || '').trim();

  // Validação por posto
  if (posto === 'inicial') {
    if (!colaborador || !posto || !pmo || !op || !numeroSerieParaSalvar) {
      throw new Error('Para Inicial, preencha: Colaborador, Posto, PMO, OP e Nº de Série.');
    }
  } else if (posto === 'montagem pth') {
    if (!colaborador || !posto || !pmo || !op || !numeroSerieParaSalvar) {
      throw new Error('Para Montagem PTH, preencha: Colaborador, Posto, PMO, OP e Nº de Série.');
    }
  } else if (posto === 'embalagem') {
    if (!colaborador || !posto || !pmo || !op || !numeroCaixa || !limiteRaw || !numeroSerieParaSalvar) {
      throw new Error('Para Embalagem, preencha: Colaborador, Posto, PMO, OP, Nº da Caixa, QTD por caixa e Nº de Série.');
    }
  } else if (posto === 'inspeção nqa') {
    if (!colaborador || !posto || !pmo || !op || !numeroSerieParaSalvar || !nqiVis || !nqiFunc) {
      throw new Error('Para Inspeção NQA, preencha: Colaborador, Posto, PMO, OP, Nº de Série, Inspeção Visual e Inspeção Funcional.');
    }
  } else if (posto === 'inspeção spi') {
    if (!colaborador || !posto || !pmo || !op || !numeroSerieParaSalvar || !statusRaw) {
      throw new Error('Para Inspeção SPI, preencha: Colaborador, Posto, PMO, OP, Nº de Série e Status.');
    }
    // Na reprova da SPI só a posição é obrigatória (sem código nem tipo).
    if (statusNorm === 'reprovado' && !posicoes.length) {
      throw new Error('Para Inspeção SPI reprovada, informe ao menos uma posição.');
    }
  } else {
    if (!colaborador || !posto || !pmo || !op || !numeroSerieParaSalvar || !statusRaw) {
      throw new Error('Preencha todos os campos obrigatórios: Colaborador, Posto, PMO, OP, Nº de Série e Status.');
    }
    if (statusNorm === 'reprovado' && (!cod || !posicoes.length || !tipo)) {
      throw new Error('Para produtos reprovados, preencha os campos de defeito (cód., posição, tipo).');
    }
  }

  // Valida SN pelo intervalo H..I (reusa snIni/snFim já lidos em getOPConfig)
  if (!snDentroDoIntervalo_(opConfig.snIni, opConfig.snFim, numeroSerieParaSalvar)) {
    throw new Error('Número de série inválido para esta OP.');
  }
  tmr.mark('configOP'); // config da OP + faixa de SN (fora do lock)

  // ===== SEÇÃO CRÍTICA sob o document lock (PRD-004 issue 0004) =====
  // ler-aba-do-cliente -> snapshot -> checar duplicado/posto-anterior -> gravar (+ espelho).
  // A garantia de zero duplicados vem de ler->checar->gravar acontecer todo aqui dentro,
  // sem janela para corrida entre envios concorrentes.
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sheet = getOrCreateClientSheet(cliente, ss);

    // Carrega registros atuais da aba do cliente
    const rawData = sheet.getDataRange().getValues().slice(1);
    const registros = rawData.map(r => ({
      serie: normalizeSN(r[8]),
      posto: (r[2] || '').toString().trim().toLowerCase(),
      status: (r[7] || '').toString().trim().toLowerCase(),
      vis: (r[12] || '').toString().trim().toLowerCase(),
      func: (r[13] || '').toString().trim().toLowerCase(),
      caixa: (r[5] || '').toString().trim(),
      pmo: (r[3] || '').toString().trim(),
      op:  (r[4] || '').toString().trim()
    }));
    tmr.mark('lerAba'); // aquisição do lock + leitura da aba do cliente + normalização

    // Bloqueio de sequência: exige o posto anterior aplicável concluído.
    // Regra AUTORITATIVA (servidor), montada a partir dos registros recém-lidos da planilha.
    const snapAtual = { postos: {} };
    registros.forEach(r => {
      if (r.pmo !== pmo || r.op !== op) return;
      if (r.serie !== snClean) return;
      const p = r.posto;
      if (!snapAtual.postos[p]) snapAtual.postos[p] = {};
      if (p === 'inicial' || p === 'montagem pth' || p === 'integração' || p === 'integracao' || p === 'embalagem') {
        snapAtual.postos[p].registrado = true;
      } else if (p === 'inspeção nqa' || p === 'inspecao nqa') {
        const okNQA = (r.vis === 'aprovado') &&
                      (r.func === 'aprovado' || r.func === 'nao aplicavel' || r.func === 'não aplicável');
        snapAtual.postos[p].aprovado = okNQA;
        snapAtual.postos[p].registrado = true;
      } else {
        if (r.status === 'aprovado') snapAtual.postos[p].aprovado = true;
        snapAtual.postos[p].registrado = true;
      }
    });

    const aplicEnvio = opConfig.aplicabilidade || {};
    const postoAnteriorExigido = getPrevGateForPosto(postoRaw, aplicEnvio);
    if (postoAnteriorExigido && !isPrevGateSatisfied(postoAnteriorExigido, snapAtual)) {
      throw new Error(`Posto anterior obrigatório não concluído: ${postoAnteriorExigido}.`);
    }

    // Duplicidade (só dentro da própria aba do cliente)
    const isDuplicado = registros.some(r => {
      if (r.pmo !== pmo || r.op !== op) return false; // só considera mesma OP
      if (posto === 'inicial') {
        return r.serie === snClean && r.posto === 'inicial';
      }
      if (posto === 'montagem pth') {
        return r.serie === snClean && r.posto === 'montagem pth';
      }
      if (posto === 'embalagem') {
        return r.serie === snClean && r.posto === 'embalagem';
      }
      if (posto === 'inspeção nqa') {
        return r.serie === snClean && r.posto === 'inspeção nqa' &&
               r.vis === (nqiVis || '').toLowerCase() &&
               r.func === (nqiFunc || '').toLowerCase();
      }
      return r.serie === snClean && r.posto === posto &&
             statusNorm === 'aprovado' && r.status === 'aprovado';
    });

    if (isDuplicado) {
      if (posto === 'inicial') throw new Error('Número de série já iniciado nesta OP.');
      if (posto === 'montagem pth') throw new Error('Número de série já registrado na Montagem PTH desta OP.');
      if (posto === 'embalagem') throw new Error('Número de série já registrado em Embalagem.');
      throw new Error('Número de série já registrado para este posto com status aprovado.');
    }

    // Limite da caixa (Emb.)
    if (posto === 'embalagem') {
      const norm = s => _norm(s);
      const alvoPMO = pmo, alvoOP = op, alvoCaixa = norm(numeroCaixa);

      const currentCount = rawData.reduce((acc, r) => {
        const postoPlanilha = norm(r[2]);
        const pmoLin = (r[3] || '').toString().trim();
        const opLin  = (r[4] || '').toString().trim();
        const caixaLin = norm(r[5]);
        return (pmoLin === alvoPMO && opLin === alvoOP && postoPlanilha === 'embalagem' && caixaLin === alvoCaixa)
          ? acc + 1 : acc;
      }, 0);

      if (limiteCaixa !== null && !isNaN(limiteCaixa) && currentCount >= limiteCaixa) {
        throw new Error(`A caixa ${numeroCaixa} já está completa (${limiteCaixa} peças).`);
      }

      pecasNaCaixaAntes = currentCount; // reaproveitado p/ devolver a contagem sem reler a aba
    }
    tmr.mark('checagens'); // posto anterior + duplicado + limite de caixa

    // Timestamp
    const agora = new Date();
    const dataHora = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');

    // Formata status visual
    const statusCap = (posto === 'inicial' || posto === 'montagem pth' || posto === 'embalagem' || posto === 'inspeção nqa')
      ? '' : statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1).toLowerCase();

    // Monta linha(s)
    const rows = [];
    if (statusNorm === 'reprovado' && posicoes.length > 1) {
      posicoes.forEach(p =>
        rows.push([dataHora, colaborador, postoRaw, pmo, op, numeroCaixa, limiteRaw,
                   statusCap, numeroSerieParaSalvar, cod, p, tipo, nqiVis, nqiFunc]));
    } else {
      rows.push([dataHora, colaborador, postoRaw, pmo, op, numeroCaixa, limiteRaw,
                 statusCap, numeroSerieParaSalvar, cod, (posicoes[0] || ''), tipo, nqiVis, nqiFunc]);
    }

    // Append
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

    // ESPELHO em "Registros" (apenas para indicadores, não usado em buscas)
    try {
      appendToRegistros(rows, ss);
    } catch (e) {
      Logger.log('Falha ao espelhar em Registros: ' + e);
    }
    tmr.mark('escrita'); // append na aba do cliente + espelho em Registros

    // Contagem da caixa APÓS este envio, da mesma leitura (sem reler a aba):
    // peças que já existiam + linhas gravadas agora para esta caixa.
    const qtdCaixa = (posto === 'embalagem') ? (pecasNaCaixaAntes + rows.length) : null;

    return {
      message: `Registro enviado com sucesso!\nCliente: ${cliente}\nNº de Série: ${numeroSerieParaSalvar}\nPosto: ${postoRaw}`,
      qtdCaixa
    };
  } finally {
    tmr.log('[enviarFormulario] tempo por fase'); // visível no painel de Execuções
    lock.releaseLock();
  }
}

/** Wrapper público: mantém o contrato de STRING usado pelo front e demais telas. */
function enviarFormulario(dados, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  return _enviarFormularioComContagem_(dados, ss).message;
}


/**
 * Cronômetro leve por fase para instrumentação (PRD-004, issue 0005).
 * Acumula a duração de cada fase em ms e emite uma única linha no Logger,
 * que aparece no painel de Execuções do Apps Script. Não faz I/O de planilha.
 * Uso: const t = _phaseTimer_(); ...; t.mark('fase'); ...; t.log('prefixo');
 */
function _phaseTimer_(){
  let last  = Date.now();
  const t0  = last;
  const marks = [];
  return {
    mark(label){
      const now = Date.now();
      marks.push(label + '=' + (now - last) + 'ms');
      last = now;
    },
    log(prefix){
      marks.push('total=' + (Date.now() - t0) + 'ms');
      Logger.log(prefix + ' | ' + marks.join(' | '));
    }
  };
}


/* =========================
   Cadeia de postos & requisito do posto anterior
   ========================= */

/** Ordem lógica padrão de fluxo. Ajuste se precisar. */
const POSTO_FLOW_ORDER = [
  'Inicial',
  'Inspeção SPI',
  'Inspeção SMD',
  'Montagem PTH',
  'Inspeção PTH',
  'Teste',
  'Integração',
  'Teste Final',
  'Inspeção Final',
  'Embalagem',
  'Inspeção NQA',
  'Manutenção' // fora do fluxo principal, não exige anterior
];

/** Dado o posto atual e a aplicabilidade (PMO_OPS), retorna qual "gate" anterior exigir. */
function getPrevGateForPosto(postoAtual, aplicMap){
  // Manutenção não exige cadeia anterior
  if (/^manuten[çc][aã]o$/i.test(postoAtual)) return null;

  // Mapeia fallback quando um posto anterior não é aplicável
  const seq = POSTO_FLOW_ORDER;
  const idx = seq.findIndex(p => p.toLowerCase() === (postoAtual||'').toLowerCase());
  if (idx <= 0) return null; // primeiro da cadeia

  // Caminha para trás até achar o anterior aplicável
  for (let j = idx - 1; j >= 0; j--){
    const cand = seq[j];
    if (cand === 'Manutenção') continue;
    if (!aplicMap || aplicMap[cand] !== false) return cand;
  }
  return null;
}

/** Define a condição de "OK" do posto anterior (Aprovado/Registrado conforme tipo). */
function isPrevGateSatisfied(prevPosto, snapshot){
  // snapshot = objeto por SN com flags por posto já encontrados
  // Para 'Integração' e 'Embalagem', basta "registrado" (existência do log)
  const key = prevPosto.toLowerCase();
  const flags = snapshot && snapshot.postos ? snapshot.postos : {};

  if (key === 'inicial' || key === 'montagem pth' || key === 'integração' || key === 'integracao' || key === 'embalagem'){
    return !!flags[key]?.registrado;
  }

  if (key === 'inspeção nqa' || key === 'inspecao nqa'){
    return flags[key]?.aprovado === true; // NQA aprovado (regra já calculada no snapshot)
  }

  // Demais postos pedem "Aprovado"
  return flags[key]?.aprovado === true;
}

/* =========================
   Contagem de peças (por cliente)
   ========================= */

/** Normalização genérica p/ comparações de texto */
function _norm(s) {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** OP iguais se string igual OU se números iguais (ex.: "7891" == 7891) */
function _sameOP(opA, opB) {
  const a = (opA || '').toString().trim();
  const b = (opB || '').toString().trim();
  if (a === b) return true;
  const an = Number(a), bn = Number(b);
  return !isNaN(an) && !isNaN(bn) && an === bn;
}

/* ---- helpers de cabeçalho ---- */
function _buildHeaderIndex_(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i++) {
    map[_norm(headerRow[i])] = i;
  }
  return map;
}
function _pickIdx_(idxMap, candidates) {
  for (const name of candidates) {
    const k = _norm(name);
    if (k in idxMap) return idxMap[k];
  }
  return -1;
}

function contarPecasNaCaixaCliente(caixaParam, pmo, op, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  if (!caixaParam) throw new Error('Falha ao contar: nº da caixa vazio.');
  if (!pmo || !op) throw new Error('Falha ao contar: PMO/OP ausentes.');

  // resolve a aba do cliente a partir da PMO/OP
  const cliente = getClienteByPMO_OP(pmo, op, ss);
  const sh = getOrCreateClientSheet(cliente, ss);

  const vals = sh.getDataRange().getValues();
  if (!vals || vals.length < 2) return 0;

  const header = vals[0];
  const idxMap = _buildHeaderIndex_(header);

  // índices (pelo nome do cabeçalho que você me enviou)
  const iPosto = _pickIdx_(idxMap, ['Posto']);
  const iPMO   = _pickIdx_(idxMap, ['PMO']);
  const iOP    = _pickIdx_(idxMap, ['OP']);
  const iCaixa = _pickIdx_(idxMap, [
    'Nº Caixa','N° Caixa','No Caixa','Nº da Caixa','N° da Caixa',
    'Numero da Caixa','Número da Caixa','Numero Caixa','Número Caixa'
  ]);

  if (iPosto < 0 || iPMO < 0 || iOP < 0 || iCaixa < 0) {
    throw new Error('Falha ao contar: cabeçalho esperado não encontrado na aba do cliente.');
  }

  const alvoPMO   = _norm(pmo);
  const alvoCaixa = _norm(caixaParam);

  let total = 0;
  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    if (!row || row.length <= iCaixa) continue;

    // filtro estrito:
    const postoLin = _norm(row[iPosto]);
    if (postoLin !== 'embalagem') continue;

    const pmoLin = _norm(row[iPMO]);
    if (pmoLin !== alvoPMO) continue;

    if (!_sameOP(row[iOP], op)) continue;

    const caixaLin = _norm(row[iCaixa]);
    if (caixaLin !== alvoCaixa) continue;

    total++;
  }

  return total;
}


function enviarRelatorioEContarPecasNaCaixa(dados, caixaParam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Grava e já obtém a contagem da caixa da MESMA leitura da aba, sob o lock do
  // documento — sem 2ª leitura via contarPecasNaCaixaCliente nem flush só p/ contar
  // (PRD-004 issue 0003). O ler→checar→gravar sob o lock garante consistência.
  // caixaParam é mantido por compatibilidade da assinatura; a caixa vem de dados.numeroCaixa.
  const { message, qtdCaixa } = _enviarFormularioComContagem_(dados, ss);

  return { message, qtd: qtdCaixa };
}



/* =========================
   Catálogos e mapeamentos
   ========================= */

function obterDefeitos() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Defeitos')
    .getRange('A2:A').getValues().flat().filter(Boolean);
}

function obterDefeitosPorTipo(tipo) {
  // Planilha "Defeitos": Coluna A = descrição, Coluna B = tipo (1 ou 2)
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Defeitos');
  const vals = sh.getDataRange().getValues(); // inclui cabeçalho
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    const nome = (vals[i][0] || '').toString().trim();
    const t    = (vals[i][1] || '').toString().trim();
    if (!nome) continue;
    if (String(t) === String(tipo)) out.push(nome);
  }
  return out;
}

function obterPMO_OPS() {
  const dados = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PMO_OPS')
    .getDataRange().getValues().slice(1);
  return dados.reduce((mapa, [p, o]) => { mapa[p] = mapa[p] || []; mapa[p].push(o); return mapa; }, {});
}

function buscarPMO_OP(pmo, op) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PMO_OPS");
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] == pmo && dados[i][1] == op) {
      return {
        quantidade: dados[i][2]||"",
        descricao : dados[i][3]||"",
        acp       : dados[i][4]||"",
        cliente   : dados[i][5]||""
      };
    }
  }
  return null;
}

/* =========================
   Grade Geral (por cliente)
   ========================= */

function gerarTabelaGeral(pmo, op, caixaFiltro) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const pm  = ss.getSheetByName("PMO_OPS").getDataRange().getValues(); // header incluso

  // Localiza linha PMO/OP e cliente
  let row = null;
  for (let i = 1; i < pm.length; i++) {
    if ((pm[i][0] || '').toString().trim() === pmo && (pm[i][1] || '').toString().trim() === op) { row = pm[i]; break; }
  }
  if (!row) throw new Error(`PMO/OP não encontrada: ${pmo} / ${op}.`);
  const cliente = (row[5] || '').toString().trim();
  const regSh   = getOrCreateClientSheet(cliente, ss);
  const reg     = regSh.getDataRange().getValues();

  // SN H/I
  const snIniRaw = (row[7] || '').toString().trim();
  const snFimRaw = (row[8] || '').toString().trim();

  if (!snIniRaw || !snFimRaw) throw new Error('SN inicial/final (H/I) não configurados.');
  const a = parseSNParts(snIniRaw);
  const b = parseSNParts(snFimRaw);
  if (isNaN(a.num) || isNaN(b.num)) throw new Error('SN inicial/final sem bloco numérico em H/I.');
  // Prefixo e sufixo são constantes na faixa; só o bloco de dígitos varia (case-insensitive).
  if (a.prefix.toLowerCase() !== b.prefix.toLowerCase() ||
      a.suffix.toLowerCase() !== b.suffix.toLowerCase()) {
    throw new Error('Prefixo/sufixo diferentes entre H e I.');
  }
  const prefix = a.prefix, suffix = a.suffix;
  const start = Math.min(a.num, b.num), end = Math.max(a.num, b.num), width = Math.max(a.width, b.width);

  const lista = [];
  for (let n = start; n <= end; n++) lista.push(prefix + String(n).padStart(width, '0') + suffix);

  /**
   * Resolve o slot da grade para um SN registrado: casa pelo bloco de dígitos
   * dentro do prefixo/sufixo conhecido da OP (ignorando caixa e separadores).
   * Retorna a chave canônica do `mapa` ou null quando o prefixo/sufixo divergem
   * da OP ou o número está fora da faixa — nesses casos a linha é descartada.
   */
  function slotDaLinha(rawSN) {
    const p = parseSNParts(rawSN);
    if (isNaN(p.num)) return null;
    if (p.prefix.toLowerCase() !== prefix.toLowerCase()) return null;
    if (p.suffix.toLowerCase() !== suffix.toLowerCase()) return null;
    const candidate = prefix + String(p.num).padStart(width, '0') + suffix;
    return mapa[candidate] ? candidate : null;
  }

  // >>> Integração entre Teste e Teste Final
  const postos = ["Inicial","Inspeção SPI","Inspeção SMD","Montagem PTH","Inspeção PTH","Teste","Integração","Teste Final","Inspeção Final","Embalagem","Inspeção NQA","Manutenção"];

  // Aplicabilidade J..Q
  function yes(v){ const s=(v||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    return ['sim','s','yes','y','1','true','x'].includes(s);
  }
  const aplic = {
    'Inicial'       : yes(row[17]), 'Inspeção SPI'  : yes(row[18]),
    'Inspeção SMD'  : yes(row[9]),  'Montagem PTH'  : yes(row[19]),
    'Inspeção PTH'  : yes(row[10]),
    'Teste'         : yes(row[11]), 'Teste Final'   : yes(row[12]),
    'Inspeção Final': yes(row[13]), 'Embalagem'     : yes(row[14]),
    'Inspeção NQA'  : yes(row[15]), 'Integração'    : yes(row[16])
    // Manutenção: situacional → não entra aqui
  };

   // Inicializa tudo como pendente/NA conforme aplicabilidade…
  const mapa = {};
  lista.forEach(sn => {
    mapa[sn] = {};
    postos.forEach(p => { mapa[sn][p] = (p in aplic) ? (aplic[p] ? 'Pendente' : 'Não aplicável') : '—'; });
    // “—” = sem ocorrência para Manutenção
  });

// Preenche a partir das abas do cliente
  reg.slice(1).forEach(l => {
    const postoR = (l[2] || '').toString().trim();
    const pmoR   = (l[3] || '').toString().trim();
    const opR    = (l[4] || '').toString().trim();
    const stat   = (l[7] || '').toString().trim();
    const rawSN  = (l[8] || '').toString();
    const vis    = (l[12] || '').toString();
    const func   = (l[13] || '').toString();
    if (pmoR !== pmo || opR !== op) return;

    const key = slotDaLinha(rawSN);
    if (!key) return;

    if (/^manuten[çc][aã]o$/i.test(postoR)) {
      // Manutenção é situacional: marca apenas quando há conserto
      mapa[key]['Manutenção'] = 'Concluído';
      return;
    }

    // Inicial: log puro (sem status) → "Registrado" quando há log
    if (postoR === 'Inicial') {
      if (aplic['Inicial']) {
        mapa[key]['Inicial'] = 'Registrado';
      }
      return;
    }

    // Montagem PTH: log puro (sem status) → "Registrado" quando há log
    if (postoR === 'Montagem PTH') {
      if (aplic['Montagem PTH']) {
        mapa[key]['Montagem PTH'] = 'Registrado';
      }
      return;
    }

    // >>> NOVO: Integração via ABA DO CLIENTE
  if (postoR === 'Integração' || postoR === 'Integracao') {
    if (aplic['Integração']) {
      mapa[key]['Integração'] = 'Registrado';
    }
    return;
  }

    if (!(postoR in aplic) || !aplic[postoR]) return; // não sobrescreve NA

    if (postoR === 'Inspeção NQA') {
      const v = vis.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const f = func.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      mapa[key][postoR] = (v === 'aprovado' && (f === 'aprovado' || f === 'nao aplicavel' || f === 'não aplicável'))
        ? 'Aprovado' : 'Reprovado';
    } else if (postoR === 'Embalagem') {
      // coloca o NOME DA CAIXA; vazio mantém “Pendente”
      const caixaTxt = (l[5] || '').toString().trim();
      if (caixaTxt) mapa[key][postoR] = caixaTxt;
    } else {
      const atual = mapa[key][postoR];
      if (stat === 'Aprovado') mapa[key][postoR] = 'Aprovado';
      else if (stat === 'Reprovado' && atual !== 'Aprovado') mapa[key][postoR] = 'Reprovado';
    }
  });

  // Integração via HDR (só se aplicável)
  try {
    const sh = ss.getSheetByName(INTEG_HDR_SHEET);
    if (sh && aplic['Integração']) {
      const vals = sh.getDataRange().getValues();
      const ix = vals[0].reduce((m,h,i)=> (m[h]=i, m), {});
      for (let r=1; r<vals.length; r++) {
        const linha = vals[r];
        if ((linha[ix['PMO']]||'') !== pmo || (linha[ix['OP']]||'') !== op) continue;
        if ((linha[ix['Status']]||'') !== 'ATIVO') continue;
        const rawSN = (linha[ix['ProdutoSN']]||'').toString();
        const key = slotDaLinha(rawSN);
        if (key && mapa[key]['Integração'] === 'Pendente') {
         mapa[key]['Integração'] = 'Registrado';
       }
      }
    }
  } catch(e){ Logger.log('Integração (mapa): '+e); }

   // Filtro opcional por caixa
  const filtro = _norm(caixaFiltro || '');
  const listaFinal = filtro ? lista.filter(sn => _norm(mapa[sn]['Embalagem'] || '') === filtro) : lista;

  return listaFinal.map(sn => {
    const obj = { sn };
    postos.forEach(p => obj[p] = mapa[sn][p]);
    return obj;
  });
}


/* =========================
   Busca detalhada por SN (todas as abas de clientes)
   ========================= */

function buscarDetalhadoPorNumeroSerie(snBusca) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alvo = normalizeSN(snBusca);
  const sheets = listClientSheets(ss, /* includeLegacy */ false);
  const out = [];

  sheets.forEach(sh => {
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      if (!r || r.length < 9) continue;
      const comp = normalizeSN(r[8]);
      if (comp === alvo) {
        out.push({
          dataHora: Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"),
          colaborador: r[1]||"",
          posto: r[2]||"",
          status: r[7]||"",
          numeroCaixa: r[5]||"",
          numeroSerie: r[8]||"",
          cod: r[9]||"",
          pos: r[10]||"",
          tipo: r[11]||"",
          inspeVisualNQA: r[12]||"",
          inspeFuncionalNQA: r[13]||"",
          idIntegracao: r[14]||"",        
          reparoConserto: r[15]||"",       
         reparoPosicao: r[16]||""
        });
      }
    }
  });

  return out;
}

/* =========================
   Dashboard (por cliente)
   ========================= */

// interpreta “YYYY-MM-DD” como data LOCAL
function parseInputDateLocal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function obterCLIENTE_PMO_OPS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PMO_OPS');
  const dados = sheet.getDataRange().getValues().slice(1);
  return dados
    .filter(row => row[5] && row[0] && row[1])
    .map(row => [
      row[5].toString().trim(),   // Cliente (F)
      row[0].toString().trim(),   // PMO (A)
      row[1].toString().trim(),   // OP  (B)
      row[3].toString().trim()    // Descrição (D)
    ]);
}

function obterRangeSN(pmo, op) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PMO_OPS');
  const rows = sh.getDataRange().getValues(); // inclui cabeçalho
  for (let i = 1; i < rows.length; i++) {
    const pm = (rows[i][0] || '').toString().trim();
    const o  = (rows[i][1] || '').toString().trim();
    if (pm === pmo && o === op) {
      const ini = (rows[i][7] || '').toString().trim(); // H
      const fim = (rows[i][8] || '').toString().trim(); // I
      return { ini, fim };
    }
  }
  return { ini: '', fim: '' };
}

/** Interpreta uma célula "aplicável?" da PMO_OPS (sim/s/yes/y/1/true/x -> true). */
function _aplicYes_(val) {
  const s = (val || '').toString().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase();
  return ['sim', 's', 'yes', 'y', '1', 'true', 'x'].includes(s);
}

/** Monta o mapa de aplicabilidade por posto a partir de uma linha da PMO_OPS. */
function _aplicabilidadeFromRow_(row) {
  const yes = _aplicYes_;
  return {
    'Inicial'       : yes(row[17]), 'Inspeção SPI'  : yes(row[18]),
    'Inspeção SMD'  : yes(row[9]),  'Montagem PTH'  : yes(row[19]),
    'Inspeção PTH'  : yes(row[10]),
    'Teste'         : yes(row[11]), 'Teste Final'   : yes(row[12]),
    'Inspeção Final': yes(row[13]), 'Embalagem'     : yes(row[14]),
    'Inspeção NQA'  : yes(row[15]), 'Integração'    : yes(row[16])
  };
}

function obterAplicabilidadePostos(pmo, op) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PMO_OPS');
  const rows = sh.getDataRange().getValues(); // inclui header
  for (let i = 1; i < rows.length; i++) {
    const pm = (rows[i][0] || '').toString().trim();
    const o  = (rows[i][1] || '').toString().trim();
    if (pm === pmo && o === op) {
      return _aplicabilidadeFromRow_(rows[i]);
    }
  }
  return null;
}

function listarCaixasPorOP(pmo, op) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1) Descobre o cliente na PMO_OPS
  const pm = ss.getSheetByName('PMO_OPS').getDataRange().getValues(); // header incluso
  let row = null;
  for (let i = 1; i < pm.length; i++) {
    const p = (pm[i][0] || '').toString().trim(); // PMO
    const o = (pm[i][1] || '').toString().trim(); // OP
    if (p === pmo && o === op) { row = pm[i]; break; }
  }
  if (!row) return [];

  const cliente = (row[5] || '').toString().trim(); // ajuste se sua coluna "Cliente" for outra
  const regSh   = getOrCreateClientSheet(cliente, ss);
  const vals    = regSh.getDataRange().getValues();

  // 2) Coleta caixas únicas (ignorando maiúsc/minúsc e espaços múltiplos)
  const uniq = new Map(); // chave normalizada -> valor original
  for (let i = 1; i < vals.length; i++) {
    const posto = (vals[i][2] || '').toString().trim().toLowerCase(); // "Embalagem"
    const pmoR  = (vals[i][3] || '').toString().trim();
    const opR   = (vals[i][4] || '').toString().trim();
    const caixa = (vals[i][5] || '').toString().trim();               // Nº da caixa

    if (posto !== 'embalagem') continue;
    if (pmoR !== pmo || opR !== op) continue;
    if (!caixa) continue;

    const norm = caixa.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                   .replace(/\s+/g,' ').trim().toUpperCase();
    if (!uniq.has(norm)) uniq.set(norm, caixa);
  }

  const lista = Array.from(uniq.values());
  // 3) Ordenação natural alfanumérica
  lista.sort((a,b) => a.localeCompare(b, 'pt-BR', { numeric:true, sensitivity:'base' }));

  // (opcional) log para conferir no Executions
  Logger.log(`Caixas ${pmo}/${op}: ${JSON.stringify(lista)}`);

  return lista;
}


function getDashboardData(startIso, endIso, pmo, op) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cliente = getClienteByPMO_OP(pmo, op, ss);
  const sh = getOrCreateClientSheet(cliente, ss);

  const regs = sh.getDataRange().getValues().slice(1);
  const pmodata = ss.getSheetByName('PMO_OPS').getDataRange().getValues().slice(1);

  const startDate = startIso ? parseInputDateLocal(startIso) : null;
  const endDate   = endIso   ? parseInputDateLocal(endIso)   : null;

  const match = pmodata.find(r => r[0] == pmo && r[1] == op);
  const totalRequired = match ? parseInt(match[2], 10) : 0;

  // >>> NOVO: aplicabilidade por posto (PMO_OPS)
  const aplic = obterAplicabilidadePostos(pmo, op) || {};
  // Postos que o front usa
  const postosPadrao = [
    'Inicial','Inspeção SPI','Inspeção SMD','Montagem PTH','Inspeção PTH','Teste','Integração','Teste Final',
    'Inspeção Final','Embalagem','Inspeção NQA','Manutenção'
  ];

  const counts   = {};
  const aplicMap = {};
  postosPadrao.forEach(p => {
    counts[p] = 0;
    // Manutenção sempre pode ocorrer; demais respeitam PMO_OPS
    aplicMap[p] = (p === 'Manutenção') ? true : !!aplic[p];
  });

  // Helpers
  function postoNorm(s){
    return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function toDateLocal(v){
    return (v instanceof Date) ? v : parseDateString(v);
  }
  function dentroFaixa(d){
    if (!startDate && !endDate) return true;
    if (startDate && d < startDate) return false;
    if (endDate) {
      const eod = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23,59,59);
      if (d > eod) return false;
    }
    return true;
  }

  // Conta direto na aba do cliente
  for (let i = 0; i < regs.length; i++) {
    const row = regs[i];
    const pmoR = (row[3] || '').toString().trim();
    const opR  = (row[4] || '').toString().trim();
    if (pmoR !== pmo || opR !== op) continue;

    const d = toDateLocal(row[0]);
    if (!dentroFaixa(d)) continue;

    const postoRaw  = row[2];
    const statRaw   = (row[7] || '').toString().trim();
    const vis       = (row[12] || '').toString();
    const func      = (row[13] || '').toString();

    const pn = postoNorm(postoRaw);

    // Inicial: log puro (sem status) → conta cada ocorrência (linha)
    if (pn === 'inicial') {
      counts['Inicial']++;
      continue;
    }

    // Montagem PTH: log puro (sem status) → conta cada ocorrência (linha)
    if (pn === 'montagem pth') {
      counts['Montagem PTH']++;
      continue;
    }

    // Embalagem: conta cada ocorrência (linha)
    if (pn === 'embalagem') {
      counts['Embalagem']++;
      continue;
    }

    // Integração: conta cada ocorrência (linha espelhada que você grava no cliente)
    if (pn === 'integracao' || pn === 'integração') {
      counts['Integração']++;
      continue;
    }

    // Manutenção: 
    if (pn === 'manutencao' || pn === 'manutenção') {
      if ('Manutenção' in counts) counts['Manutenção']++;
      continue;
    }

    // Inspeção NQA: aprovado quando Visual = Aprovado e Funcional = Aprovado/Não aplicável
    if (pn === 'inspecao nqa' || pn === 'inspeção nqa') {
      const v = vis.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const f = func.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      if (v === 'aprovado' && (f === 'aprovado' || f === 'nao aplicavel' || f === 'não aplicável')) {
        counts['Inspeção NQA']++;
      }
      continue;
    }

    // Demais postos (Teste, Teste Final, Inspeções): conta somente quando Status = Aprovado
    if (statRaw === 'Aprovado' && (postoRaw in counts)) {
      counts[postoRaw] = (counts[postoRaw] || 0) + 1;
    }
  }
  return { counts, totalRequired, aplicMap };
}


function parseDateString(dtStr) {
  const str = dtStr.toString();
  const [dPart,tPart] = str.split(' ');
  const [dd,mm,yyyy] = dPart.split('/').map(Number);
  const [hh,mi,ss] = (tPart||'00:00:00').split(':').map(Number);
  return new Date(yyyy, mm-1, dd, hh||0, mi||0, ss||0);
}

/** Apende as mesmas linhas também na aba "Registros" (espelho para indicadores). */
function appendToRegistros(rows, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  if (!rows || !rows.length) return;

  let sh = ss.getSheetByName('Registros');
  const neededCols = Math.min(rows[0].length, HEADERS.length); // até Q

  if (!sh) {
    sh = ss.insertSheet('Registros');
    sh.getRange(1, 1, 1, neededCols).setValues([HEADERS.slice(0, neededCols)]);
    sh.setFrozenRows(1);
  } else {
    const existingCols = sh.getMaxColumns();
    if (existingCols < neededCols) {
      sh.insertColumnsAfter(existingCols, neededCols - existingCols);
      sh.getRange(1, 1, 1, neededCols).setValues([HEADERS.slice(0, neededCols)]);
    }
  }

  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, neededCols).setValues(rows.map(r => r.slice(0, neededCols)));
}


/*******************************
 * INTEGRAÇÃO (versão sem SKU/Obs)
 *******************************/
const INTEG_HDR_SHEET   = 'INTEGRACAO_HDR';
const INTEG_HDR_HEADERS = [
  'ID','Data/Hora','Colaborador','Cliente','PMO','OP',
  'ProdutoSN','ProdutoSN_Normalizado','QtdPlacas','Status'
];

// Se quiser que as LINHAS DAS PLACAS sejam logadas na PMO/OP das PLACAS (e não na PMO/OP do produto final),
// mude para true. Por padrão deixo false para consolidar pela OP do produto final.
const INTEGRACAO_USAR_PMO_DAS_PLACAS_PARA_LOG = false;

/* Cria/retorna INTEGRACAO_HDR */
function getOrCreateIntegracaoHDR_(ss = SpreadsheetApp.getActiveSpreadsheet()) {
  let sh = ss.getSheetByName(INTEG_HDR_SHEET);
  if (!sh) {
    sh = ss.insertSheet(INTEG_HDR_SHEET);
    sh.getRange(1,1,1,INTEG_HDR_HEADERS.length).setValues([INTEG_HDR_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ID */
function newIntegracaoId_() {
  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `INT-${stamp}-${rand}`;
}

/* Descrição por PMO (independente de OP) */
function buscarDescricaoPorPMO(pmo) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PMO_OPS');
  const rows = sh.getDataRange().getValues().slice(1);
  for (const r of rows) {
    if ((r[0]||'').toString().trim() === (pmo||'').toString().trim()) {
      return (r[3]||'').toString().trim(); // coluna D = Descrição
    }
  }
  return '';
}

/* Índices para duplicidade:
   - produtoSet: SN normalizado do produto final → ID (apenas HDR ATIVOS)
   - placaSet  : SN normalizado da placa        → ID (lendo abas de clientes, posto=Integração, col O = ID presente e ativo) */
function loadIntegracaoIndexes_(cliente) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // HDR: produtos finais ATIVOS (global). Também coletamos IDs ativos.
  const produtoSet = new Map();
  const activeIds  = new Set();
  const shHdr = ss.getSheetByName(INTEG_HDR_SHEET);
  if (shHdr) {
    const H = shHdr.getDataRange().getValues();
    const ix = H[0].reduce((m,h,i)=> (m[h]=i, m), {});
    for (let r=1; r<H.length; r++) {
      if ((H[r][ix['Status']]||'') !== 'ATIVO') continue;
      const id  = (H[r][ix['ID']]||'').toString();
      const snN = (H[r][ix['ProdutoSN_Normalizado']]||'').toString();
      if (snN) produtoSet.set(snN, id);
      if (id) activeIds.add(id);
    }
  }

  // Cliente atual: placas já vinculadas (Posto=Integração) com ID ATIVO
  const placaSet = new Map();
  const shCli = cliente ? ss.getSheetByName(sanitizeSheetName(cliente)) : null;
  if (shCli) {
    const vals = shCli.getDataRange().getValues();
    for (let i=1; i<vals.length; i++) {
      const posto = (vals[i][2]||'').toString().trim().toLowerCase();
      if (posto !== 'integração') continue;
      const id = (vals[i][14]||'').toString().trim(); // col O
      if (!id || !activeIds.has(id)) continue;        // conta só integrações ativas
      const sn = (vals[i][8]||'').toString();         // Nº de Série da placa
      const snN = normalizeSN(sn);
      if (snN) placaSet.set(snN, id);
    }
  }

  return { produtoSet, placaSet };

}

/* Verifica se Integração é aplicável + SN do produto está no range H..I */
function validarPreRequisitosIntegracao_(pmo, op, produtoSN) {
  const aplic = obterAplicabilidadePostos(pmo, op);
  if (aplic && aplic['Integração'] === false) {
    throw new Error('Posto Integração não aplicável para esta OP.');
  }
  if (!validarNumeroSeriePorIntervalo(pmo, op, produtoSN)) {
    throw new Error('Produto Final (Nº de Série) fora do intervalo da OP.');
  }
}

/* Registrar integração:
   - INTEGRACAO_HDR (1 linha)
   - Abas do CLIENTE (1 linha por PLACA) com Posto=Integração e col O = ID */
function registrarIntegracao(dados, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  // dados: { colaborador, cliente, pmo, op, produtoSN, itens:[{Seq,PlacaPMO,PlacaOP,PlacaSN}] }
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const colaborador = (dados.colaborador||'').trim();
    const cliente     = (dados.cliente||'').trim();
    const pmo         = (dados.pmo||'').trim();
    const op          = (dados.op||'').trim();
    const produtoSN   = cleanSNKeepLeadingZeros((dados.produtoSN||'').trim());
    if (!colaborador || !cliente || !pmo || !op || !produtoSN) {
      throw new Error('Preencha Colaborador, Cliente, PMO, OP e Produto Final (SN).');
    }

    validarPreRequisitosIntegracao_(pmo, op, produtoSN);
    const produtoSNn = normalizeSN(produtoSN);

    const itens = (dados.itens||[])
      .map(x => ({
        Seq: Number(x.Seq)||1,
        PlacaPMO: (x.PlacaPMO||'').toString().trim(),
        PlacaOP : (x.PlacaOP||'').toString().trim(),
        PlacaSN : cleanSNKeepLeadingZeros((x.PlacaSN||'').toString().trim()),
        PlacaSNn: normalizeSN(x.PlacaSN||'')
      }))
      .filter(x => x.PlacaSNn);

    if (!itens.length) throw new Error('Informe ao menos 1 placa com Nº de Série.');
    const faltando = itens.find(it => !it.PlacaPMO || !it.PlacaOP);
    if (faltando) throw new Error(`Selecione PMO e OP na linha ${faltando.Seq}.`);

    // Duplicidade rápida (HDR + aba do cliente atual)
    const { produtoSet, placaSet } = loadIntegracaoIndexes_(cliente);
    if (produtoSet.has(produtoSNn)) {
      const exId = produtoSet.get(produtoSNn);
      throw new Error(`Produto Final já integrado (ID ${exId}).`);
    }
    const dups = itens.filter(it => placaSet.has(it.PlacaSNn));
    if (dups.length) {
      const lista = dups.map(d => `${d.PlacaPMO}/${d.PlacaOP} SN=${d.PlacaSN} (ID ${placaSet.get(d.PlacaSNn)})`).join('; ');
      throw new Error(`Placa(s) já vinculada(s): ${lista}`);
    }

    // Grava HDR
    const shHdr = getOrCreateIntegracaoHDR_(ss);
    const id  = newIntegracaoId_();
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    shHdr.appendRow([ id, now, colaborador, cliente, pmo, op, produtoSN, produtoSNn, itens.length, 'ATIVO' ]);

// Grava ITENS na aba do cliente (Posto=Integração, OP na coluna E)
const shCli = getOrCreateClientSheet(cliente, ss);

// 1) linha do PRODUTO FINAL espelhada na aba do cliente
const productRow = [
  now, colaborador, 'Integração',  // A..C
  pmo, op,                         // D..E (PMO/OP do PRODUTO)
  '', '', '',                      // F..H (caixa/limite/status) — vazio
  produtoSN,                       // I    (Nº de Série do PRODUTO)
  '', '', '',                      // J..L (cód/pos/tipo) — vazio
  '', '',                          // M..N (NQA) — vazio
  id,                              // O    (ID Integração — MESMA COLUNA DAS PLACAS)
  '', ''                           // P..Q (reparo) — vazio
];

// 2) linhas das PLACAS
const rowsPlacas = itens.map(it => [
  now, colaborador, 'Integração', it.PlacaPMO, it.PlacaOP, // A..E
  '', '', '',                                             // F..H
  it.PlacaSN,                                             // I
  '', '', '',                                             // J..L
  '', '',                                                 // M..N
  id,                                                     // O
  '', ''                                                  // P..Q
]);

// 3) grava tudo de uma vez (produto primeiro, depois as placas)
const allRows = [productRow, ...rowsPlacas];
// Linhas de Integração não usam Posto/Data de Origem (R/S); grava só A..Q (deixa R/S vazias).
shCli.getRange(shCli.getLastRow()+1, 1, allRows.length, allRows[0].length).setValues(allRows);


    return { ok:true, id };
  } catch (e) {
    return { ok:false, error: String(e.message||e) };
  } finally {
    lock.releaseLock();
  }
}


/* Pesquisa por SN (Produto Final via HDR; Placa via abas de cliente c/ ID ativo) */
function buscarIntegracaoPorSN(sn) {
  const alvo = normalizeSN(sn);
  if (!alvo) return { ok:true, encontrado:false };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shHdr = ss.getSheetByName(INTEG_HDR_SHEET);

  // ===== 1) Procurar como PRODUTO (HDR) =====
  if (shHdr) {
    const H = shHdr.getDataRange().getValues();
    const ix = H[0].reduce((m,h,i)=> (m[h]=i, m), {});
    for (let r=1; r<H.length; r++) {
      if ((H[r][ix['Status']]||'') !== 'ATIVO') continue;
      const prodN = (H[r][ix['ProdutoSN_Normalizado']]||'').toString();
      if (prodN === alvo) {
        const hdr = {
          id: H[r][ix['ID']], dataHora: H[r][ix['Data/Hora']], colaborador: H[r][ix['Colaborador']],
          cliente: H[r][ix['Cliente']], pmo: H[r][ix['PMO']], op: H[r][ix['OP']], produtoSN: H[r][ix['ProdutoSN']],
          qtdPlacas: H[r][ix['QtdPlacas']]
        };

        // Monta itens: 1) Produto, 2) Placas
        const itens = [{
          Tipo: 'Produto',
          PlacaPMO: hdr.pmo,
          PlacaOP : hdr.op,
          PlacaSN : hdr.produtoSN
        }];

        const sheets = listClientSheets(ss);
        sheets.forEach(sh => {
          const vals = sh.getDataRange().getValues();
          for (let i=1; i<vals.length; i++) {
            if ((vals[i][2]||'').toString().trim().toLowerCase()!=='integração') continue;
            if ((vals[i][14]||'').toString() !== hdr.id) continue; // mesma integração
            const snLinha = (vals[i][8]||'').toString();
            // evita duplicar o produto (já vem primeiro)
            if (normalizeSN(snLinha) === normalizeSN(hdr.produtoSN||'')) continue;
            itens.push({
              Tipo: 'Placa',
              PlacaPMO: vals[i][3]||'',
              PlacaOP : vals[i][4]||'',
              PlacaSN : snLinha
            });
          }
        });

        return { ok:true, encontrado:true, tipo:'produto', hdr, itens };
      }
    }
  }

  // ===== 2) Procurar como PLACA (abas de clientes) =====
  const sheets = listClientSheets(ss);
  for (const sh of sheets) {
    const vals = sh.getDataRange().getValues();
    for (let i=1; i<vals.length; i++) {
      if ((vals[i][2]||'').toString().trim().toLowerCase()!=='integração') continue;
      const snN = normalizeSN(vals[i][8]);
      if (snN !== alvo) continue;

      const id = (vals[i][14]||'').toString();
      if (!id) continue;

      // Resolve HDR ativo
      const H = ss.getSheetByName(INTEG_HDR_SHEET)?.getDataRange().getValues() || [];
      const ix = H[0]?.reduce?.((m,h,i)=> (m[h]=i, m), {}) || {};
      const linhaH = H.find((row,idx)=> idx>0 && row[ix['ID']]==id && row[ix['Status']]=='ATIVO');
      if (!linhaH) continue;

      const hdr = {
        id,
        dataHora: linhaH[ix['Data/Hora']],
        colaborador: linhaH[ix['Colaborador']],
        cliente: linhaH[ix['Cliente']],
        pmo: linhaH[ix['PMO']],
        op: linhaH[ix['OP']],
        produtoSN: linhaH[ix['ProdutoSN']],
        qtdPlacas: linhaH[ix['QtdPlacas']]
      };

      // Monta itens: 1) Produto, 2) Placas
      const itens = [{
        Tipo: 'Produto',
        PlacaPMO: hdr.pmo,
        PlacaOP : hdr.op,
        PlacaSN : hdr.produtoSN
      }];

      sheets.forEach(s2 => {
        const v2 = s2.getDataRange().getValues();
        for (let j=1; j<v2.length; j++) {
          if ((v2[j][2]||'').toString().trim().toLowerCase()!=='integração') continue;
          if ((v2[j][14]||'').toString() !== id) continue;
          const snLinha = (v2[j][8]||'').toString();
          if (normalizeSN(snLinha) === normalizeSN(hdr.produtoSN||'')) continue; // evita duplicar produto
          itens.push({
            Tipo: 'Placa',
            PlacaPMO: v2[j][3]||'',
            PlacaOP : v2[j][4]||'',
            PlacaSN : snLinha
          });
        }
      });

      return { ok:true, encontrado:true, tipo:'placa', hdr, itens };
    }
  }

  return { ok:true, encontrado:false };
}



/************************************************************
 * NOVO: Manutenção & Reparo
 * - pendências (defeitos reprovados em Teste/Teste Final)
 * - status: "Pendente" ou "Concluído"
 * - finalizarReparo() cria 1 linha por conserto (Status=Concluído, mesmo ID)
 * Observação: usamos a coluna O (ID Integração) como "ID" genérico (com prefixo REP-).
 ************************************************************/

const REPAIR_ID_PREFIX = 'REP-';

/** Postos cujas reprovas (Reprovado) são roteadas para Manutenção. */
const MAINTENANCE_ORIGIN_POSTOS = ['Inspeção SMD', 'Inspeção PTH', 'Teste', 'Teste Final'];

/**
 * Normaliza uma Data/Hora de Origem para a string canônica 'dd/MM/yyyy HH:mm:ss'.
 * O Google Sheets pode devolver a célula como Date (auto-conversão) ou como texto;
 * em ambos os casos retornamos o mesmo formato usado na chave de ocorrência. Vazio → ''.
 */
function fmtDataHora_(v) {
  if (v === '' || v == null) return '';
  const d = (v instanceof Date) ? v : parseDateString(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}

/**
 * Garante que a aba do cliente comporta o schema atual: colunas físicas suficientes
 * e rótulos de cabeçalho preenchidos (ex.: R/S em abas legadas), sem sobrescrever os já existentes.
 */
function ensureClientSheetSchema_(sh) {
  const maxCols = sh.getMaxColumns();
  if (maxCols < HEADERS.length) sh.insertColumnsAfter(maxCols, HEADERS.length - maxCols);

  const headerRange = sh.getRange(1, 1, 1, HEADERS.length);
  const current = headerRange.getValues()[0];
  let changed = false;
  for (let c = 0; c < HEADERS.length; c++) {
    if (!(current[c] || '').toString().trim()) { current[c] = HEADERS[c]; changed = true; }
  }
  if (changed) headerRange.setValues([current]);
}

/** Gera ID do reparo (ex.: REP-20250910-151230-ABCD) */
function newReparoId_() {
  const tz   = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const now  = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${REPAIR_ID_PREFIX}${now}-${rand}`;
}

/** Constrói chaves para associar defeito↔manutenção */
function makeRepairKey_(pmo, op, sn, cod, pos) {
  return [
    String(pmo||'').trim().toLowerCase(),
    String(op ||'').trim().toLowerCase(),
    normalizeSN(sn||''),
    String(cod||'').trim().toLowerCase(),
    String(pos||'').trim().toLowerCase()
  ].join('|');
}

// Wrapper compatível com a UI antiga — agora só "Pendente" ou "Concluído"
function getPendenciasManutencao(filt) {
  const f = filt || {};
  const rows = manut_listar({
    cliente: f.cliente || '',
    pmo    : f.pmo || '',
    op     : f.op || '',
    status : f.status || '',            // 'Pendente' | 'Concluído' | ''
    dtIni  : f.startIso || '',
    dtFim  : f.endIso || ''
  });
  // ajusta nomes dos campos, caso sua página espere exatamente isso
  return rows.map(r => ({
    dataHora: r.data,
    cliente : r.cliente,
    pmo     : r.pmo,
    op      : r.op,
    sn      : r.sn,
    cod     : r.cod,
    pos     : r.pos,
    tipo    : r.tipo,
    status  : r.status
  }));
}


/** Busca pendências apenas pelo Nº de Série (normalizado) */
function getPendenciasPorSN(sn) {
  const alvo = normalizeSN(sn);
  if (!alvo) return [];
  const all = manut_listar({});
  return all.filter(x => normalizeSN(x.sn) === alvo);
}


/**
 * Lista itens de manutenção (pendentes ou concluídos) a partir dos logs reprovados
 * nos postos de origem (Inspeção SMD, Inspeção PTH, Teste, Teste Final).
 * As linhas são agrupadas por ocorrência de reprova (PMO|OP|SN|Posto de Origem|Data/Hora):
 * uma reprova com várias posições defeituosas vira um único item, com as posições
 * agregadas em `pos` (string) e `posicoes` (array).
 */
function manut_listar(filtros) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const f = filtros || {};
  const fCliente = (f.cliente || '').trim();
  const fPMO     = (f.pmo     || '').trim();
  const fOP      = (f.op      || '').trim();
  const fStatus  = (f.status  || '').toString().trim().toLowerCase(); // '', 'pendente', 'concluído'
  const dIni     = f.dtIni ? parseInputDateLocal(f.dtIni) : null;
  const dFim     = f.dtFim ? parseInputDateLocal(f.dtFim) : null;
  const fSNn     = normalizeSN(f.sn || ''); // <-- NOVO

  const sheets = [];
  if (fCliente) {
    const sh = ss.getSheetByName(sanitizeSheetName(fCliente));
    if (sh) sheets.push(sh);
  } else {
    listClientSheets(ss).forEach(sh => { if (sh.getName() !== 'Registros') sheets.push(sh); });
  }

  // Agrupa as linhas por ocorrência de reprova. A identidade é
  // PMO|OP|SN|Posto de Origem|Data/Hora de Origem: as várias linhas de posição
  // de uma mesma reprova compartilham a Data/Hora e caem na mesma ocorrência,
  // tendo suas posições agregadas num único item.
  const ocorrencias = new Map();

  for (const sh of sheets) {
    const vals = sh.getDataRange().getValues();

    // Índices de “já reparado”, por ocorrência. A chave é
    // PMO|OP|SN|Posto de Origem|Data/Hora de Origem (colunas R e S da linha de Manutenção).
    // Legado: linhas sem Data/Hora de Origem (S vazio) casam por PMO|OP|SN|Posto de Origem,
    // ignorando o timestamp (o Posto de Origem é preenchido no backfill manual).
    const reparoFullSet   = new Set(); // PMO|OP|SN|PostoOrigem|DataHoraOrigem
    const reparoLegacySet = new Set(); // PMO|OP|SN|PostoOrigem (S vazio)
    for (let i = 1; i < vals.length; i++) {
      const posto = (vals[i][2] || '').toString().trim().toLowerCase();
      if (posto !== 'manutenção' && posto !== 'manutencao') continue;
      const baseKey = [
        (vals[i][3]||'').toString().trim(),
        (vals[i][4]||'').toString().trim(),
        normalizeSN(vals[i][8]),
        _norm(vals[i][17])               // R — Posto de Origem (insensível a acento/caixa)
      ].join('|');
      const dataOrigem = fmtDataHora_(vals[i][18]); // S — Data/Hora de Origem
      if (dataOrigem) reparoFullSet.add(baseKey + '|' + dataOrigem);
      else            reparoLegacySet.add(baseKey);
    }

    for (let i = 1; i < vals.length; i++) {
      const posto = (vals[i][2] || '').toString().trim();
      if (!MAINTENANCE_ORIGIN_POSTOS.includes(posto)) continue;

      const status = (vals[i][7] || '').toString().trim();
      if (status !== 'Reprovado') continue;

      const pmo  = (vals[i][3] || '').toString().trim();
      const op   = (vals[i][4] || '').toString().trim();
      const sn   = (vals[i][8] || '').toString();
      const snN  = normalizeSN(sn);
      if (fSNn && snN !== fSNn) continue; // <-- NOVO: filtra por SN no servidor

      const cod  = (vals[i][9] || '').toString();
      const pos  = (vals[i][10]|| '').toString();
      const tipo = (vals[i][11]|| '').toString();

      if (fPMO && pmo !== fPMO) continue;
      if (fOP  && op  !== fOP ) continue;

      const dtCell = vals[i][0];
      const dt = (dtCell instanceof Date) ? dtCell : parseDateString(dtCell);
      if (dIni && dt < dIni) continue;
      if (dFim) {
        const eod = new Date(dFim.getFullYear(), dFim.getMonth(), dFim.getDate(), 23,59,59);
        if (dt > eod) continue;
      }

      let cliente = '';
      try { cliente = getClienteByPMO_OP(pmo, op, ss); } catch(e) { cliente = sh.getName(); }
      if (fCliente && sanitizeSheetName(fCliente) !== sanitizeSheetName(cliente)) continue;

      const dataFmt = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
      const postoOrigemKey = _norm(posto);
      const fullKey   = [pmo, op, snN, postoOrigemKey, dataFmt].join('|');
      const legacyKey = [pmo, op, snN, postoOrigemKey].join('|');
      const concluido = reparoFullSet.has(fullKey) || reparoLegacySet.has(legacyKey);
      const situacao = concluido ? 'Concluído' : 'Pendente';
      if (fStatus && fStatus !== situacao.toLowerCase()) continue;

      const ocorrenciaKey = [pmo, op, snN, posto, dataFmt].join('|');

      let item = ocorrencias.get(ocorrenciaKey);
      if (!item) {
        item = {
          data: dataFmt,
          cliente, pmo, op, sn,
          cod, tipo,
          postoOrigem: posto,
          status: situacao,
          posicoes: []
        };
        ocorrencias.set(ocorrenciaKey, item);
      }

      // Agrega as posições defeituosas da ocorrência (sem duplicar).
      const posTrim = pos.trim();
      if (posTrim && item.posicoes.indexOf(posTrim) === -1) item.posicoes.push(posTrim);
      // Código e Tipo são únicos por ocorrência; preserva o primeiro valor não-vazio.
      if (!item.cod && cod) item.cod = cod;
      if (!item.tipo && tipo) item.tipo = tipo;
    }
  }

  const out = [];
  ocorrencias.forEach(item => {
    item.pos = item.posicoes.join(', ');
    out.push(item);
  });

  out.sort((a,b)=> a.data < b.data ? 1 : -1);
  return out;
}


/** Busca rápida pelo SN (mais recente Reprovado em Teste/Teste Final) para pré-preenchimento */
function manut_buscarSN(snBusca) {
  const alvo = normalizeSN(snBusca);
  if (!alvo) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = listClientSheets(ss).filter(sh => sh.getName() !== 'Registros');

  let melhor = null, melhorDate = 0;

  for (const sh of sheets) {
    const v = sh.getDataRange().getValues();
    for (let i=1;i<v.length;i++){
      const posto = (v[i][2]||'').toString().trim();
      if (posto !== 'Teste' && posto !== 'Teste Final') continue;
      const stat = (v[i][7]||'').toString().trim();
      if (stat !== 'Reprovado') continue;
      const snN = normalizeSN(v[i][8]);
      if (snN !== alvo) continue;

      const dtCell = v[i][0];
      const dt = (dtCell instanceof Date) ? dtCell : parseDateString(dtCell);
      const t = dt.getTime();
      if (t > melhorDate) {
        melhorDate = t;
        melhor = {
          data: Utilities.formatDate(dt, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
          pmo : (v[i][3]||'').toString().trim(),
          op  : (v[i][4]||'').toString().trim(),
          sn  : (v[i][8]||'').toString(),
          cod : (v[i][9]||'').toString(),
          pos : (v[i][10]||'').toString(),
          tipo: (v[i][11]||'').toString()
        };
      }
    }
  }

  if (melhor) {
    try { melhor.cliente = getClienteByPMO_OP(melhor.pmo, melhor.op, ss); } catch(e) { melhor.cliente = ''; }
  }
  return melhor;
}

/** Grava o(s) reparo(s) — 1 linha por conserto, Posto='Manutenção', usando colunas P e Q */
function manut_registrarReparo(payload, ss = SpreadsheetApp.getActiveSpreadsheet()) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const dados = payload || {};
    const colaborador = (dados.colaborador||'').trim();
    const pmo  = (dados.pmo||'').trim();
    const op   = (dados.op||'').trim();
    const sn   = cleanSNKeepLeadingZeros((dados.sn||'').toString().trim());
    const cod  = (dados.cod||'').toString().trim();
    const pos  = (dados.pos||'').toString().trim();
    const tipo = (dados.tipo||'').toString().trim();
    const postoOrigem    = (dados.postoOrigem||'').toString().trim();
    const dataHoraOrigem = (dados.dataHoraOrigem||'').toString().trim();
    const consertos = Array.isArray(dados.consertos) ? dados.consertos : [];

    if (!colaborador || !pmo || !op || !sn || !consertos.length) {
      throw new Error('Informe Colaborador, PMO, OP, Nº de Série e ao menos um conserto.');
    }

    // aba correta do cliente
    const cliente = getClienteByPMO_OP(pmo, op, ss);
    const sh = getOrCreateClientSheet(cliente, ss);
    ensureClientSheetSchema_(sh); // colunas R/S e rótulos garantidos antes de gravar

    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');

    // monta linhas (A..S). Posto de Origem (R) e Data/Hora de Origem (S) vêm da ocorrência
    // selecionada — é o que casa o reparo com a ocorrência (um único envio fecha todas as posições).
    const rows = consertos.map(c => ([
      now, colaborador, 'Manutenção', pmo, op,   // A..E
      '', '', '',                                // F..H (caixa/limite/status – não usados aqui)
      sn,                                        // I
      cod, pos, tipo,                            // J..L defeito original
      '', '',                                    // M..N (NQA vis/func) vazio
      '',                                        // O (ID Integração) vazio
      (c.descricao||'').toString().trim(),       // P  Reparo - Conserto
      (c.posicao  ||'').toString().trim(),       // Q  Reparo - Posição
      postoOrigem,                               // R  Posto de Origem
      dataHoraOrigem                             // S  Data/Hora de Origem
    ]));

    sh.getRange(sh.getLastRow()+1, 1, rows.length, HEADERS.length).setValues(rows);

    // espelho em "Registros" (tudo ok se a aba tiver só 14 cols; a função se ajusta)
    appendToRegistros(rows, ss);

    return { ok:true, message:`Reparo finalizado (${rows.length} linha(s)).` };
  } finally {
    lock.releaseLock();
  }
}