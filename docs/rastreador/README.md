# Rastreador do Pedido — material de apresentação

- `Rastreador-do-Pedido.pdf` — o documento de design em PDF, na paleta do ShopFloor. É o que se
  manda para quem não vai ler markdown.
- `rastreador-do-pedido.html` — a fonte do PDF. Para regerar depois de editar:

```bash
google-chrome --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="docs/rastreador/Rastreador-do-Pedido.pdf" \
  "file://$PWD/docs/rastreador/rastreador-do-pedido.html"
```

O conteúdo canônico é a spec em `docs/superpowers/specs/2026-09-28-rastreador-do-pedido-design.md`;
mudou lá, muda aqui.
