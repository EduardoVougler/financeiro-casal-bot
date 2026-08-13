// Domínio do controle financeiro do casal: bancos, pessoas e categorias.
//
// Banco e titular são dimensões independentes: Eduardo e Maria podem ter contas
// separadas na mesma instituição. O par { banco, autor } identifica de qual conta
// veio o gasto; banco sozinho nunca determina a pessoa.

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

// Bancos conhecidos de partida. A lista não é fechada: instituições novas passam
// a integrar o vocabulário assim que aparecem em um lançamento confirmado.
export const BANCOS = {
  nubank: { nome: 'Nubank' },
  bb: { nome: 'Banco do Brasil' },
  inter: { nome: 'Inter' },
  bradesco: { nome: 'Bradesco' },
};

export const BANCOS_SEMENTE = Object.values(BANCOS).map((b) => b.nome);

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

function chaveBanco(raw) {
  return String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve um texto livre para a forma canônica. Bancos tradicionais mantêm as
// chaves legadas; bancos novos preservam um nome de exibição e podem ser reusados
// pela grafia já existente em `conhecidos`.
export function resolveBanco(raw, conhecidos = []) {
  if (!raw) return null;
  const texto = String(raw).trim();
  const k = chaveBanco(texto);
  if (BANCOS[k]) return k;
  if (ALIASES[k]) return ALIASES[k];
  const usado = conhecidos.find(
    (b) => chaveBanco(b) === k || chaveBanco(nomeDoBanco(b)) === k
  );
  if (usado) return usado;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function nomeDoBanco(bancoKey) {
  return BANCOS[bancoKey]?.nome || bancoKey || '—';
}

// Pessoa citada > quem enviou. Mantido no domínio (sem dependência de APIs) para
// que a regra conta/titular seja única e facilmente testável.
export function applyDono(lancamento, fallbackAutor, bancosConhecidos = []) {
  const banco = resolveBanco(lancamento.banco, bancosConhecidos);
  const autor = resolvePessoa(lancamento.autor) || fallbackAutor || null;
  return { ...lancamento, banco, autor };
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
