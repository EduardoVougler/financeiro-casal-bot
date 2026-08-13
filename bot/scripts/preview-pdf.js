// Preview visual do relatório: gera um PDF com dados fictícios.
// Uso: TELEGRAM_TOKEN=x ANTHROPIC_API_KEY=x ALLOWED_CHAT_IDS=1 DATA_DIR=/tmp/preview node scripts/preview-pdf.js
import { buildReportHtml, buildAnnualReportHtml } from '../src/report.js';
import { renderPdf } from '../src/pdf.js';

const lanc = (d, tipo, valor, descricao, categoria, autor, banco, forma_pagamento) =>
  ({ data: d, tipo, valor, descricao, categoria, autor, banco, forma_pagamento });

const month = {
  key: '2026-07',
  lancamentos: [
    lanc('05/07', 'entrada', 8500, 'Salário', 'Salário', 'Eduardo'),
    lanc('05/07', 'entrada', 6200, 'Salário', 'Salário', 'Maria'),
    lanc('10/07', 'entrada', 900, 'Freela site', 'Extra', 'Eduardo'),
    lanc('03/07', 'saida', 2100, 'Aluguel', 'Moradia', 'Eduardo', 'bb', 'debito'),
    lanc('04/07', 'saida', 850, 'Mercado mês', 'Mercado', 'Maria', 'nubank', 'credito'),
    lanc('08/07', 'saida', 320, 'Restaurante', 'Lazer', 'Eduardo', 'nubank', 'credito'),
    lanc('11/07', 'saida', 210, 'Uber', 'Transporte', 'Maria', 'inter', 'debito'),
    lanc('15/07', 'saida', 1450, 'Farmácia e consulta', 'Saúde', 'Maria', 'bradesco', 'debito'),
    lanc('18/07', 'saida', 480, 'Energia + internet', 'Contas', 'Eduardo', 'bb', 'debito'),
    lanc('22/07', 'saida', 260, 'Cinema e pipoca', 'Lazer', 'Maria', 'nubank', 'credito'),
  ],
};

const { html } = buildReportHtml(month);
console.log(renderPdf(html, 'preview-mensal'));

const months = {};
for (const [mk, ls] of Object.entries({
  '2026-01': [lanc('05/01', 'entrada', 14000, 'Salários', 'Salário', 'Eduardo'), lanc('10/01', 'saida', 9800, 'Gastos', 'Geral', 'Maria', 'nubank', 'credito')],
  '2026-02': [lanc('05/02', 'entrada', 14500, 'Salários', 'Salário', 'Eduardo'), lanc('10/02', 'saida', 11200, 'Gastos', 'Geral', 'Eduardo', 'bb', 'debito')],
  '2026-03': [lanc('05/03', 'entrada', 14000, 'Salários', 'Salário', 'Maria'), lanc('10/03', 'saida', 15800, 'Gastos', 'Geral', 'Maria', 'nubank', 'credito')],
  '2026-07': month.lancamentos,
})) months[mk] = { key: mk, lancamentos: ls };

const yearData = { year: 2026, months, lancamentos: Object.values(months).flatMap((m) => m.lancamentos) };
const anual = buildAnnualReportHtml(yearData, { parcial: true });
console.log(renderPdf(anual.html, 'preview-anual'));
