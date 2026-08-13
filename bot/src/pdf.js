// Renderiza o HTML do relatório em PDF (A4) via Chromium headless.
// O CSS de design vive aqui (fonte única de estilo do relatório).
//
// Direção visual: editorial sofisticado — Fraunces (serifada) para títulos e
// números grandes, Inter para texto e dados, ambas variáveis e embutidas no
// PDF via @font-face (arquivos OFL em assets/fonts). Cor chapada, zero
// gradiente, linhas finas; um acento só (verde-floresta).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { reportsDir } from './store.js';

// Resolve em relação a este módulo: funciona no repo (bot/assets/fonts) e no
// container (/app/assets/fonts) sem variável de ambiente extra.
const fontsDir = fileURLToPath(new URL('../assets/fonts/', import.meta.url));

const css = `
  @font-face {
    font-family: 'Inter';
    src: url('file://${fontsDir}Inter.ttf') format('truetype');
    font-weight: 100 900;
  }
  @font-face {
    font-family: 'Fraunces';
    src: url('file://${fontsDir}Fraunces.ttf') format('truetype');
    font-weight: 100 900;
  }

  :root {
    --ink: #1c1a16; --muted: #6e685c; --faint: #a8a293;
    --line: #e6e1d6; --panel: #f6f4ee; --surface: #ffffff;
    --pos: #22683f; --neg: #b23a26;
    --brand: #1e4d3f; --brand-track: #eceee7;
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* A capa usa sangria total; páginas seguintes ganham respiro para que tabelas
     longas nunca encostem ou sejam cortadas nos limites físicos da folha. */
  @page { size: A4; margin: 8mm 0; }
  @page :first { margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', Helvetica, Arial, sans-serif;
    color: var(--ink); font-size: 12px; line-height: 1.45;
    background: var(--surface);
    font-variant-numeric: tabular-nums;
  }
  .report { padding-bottom: 20px; }
  .r { text-align: right; }
  .pos { color: var(--pos); }
  .neg { color: var(--neg); }
  .dim { color: var(--muted); }

  /* Hero — chapado, sem gradiente; título em serifada */
  .hero {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 34px 40px 30px;
    background: var(--brand);
    color: #fff;
  }
  .eyebrow { text-transform: uppercase; letter-spacing: .18em; font-size: 9.5px; font-weight: 600; opacity: .75; }
  .hero h1 {
    font-family: 'Fraunces', Georgia, serif;
    margin: 8px 0 0; font-size: 34px; font-weight: 560; letter-spacing: 0;
    font-variation-settings: "opsz" 40;
  }
  .hero h1 .amp { opacity: .55; font-weight: 400; font-style: italic; margin: 0 5px; }
  .hero-right { text-align: right; }
  .period { font-family: 'Fraunces', Georgia, serif; font-size: 20px; font-weight: 400; }
  .period b { font-weight: 640; }
  .badge {
    display: inline-block; margin-top: 10px; padding: 4px 10px; border-radius: 3px;
    font-size: 9.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    color: #fff; border: 1px solid rgba(255,255,255,.42);
  }

  /* KPIs — cartões com borda fina, sem sombra; valor em serifada */
  .kpis { display: flex; gap: 14px; padding: 0 40px; margin-top: -18px; }
  .kpi {
    flex: 1; background: var(--surface); border: 1px solid var(--line);
    border-radius: 6px; padding: 14px 16px 13px;
  }
  .kpi-label { text-transform: uppercase; letter-spacing: .1em; font-size: 9.5px; font-weight: 600; color: var(--faint); }
  .kpi-value {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 25px; font-weight: 600; margin-top: 4px;
    font-variation-settings: "opsz" 40;
  }
  .kpi-sub { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
  .kpi-balance { color: #fff; border: none; }
  .kpi-balance .kpi-label, .kpi-balance .kpi-sub { color: rgba(255,255,255,.82); }
  .kpi-balance.is-pos { background: var(--pos); }
  .kpi-balance.is-neg { background: var(--neg); }
  .kpi-balance .kpi-value { color: #fff; }

  /* Blocos / seções */
  .block { padding: 24px 40px 0; break-inside: avoid; }
  .block h2 {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em;
    color: var(--ink); margin: 0 0 12px; padding-bottom: 7px;
    border-bottom: 1px solid var(--ink);
  }
  .block h2 .count {
    font-size: 11px; color: var(--muted); margin-left: 6px; letter-spacing: 0;
    font-weight: 500; text-transform: none;
  }

  /* Por pessoa */
  .people { display: flex; gap: 14px; }
  .person {
    flex: 1; background: var(--surface); border: 1px solid var(--line);
    border-left: 3px solid var(--accent); border-radius: 6px; padding: 12px 15px;
  }
  .person-head {
    font-family: 'Fraunces', Georgia, serif; font-size: 16px; font-weight: 600;
    display: flex; align-items: center; margin-bottom: 8px;
  }
  .person-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-right: 8px; }
  .person-line { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; font-size: 12px; }
  .person-line span { color: var(--muted); }
  .person-saldo { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 7px; font-size: 13px; }
  .person-saldo span { color: var(--ink); font-weight: 600; }
  .person-saldo b { font-weight: 700; }

  /* Barras de categoria — finas, chapadas, quase retas */
  .bars { display: flex; flex-direction: column; gap: 10px; }
  .bar-row { display: grid; grid-template-columns: minmax(0, 170px) 1fr 110px; align-items: center; gap: 12px; }
  .bar-label { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { height: 10px; background: var(--brand-track); border-radius: 2px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--brand); border-radius: 2px; }
  .bar-val { text-align: right; font-size: 12px; }
  .bar-val b { font-weight: 700; }
  .bar-val span { color: var(--faint); margin-left: 6px; font-size: 11px; }

  /* Mês a mês (anual) */
  .months { display: flex; flex-direction: column; gap: 7px; }
  .month-row { display: grid; grid-template-columns: 44px 1fr 96px 96px 108px; align-items: center; gap: 12px; font-size: 12px; }
  .month-head { font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 700; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
  .month-head .month-num { text-align: right; }
  .month-name { font-weight: 600; }
  .month-bar { height: 9px; background: var(--panel); border-radius: 2px; overflow: hidden; }
  .mb-fill { height: 100%; border-radius: 2px; }
  .mb-pos { background: var(--pos); }
  .mb-neg { background: var(--neg); }
  .month-num { text-align: right; }
  .month-total { border-top: 1px solid var(--ink); margin-top: 3px; padding-top: 7px; font-weight: 700; }
  .month-total .month-name { font-weight: 700; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .note b { color: var(--ink); }

  /* Tabelas */
  .tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .tbl th {
    text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); font-weight: 700; padding: 7px 10px; border-bottom: 1px solid var(--ink);
  }
  .tbl td { padding: 7px 10px; border-bottom: 1px solid var(--line); }
  .tbl tbody tr:nth-child(2n) { background: var(--panel); }
  .tbl .r { text-align: right; }
  .tbl-detail { font-size: 11px; table-layout: fixed; }
  .tbl-detail thead { display: table-header-group; }
  .tbl-detail tr { break-inside: avoid; page-break-inside: avoid; }
  .tbl-detail th:nth-child(1), .tbl-detail td:nth-child(1) { width: 12%; }
  .tbl-detail th:nth-child(2), .tbl-detail td:nth-child(2) { width: 38%; }
  .tbl-detail th:nth-child(3), .tbl-detail td:nth-child(3) { width: 32%; }
  .tbl-detail th:nth-child(4), .tbl-detail td:nth-child(4) { width: 18%; }
  .tbl-detail td { padding-top: 6px; padding-bottom: 6px; }
  .ledger-compact .tbl-detail td { padding-top: 5px; padding-bottom: 5px; }
  .cell-main { color: var(--ink); font-weight: 600; }
  .cell-meta { color: var(--muted); font-size: 10px; margin-top: 1px; }
  .amount { white-space: nowrap; font-size: 11.5px; }
  .ledger { break-inside: auto; }
  .ledger-page {
    break-before: page; page-break-before: always;
    padding-top: 10px;
  }
  .block h2, .ledger-kicker { break-after: avoid; page-break-after: avoid; }
  .ledger-kicker {
    color: var(--brand); font-size: 9.5px; font-weight: 700; letter-spacing: .18em;
    text-transform: uppercase; margin-bottom: 5px;
  }
  .bank-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: baseline; }

  .foot { margin: 18px 40px 0; padding-top: 10px; border-top: 1px solid var(--line);
    font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); text-align: center; }
  .foot-compact { margin-top: 4px; padding-top: 5px; font-size: 8px; }
`;

// Renderiza o corpo HTML do relatório em PDF e devolve o caminho do arquivo.
export function renderPdf(bodyHtml, baseName) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${baseName}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;

  const htmlFile = path.join(reportsDir, `${baseName}.html`);
  const pdfFile = path.join(reportsDir, `${baseName}.pdf`);
  fs.writeFileSync(htmlFile, html);

  try {
    execSync(
      `"${config.chromiumPath}" --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfFile}" "file://${htmlFile}"`,
      { stdio: 'pipe', timeout: 60_000 }
    );
  } finally {
    try { fs.unlinkSync(htmlFile); } catch {}
  }
  return pdfFile;
}
