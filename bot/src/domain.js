// Domínio do controle financeiro do casal: bancos, pessoas e categorias.
//
// Regra: o BANCO define o dono do gasto. O mapeamento abaixo é a fonte da verdade
// e é fácil de estender (novo banco = nova linha). Nomes normalizados em minúsculas.

export const PESSOAS = ['Eduardo', 'Maria'];

// Apelidos que aparecem nas mensagens -> pessoa canônica. É aqui que se adiciona
// um novo jeito de chamar alguém (chave em minúsculas, sem acento não é tratado).
const APELIDOS = {
  eduardo: 'Eduardo',
  edu: 'Eduardo',
  du: 'Eduardo',
  maria: 'Maria',
  duda: 'Maria',
  'maria eduarda': 'Maria',
};

// Resolve um nome/apelido livre para a pessoa canônica (ou null se não reconhecer).
export function resolvePessoa(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  return APELIDOS[k] || (PESSOAS.includes(String(raw).trim()) ? String(raw).trim() : null);
}

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

// ---- Categorias ----
//
// A categorização é ABERTA: vale o que a pessoa escrever. As listas abaixo são só a
// SEMENTE (o que o bot conhece antes do primeiro lançamento) — o vocabulário real é o
// que já foi usado nos meses gravados (`store.categoriasUsadas`), e o modelo recebe
// esse vocabulário para reusar em vez de inventar sinônimo.
export const CATEGORIAS_SAIDA = [
  'Mercado',
  'Alimentação/iFood',
  'Uber',
  'Gasolina',
  'Fatura',
  'Outros',
];

export const CATEGORIAS_ENTRADA = ['Salário', 'Freela', 'Reembolso', 'Outros'];

// Sinônimos que sempre desembocam na mesma categoria. Existe para os casos que se
// repetem muito (mercado e alimentação); o resto fica por conta do vocabulário vivo.
const ALIASES_CATEGORIA = {
  supermercado: 'Mercado',
  mercado: 'Mercado',
  compras: 'Mercado',
  'compras de mercado': 'Mercado',
  ifood: 'Alimentação/iFood',
  'i food': 'Alimentação/iFood',
  alimentacao: 'Alimentação/iFood',
  'alimentacao/ifood': 'Alimentação/iFood',
  delivery: 'Alimentação/iFood',
  restaurante: 'Alimentação/iFood',
  lanche: 'Alimentação/iFood',
  combustivel: 'Gasolina',
  '99': 'Uber',
};

// Chave de comparação: sem acento, sem caixa, espaços colapsados.
function chaveCategoria(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Mantém a categoria aberta, mas evita que a MESMA coisa vire duas barras no
// relatório ("mercado", "Mercado", "Supermercado"). Ordem: alias > grafia já usada
// em `conhecidas` > o texto da pessoa, capitalizado.
export function normalizeCategoria(raw, conhecidas = []) {
  const texto = String(raw ?? '').trim();
  if (!texto) return 'Outros';
  const k = chaveCategoria(texto);
  if (ALIASES_CATEGORIA[k]) return ALIASES_CATEGORIA[k];
  const jaUsada = conhecidas.find((c) => chaveCategoria(c) === k);
  if (jaUsada) return jaUsada;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
