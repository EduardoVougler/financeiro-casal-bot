// Regras de data dos lançamentos. O modelo pode devolver "hoje" para uma data
// omitida, mas esse valor nunca deve ser persistido: depois de alguns dias ele perde
// completamente o significado.

export function formatDateBr(date = new Date()) {
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

// Materializa datas relativas/ausentes no instante em que o lançamento é lido.
// Datas explícitas continuam intactas, apenas com dia e mês preenchidos com zero.
export function normalizarData(raw, agora = new Date()) {
  const texto = String(raw ?? '').trim();
  if (!texto || /^hoje$/i.test(texto)) return formatDateBr(agora);

  const m = texto.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!m) return texto;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return texto;
  const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : '';
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}${ano ? `/${ano}` : ''}`;
}

// Compatibilidade com registros antigos que salvaram literalmente "hoje". Neles,
// o timestamp de registro é a melhor fonte para recuperar a data real.
export function dataParaExibicao(lancamento) {
  const data = String(lancamento?.data ?? '').trim();
  if (data && !/^hoje$/i.test(data)) return data;
  const registrada = lancamento?.registrado_em ? new Date(lancamento.registrado_em) : null;
  if (registrada && !Number.isNaN(registrada.getTime())) return formatDateBr(registrada);
  // Sem timestamp não é possível reconstruir o dia sem inventar informação.
  return '—';
}

// Mês de destino: competência declarada > data explícita > mês atual.
export function mesDoLancamento(lancamento, agora = new Date()) {
  const competencia = String(lancamento?.competencia || '').match(/^(\d{4})-(\d{2})$/);
  if (competencia && +competencia[2] >= 1 && +competencia[2] <= 12) {
    return `${competencia[1]}-${competencia[2]}`;
  }

  const data = String(lancamento?.data || '').match(
    /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/
  );
  if (!data || +data[2] < 1 || +data[2] > 12) return monthKeyOf(agora);
  let ano = data[3] ? +data[3] : agora.getFullYear();
  if (ano < 100) ano += 2000;
  return `${ano}-${String(+data[2]).padStart(2, '0')}`;
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
