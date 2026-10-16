#!/usr/bin/env python3
"""Lê um HAR do Firefox e imprime SÓ o que a integração precisa: método, URL (sem _dc), corpo enviado e um RESUMO da resposta.
NUNCA imprime cabeçalhos nem cookies. Remove valores de chaves sensíveis. As respostas de endpoints sensíveis são omitidas inteiras.
Rede de segurança final: se sobrar algo parecido com token/JWT no texto, é trocado por [omitido] antes de imprimir."""
import json, re, sys
from urllib.parse import urlsplit, parse_qsl, urlencode, urlunsplit

CHAVE_SENSIVEL = re.compile(r"senha|password|passwd|token|secret|authorization|cookie|usuarionfse|login|cpf|cnpj|e-?mail|chave", re.I)
CHAVE_UTIL = re.compile(r"quantidade|^id$|id$|numero|status|^data$|estoque|locacao|observ|classific|estorn|cancel|refugo|produz|apont|requisit|empenh|saldo|lote|descricao$|codigo$|unidade|tipo", re.I)
ENDPOINT_SENSIVEL = re.compile(r"parametrizacao|getUsuarioEEmpresaSessao|permissaoUsuario|/oauth|/login|/auth", re.I)
RUIDO = re.compile(r"notificacao/verify|/lock/keep|/verify$|\.(png|js|css|svg|woff2?|ico|gif|jpg)(\?|$)", re.I)
PADRAO_SEGREDO = re.compile(r"(Bearer\s+[A-Za-z0-9._\-]+|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,})")

def limpar_url(u):
    p = urlsplit(u)
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k != "_dc"]
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), ""))

def resumir(no, chave="", prof=0, ate=5):
    if CHAVE_SENSIVEL.search(chave or ""): return "[omitido]"
    if isinstance(no, dict):
        if prof >= ate: return "{…%d chaves}" % len(no)
        out = {}
        for k, v in no.items():
            if CHAVE_SENSIVEL.search(k): out[k] = "[omitido]"; continue
            if isinstance(v, (dict, list)): out[k] = resumir(v, k, prof + 1, ate)
            elif CHAVE_UTIL.search(k): out[k] = v
        return out
    if isinstance(no, list):
        if not no: return []
        return {"_itens": len(no), "_primeiro": resumir(no[0], chave, prof + 1, ate)}
    return no

def redigir(no, chave=""):
    """Corpo ENVIADO pela tela: mantém todos os campos (é o contrato que queremos ver); só esconde chaves sensíveis."""
    if CHAVE_SENSIVEL.search(chave or ""): return "[omitido]"
    if isinstance(no, dict): return {k: redigir(v, k) for k, v in no.items()}
    if isinstance(no, list): return [redigir(v, chave) for v in no[:50]] + (["…+%d itens" % (len(no) - 50)] if len(no) > 50 else [])
    if isinstance(no, str) and len(no) > 300: return no[:300] + "…"
    return no

def corpo_enviado(req):
    pd = req.get("postData") or {}
    if pd.get("params"):
        return {p["name"]: ("[omitido]" if CHAVE_SENSIVEL.search(p["name"]) else p.get("value")) for p in pd["params"]}
    t = pd.get("text")
    if not t: return None
    try: return redigir(json.loads(t))
    except Exception:
        d = {k: ("[omitido]" if CHAVE_SENSIVEL.search(k) else v) for k, v in parse_qsl(t, keep_blank_values=True)}
        return d or "[corpo não-JSON omitido]"

def main(caminho):
    har = json.load(open(caminho, encoding="utf-8"))
    linhas, vistos = [], 0
    for e in har["log"]["entries"]:
        req, resp = e["request"], e["response"]
        url = req["url"]
        if req["method"] == "OPTIONS" or RUIDO.search(url): continue
        vistos += 1
        linhas.append("=" * 100)
        linhas.append("%s %s   -> HTTP %s" % (req["method"], limpar_url(url), resp.get("status")))
        c = corpo_enviado(req)
        if c is not None: linhas.append("CORPO ENVIADO: " + json.dumps(c, ensure_ascii=False))
        if ENDPOINT_SENSIVEL.search(url):
            linhas.append("RESPOSTA: [omitida: endpoint sensível]"); continue
        txt = (resp.get("content") or {}).get("text") or ""
        if not txt: linhas.append("RESPOSTA: (vazia)"); continue
        try: linhas.append("RESPOSTA (resumo): " + json.dumps(resumir(json.loads(txt)), ensure_ascii=False))
        except Exception: linhas.append("RESPOSTA: [não-JSON omitida, %d bytes]" % len(txt))
    saida = "\n".join(linhas) + "\n\n(%d requisições de dados; cabeçalhos e cookies nunca são lidos)\n" % vistos
    saida = PADRAO_SEGREDO.sub("[omitido]", saida)
    sys.stdout.write(saida)

if __name__ == "__main__": main(sys.argv[1])
