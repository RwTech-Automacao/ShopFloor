import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(__dirname, 'recuperar-senha.html'), 'utf8')
const LINK = '{{ .SiteURL }}/auth/redefinir?token_hash={{ .TokenHash }}&type=recovery'

describe('template de e-mail de recuperação', () => {
  it('usa exatamente o link token_hash', () => {
    expect(html).toContain(LINK)
  })
  it('não usa código numérico nem ConfirmationURL', () => {
    expect(html).not.toContain('{{ .Token }}')
    expect(html).not.toContain('{{ .ConfirmationURL }}')
  })
  it('sem script, link, img nem recursos externos', () => {
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toMatch(/\bsrc\s*=/i)
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i)
  })
})
