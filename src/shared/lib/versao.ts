/**
 * Versão do sistema (login e Sobre). Regra, a cada deploy:
 *  - só correções            → sobe o último número (2.0.1)
 *  - funções novas           → sobe o do meio (2.1.0)
 *  - mudança de patamar      → sobe o primeiro (3.0.0)
 * A versão nunca volta. Esconder uma função é papel do lançamento escondido, não do número.
 */
export const VERSAO = '2.0.0'

/** Marcos principais, do mais novo pro mais antigo (tela Sobre). */
export const HISTORICO_VERSOES: { versao: string; data: string; resumo: string }[] = [
  {
    versao: '2.0.0',
    data: '21/09/2026',
    resumo:
      'Consolidação: sistema na AWS, módulos Setup, Alertas e Repinmetro, SSO do Portal RwTech, NQA por caixa, cancelamentos com auditoria, Dashboard e Fluxo de Processos redesenhados.',
  },
  { versao: '1.1.0', data: '14/08/2026', resumo: 'Fluxo de Processos (ShopFloor) em produção.' },
  { versao: '1.0.0', data: '08/07/2026', resumo: 'Primeira versão: Recebimento, perfis e configurações.' },
]
