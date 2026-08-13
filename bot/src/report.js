// Monta os relatórios do casal como HTML (renderizados em PDF por pdf.js).
// Dois relatórios: mensal (buildReportHtml) e anual (buildAnnualReportHtml),
// compartilhando as mesmas seções (KPIs, por pessoa, por categoria, por banco).

import { PESSOAS, nomeDoBanco } from './domain.js';
import { dataParaExibicao } from './dates.js';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MESES_ABR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Cores de destaque por pessoa (validadas p/ daltonismo) e por banco (só o "dot").
const CORES_PESSOA = { Eduardo: '#2563eb', Maria: '#0d9488' };
const CORES_BANCO = { nubank: '#820ad1', bb: '#103a8f', inter: '#ff7a00', bradesco: '#cc092f' };

function money(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function reais(n) {
  const v = Number(n) || 0;
  // Negativo com sinal tipográfico antes do R$, igual ao extrato: "− R$ 1.234,56".
  return `${v < 0 ? '− ' : ''}R$ ${money(Math.abs(v))}`;
}
// Mesmo sinal tipográfico para valores sem o prefixo R$ (tabelas mês a mês).
function moneySinal(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '− ' : ''}${money(Math.abs(v))}`;
}
function pct1(x) {
  return `${((x || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
function formaLabel(f) {
  return f === 'credito' ? 'Crédito' : f === 'debito' ? 'Débito' : f || '';
}
function mesmaInformacao(a, b) {
  const chave = (v) => String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return Boolean(chave(a)) && chave(a) === chave(b);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function soma(lancs) {
  return lancs.reduce((s, l) => s + num(l.valor), 0);
}
function agrupar(lancs, keyFn) {
  const map = new Map();
  for (const l of lancs) {
    const k = keyFn(l) || '—';
    map.set(k, (map.get(k) || 0) + num(l.valor));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// ---- Blocos reutilizáveis ----

function heroBlock({ periodo, badge }) {
  return `
  <header class="hero">
    <div class="hero-left">
      <div class="eyebrow">Controle Financeiro do Casal</div>
      <h1>Eduardo <span class="amp">&amp;</span> Maria</h1>
    </div>
    <div class="hero-right">
      <div class="period">${periodo}</div>
      ${badge}
    </div>
  </header>`;
}

function kpisBlock(totEntradas, totSaidas, { legenda = 'no mês', saldoSub } = {}) {
  const saldo = totEntradas - totSaidas;
  const pos = saldo >= 0;
  const sub = saldoSub || (pos ? 'sobrou no período' : 'ficou negativo');
  return `
  <section class="kpis">
    <div class="kpi">
      <div class="kpi-label">Entradas</div>
      <div class="kpi-value pos">${reais(totEntradas)}</div>
      <div class="kpi-sub">recebimentos ${legenda}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Saídas</div>
      <div class="kpi-value neg">${reais(totSaidas)}</div>
      <div class="kpi-sub">gastos ${legenda}</div>
    </div>
    <div class="kpi kpi-balance ${pos ? 'is-pos' : 'is-neg'}">
      <div class="kpi-label">Saldo</div>
      <div class="kpi-value">${reais(saldo)}</div>
      <div class="kpi-sub">${sub}</div>
    </div>
  </section>`;
}

function sectionPessoa(entradas, saidas) {
  const cartoes = PESSOAS.map((p) => {
    const e = soma(entradas.filter((l) => l.autor === p));
    const s = soma(saidas.filter((l) => l.autor === p));
    const sal = e - s;
    const cor = CORES_PESSOA[p] || '#4f46e5';
    return `
    <div class="person" style="--accent:${cor}">
      <div class="person-head"><span class="person-dot"></span>${esc(p)}</div>
      <div class="person-line"><span>Entradas</span><b class="pos">${reais(e)}</b></div>
      <div class="person-line"><span>Saídas</span><b class="neg">${reais(s)}</b></div>
      <div class="person-line person-saldo"><span>Saldo</span><b class="${sal >= 0 ? 'pos' : 'neg'}">${reais(sal)}</b></div>
    </div>`;
  }).join('');
  return `
  <section class="block">
    <h2>Por pessoa</h2>
    <div class="people">${cartoes}</div>
  </section>`;
}

function sectionCategoria(saidas) {
  if (!saidas.length) return '';
  const totSaidas = soma(saidas);
  const cats = agrupar(saidas, (l) => l.categoria);
  const maxCat = cats.length ? cats[0][1] : 1;
  const barras = cats
    .map(([cat, val]) => {
      const w = maxCat ? Math.max(2, (val / maxCat) * 100) : 0;
      const share = totSaidas ? val / totSaidas : 0;
      return `
      <div class="bar-row">
        <div class="bar-label">${esc(cat)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%"></div></div>
        <div class="bar-val"><b>${money(val)}</b><span>${pct1(share)}</span></div>
      </div>`;
    })
    .join('');
  return `
  <section class="block">
    <h2>Gastos por categoria</h2>
    <div class="bars">${barras}</div>
  </section>`;
}

function sectionBanco(saidas) {
  // A conta é identificada por banco + pessoa. Assim Nubank/Eduardo e
  // Nubank/Maria aparecem em linhas separadas, inclusive nas respectivas faturas.
  const contas = new Map();
  for (const l of saidas) {
    const key = `${l.banco || ''}\u0000${l.autor || ''}`;
    if (!contas.has(key)) contas.set(key, { banco: l.banco, autor: l.autor, lancamentos: [] });
    contas.get(key).lancamentos.push(l);
  }

  const ordenadas = [...contas.values()].sort((a, b) => {
    const banco = nomeDoBanco(a.banco).localeCompare(nomeDoBanco(b.banco), 'pt-BR');
    return banco || String(a.autor || '').localeCompare(String(b.autor || ''), 'pt-BR');
  });

  const linhas = ordenadas.map(({ banco, autor, lancamentos }) => {
    const cred = soma(lancamentos.filter((l) => l.forma_pagamento === 'credito'));
    const deb = soma(lancamentos.filter((l) => l.forma_pagamento === 'debito'));
    const semForma = soma(lancamentos.filter(
      (l) => l.forma_pagamento !== 'credito' && l.forma_pagamento !== 'debito'
    ));
    const cor = banco ? (CORES_BANCO[banco] || '#64748b') : '#cbd5e1';
    return `
      <tr>
        <td><span class="bank-dot" style="background:${cor}"></span>${banco ? esc(nomeDoBanco(banco)) : '<i>sem banco</i>'}</td>
        <td>${esc(autor || '—')}</td>
        <td class="r">${cred ? money(cred) : '—'}</td>
        <td class="r">${deb ? money(deb) : '—'}</td>
        <td class="r"><b>${money(cred + deb + semForma)}</b></td>
      </tr>`;
  }).join('');
  if (!ordenadas.length) return '';
  return `
  <section class="block">
    <h2>Gastos por banco e forma de pagamento</h2>
    <table class="tbl">
      <thead><tr><th>Banco</th><th>Titular</th><th class="r">Crédito (fatura)</th><th class="r">Débito</th><th class="r">Total</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </section>`;
}

function foot({ compacto = false } = {}) {
  return `<footer class="foot${compacto ? ' foot-compact' : ''}">Gerado em ${new Date().toLocaleDateString('pt-BR')} · Financeiro do Casal</footer>`;
}

// Extrato de movimentações (tabela detalhada). Compartilhado entre os relatórios
// mensal e anual. Com poucos lançamentos o extrato flui na mesma página; com
// muitos, começa em página nova para não quebrar o cabeçalho da tabela.
const LIMITE_EXTRATO_PAGINA_NOVA = 8;
const LANCAMENTOS_POR_PAGINA = 20;

function linhasLancamentos(lancs) {
  return lancs
    .map((l) => {
      const isIn = l.tipo === 'entrada';
      const descricao = String(l.descricao || '').trim();
      const categoria = String(l.categoria || '').trim();
      const titulo = descricao || categoria || 'Lançamento';
      const mostrarCategoria = categoria && !mesmaInformacao(categoria, titulo);
      const conta = isIn
        ? (l.autor || '—')
        : [l.banco ? nomeDoBanco(l.banco) : 'Sem banco', l.autor].filter(Boolean).join(' · ');
      const forma = !isIn && l.forma_pagamento ? formaLabel(l.forma_pagamento) : '';
      return `
      <tr>
        <td class="dim">${esc(dataParaExibicao(l))}</td>
        <td class="movement">
          <div class="cell-main">${esc(titulo)}</div>
          ${mostrarCategoria ? `<div class="cell-meta">${esc(categoria)}</div>` : ''}
        </td>
        <td class="account">
          <div class="cell-main">${esc(conta)}</div>
          ${forma ? `<div class="cell-meta">${esc(forma)}</div>` : ''}
        </td>
        <td class="r amount"><b class="${isIn ? 'pos' : 'neg'}">${isIn ? '+' : '−'} ${reais(l.valor)}</b></td>
      </tr>`;
    })
    .join('');
}

function sectionExtrato(
  lancs,
  { paginaNova = lancs.length > LIMITE_EXTRATO_PAGINA_NOVA, compacto = false } = {}
) {
  if (!lancs.length) return '';
  const partes = [];
  for (let i = 0; i < lancs.length; i += LANCAMENTOS_POR_PAGINA) {
    partes.push(lancs.slice(i, i + LANCAMENTOS_POR_PAGINA));
  }
  // Um apêndice longo sempre começa em folha própria. Assim cada continuação
  // tem margens e cabeçalho previsíveis, independentemente do Chromium usado.
  const primeiraEmPaginaNova = paginaNova || partes.length > 1;
  return partes.map((parte, indice) => {
    const inicio = indice * LANCAMENTOS_POR_PAGINA;
    return `
    <section class="block ledger${(indice > 0 || primeiraEmPaginaNova) ? ' ledger-page' : ''}${compacto ? ' ledger-compact' : ''}">
      <div class="ledger-kicker">Extrato do período${indice ? ' · continuação' : ''}</div>
      <h2>Movimentações <span class="count">${indice ? `${inicio + 1}–${inicio + parte.length} de ` : ''}${lancs.length}</span></h2>
      <table class="tbl tbl-detail">
        <thead><tr><th>Data</th><th>Lançamento</th><th>Conta</th><th class="r">Valor</th></tr></thead>
        <tbody>${linhasLancamentos(parte)}</tbody>
      </table>
    </section>`;
  }).join('');
}

// ================= Relatório MENSAL =================

export function buildReportHtml(month, { parcial = false } = {}) {
  const [ano, mes] = month.key.split('-');
  const nomeMes = MESES[Number(mes) - 1];
  const lancs = month.lancamentos || [];
  const entradas = lancs.filter((l) => l.tipo === 'entrada');
  const saidas = lancs.filter((l) => l.tipo === 'saida');

  const badge = parcial
    ? `<span class="badge">Parcial · até ${new Date().toLocaleDateString('pt-BR')}</span>`
    : `<span class="badge">Fechamento do mês</span>`;

  const hero = heroBlock({ periodo: `${nomeMes} <b>${ano}</b>`, badge });
  const kpis = kpisBlock(soma(entradas), soma(saidas), {
    legenda: 'no mês',
    saldoSub: (soma(entradas) - soma(saidas)) >= 0 ? 'sobrou este mês' : 'ficou negativo',
  });

  const body = `<div class="report">${hero}${kpis}${sectionPessoa(entradas, saidas)}${sectionCategoria(saidas)}${sectionBanco(saidas)}${sectionExtrato(lancs)}${foot()}</div>`;
  return { html: body };
}

// ================= Relatório ANUAL =================
// yearData = { year, months: { 'YYYY-MM': monthObj }, lancamentos: [...] }

export function buildAnnualReportHtml(yearData, { parcial = false } = {}) {
  const { year } = yearData;
  const lancs = yearData.lancamentos || [];
  const entradas = lancs.filter((l) => l.tipo === 'entrada');
  const saidas = lancs.filter((l) => l.tipo === 'saida');

  const badge = parcial
    ? `<span class="badge">Parcial · até ${new Date().toLocaleDateString('pt-BR')}</span>`
    : `<span class="badge">Fechamento do ano</span>`;

  const hero = heroBlock({ periodo: `Ano <b>${year}</b>`, badge });
  const kpis = kpisBlock(soma(entradas), soma(saidas), {
    legenda: 'no ano',
    saldoSub: (soma(entradas) - soma(saidas)) >= 0 ? 'sobrou no ano' : 'ficou negativo no ano',
  });

  // ---- Mês a mês: linhas só dos meses com movimento, com barra de saldo ----
  const linhasMes = [];
  let maxAbs = 1;
  for (let m = 1; m <= 12; m++) {
    const mk = `${year}-${String(m).padStart(2, '0')}`;
    const ls = (yearData.months?.[mk]?.lancamentos) || [];
    if (!ls.length) continue;
    const e = soma(ls.filter((l) => l.tipo === 'entrada'));
    const s = soma(ls.filter((l) => l.tipo === 'saida'));
    linhasMes.push({ m, e, s, saldo: e - s });
    maxAbs = Math.max(maxAbs, Math.abs(e - s));
  }
  const mesRows = linhasMes
    .map(({ m, e, s, saldo }) => {
      const pos = saldo >= 0;
      const w = Math.max(2, (Math.abs(saldo) / maxAbs) * 100);
      return `
      <div class="month-row">
        <div class="month-name">${MESES_ABR[m - 1]}</div>
        <div class="month-bar"><div class="mb-fill ${pos ? 'mb-pos' : 'mb-neg'}" style="width:${w.toFixed(1)}%"></div></div>
        <div class="month-num pos">${money(e)}</div>
        <div class="month-num neg">${money(s)}</div>
        <div class="month-num"><b class="${pos ? 'pos' : 'neg'}">${moneySinal(saldo)}</b></div>
      </div>`;
    })
    .join('');

  const totE = soma(entradas);
  const totS = soma(saidas);
  const secMes = linhasMes.length
    ? `
  <section class="block">
    <h2>Mês a mês</h2>
    <div class="months">
      <div class="month-row month-head">
        <div class="month-name">Mês</div><div class="month-bar">Saldo</div>
        <div class="month-num">Entradas</div><div class="month-num">Saídas</div><div class="month-num">Saldo</div>
      </div>
      ${mesRows}
      <div class="month-row month-total">
        <div class="month-name">Ano</div><div class="month-bar"></div>
        <div class="month-num pos">${money(totE)}</div>
        <div class="month-num neg">${money(totS)}</div>
        <div class="month-num"><b class="${totE - totS >= 0 ? 'pos' : 'neg'}">${moneySinal(totE - totS)}</b></div>
      </div>
    </div>
  </section>`
    : '';

  const mediaMes = linhasMes.length ? (totS / linhasMes.length) : 0;
  const secMedia = linhasMes.length
    ? `<section class="block"><p class="note">Média de gastos por mês (com movimento): <b>${reais(mediaMes)}</b> · ${linhasMes.length} ${linhasMes.length === 1 ? 'mês' : 'meses'} com lançamentos.</p></section>`
    : '';

  // No anual o extrato é um apêndice longo: flui a partir de onde o conteúdo
  // termina, sem forçar página nova (evita páginas quase vazias no meio).
  const body = `<div class="report">${hero}${kpis}${secMes}${secMedia}${sectionPessoa(entradas, saidas)}${sectionCategoria(saidas)}${sectionBanco(saidas)}${sectionExtrato(lancs, { paginaNova: false, compacto: true })}${foot({ compacto: true })}</div>`;
  return { html: body };
}
