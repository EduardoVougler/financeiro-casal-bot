// Domínio do controle financeiro do casal: bancos, pessoas e categorias.
//
// Regra: o BANCO define o dono do gasto. O mapeamento abaixo é a fonte da verdade
// e é fácil de estender (novo banco = nova linha). Nomes normalizados em minúsculas.

export const PESSOAS = ['Eduardo', 'Maria'];

// banco (chave normalizada) -> { nome de exibição, dono }
export const BANCOS = {
  nubank: { nome: 'Nubank', dono: 'Maria' },
  bb: { nome: 'Banco do Brasil', dono: 'Maria' },
  inter: { nome: 'Inter', dono: 'Eduardo' },
  bradesco: { nome: 'Bradesco', dono: 'Eduardo' },
};

// Aliases que o parsing/transcrição pode produzir -> chave canônica do banco.
const ALIASES = {
  nubank: 'nubank',
  nu: 'nubank',
  'banco do brasil': 'bb',
  bb: 'bb',
  'bco do brasil': 'bb',
  inter: 'inter',
  'banco inter': 'inter',
  bradesco: 'bradesco',
};

// Resolve um texto livre para a chave canônica do banco (ou null se não reconhecer).
export function resolveBanco(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  if (BANCOS[k]) return k;
  return ALIASES[k] || null;
}

// Dono derivado do banco. Retorna null se o banco for desconhecido.
export function donoDoBanco(bancoKey) {
  const b = BANCOS[bancoKey];
  return b ? b.dono : null;
}

export function nomeDoBanco(bancoKey) {
  return BANCOS[bancoKey]?.nome || bancoKey || '—';
}

// Categorias iniciais (a lista cresce com o uso — não é enum fixo).
export const CATEGORIAS_SAIDA = [
  'Alimentação/mercado',
  'Uber',
  'iFood',
  'Gasolina',
  'Outros',
];

export const CATEGORIAS_ENTRADA = ['Salário', 'Freela', 'Reembolso', 'Outros'];
