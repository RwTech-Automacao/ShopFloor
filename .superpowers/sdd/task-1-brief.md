## Task 1: Scaffold do projeto Next.js + ferramentas

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.eslintrc`, `.prettierrc`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `tailwind.config.ts`, `postcss.config.mjs`, `components.json` (shadcn)
- Test: `src/shared/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: um projeto Next.js executável (`npm run dev`), Vitest configurado (`npm test`), Tailwind com token de cor `enterplak` (`#8D2033`).

- [ ] **Step 1: Criar o app Next.js com TypeScript e Tailwind**

Rodar na raiz do projeto (a pasta já contém `Logo_Docs.png`, a planilha e `docs/`; o create-next-app aceita diretório não-vazio desde que não haja conflito de arquivos gerados):

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor"
npx create-next-app@latest . \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --no-turbopack
```

Responder "Yes" caso pergunte sobre sobrescrever, garantindo que `Logo_Docs.png` e `docs/` permaneçam.

- [ ] **Step 2: Habilitar TypeScript strict**

Editar `tsconfig.json` e garantir em `compilerOptions`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

- [ ] **Step 3: Instalar e configurar Vitest**

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths @testing-library/react @testing-library/jest-dom jsdom
```

Criar `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
```

Criar `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Adicionar ao `package.json` em `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Configurar a cor primária Enterplak no Tailwind**

Em `tailwind.config.ts`, dentro de `theme.extend.colors`:

```ts
colors: {
  enterplak: {
    DEFAULT: '#8D2033',
    600: '#8D2033',
    700: '#73182a',
    50: '#f7e9ec',
  },
},
```

- [ ] **Step 5: Instalar shadcn/ui**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input label card dropdown-menu avatar sonner
```

Quando perguntado a cor base, aceitar o default (ajustaremos via token `enterplak`).

- [ ] **Step 6: Escrever o teste smoke**

Criar `src/shared/lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('ambiente de testes', () => {
  it('executa asserções básicas', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Rodar o teste (deve passar) e o build**

```bash
npm test
# Espera: 1 passed
npm run build
# Espera: build concluído sem erros de tipo
```

- [ ] **Step 8: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js + TS strict + Tailwind + shadcn + Vitest"
```

---

