// Renderiza o HTML do relatório em PDF (A4) via Chromium headless.
// O CSS de design vive aqui (fonte única de estilo do relatório).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { config } from './config.js';
import { reportsDir } from './store.js';

const css = `
  :root {
    --ink: #1a1c23; --muted: #6b7280; --faint: #9aa1ac;
    --line: #e8eaee; --panel: #f6f7f9; --surface: #ffffff;
    --pos: #15803d; --pos-bg: #e7f6ec; --neg: #dc2626; --neg-bg: #fdeaea;
    --brand: #4f46e5; --brand-track: #ecebfb;
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: var(--ink); font-size: 12px; line-height: 1.45;
    background: var(--surface);
  }
  .report { padding-bottom: 30px; }
  .r { text-align: right; }
  .pos { color: var(--pos); }
  .neg { color: var(--neg); }
  .dim { color: var(--muted); }

  /* Hero */
  .hero {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 30px 40px 26px;
    background: linear-gradient(120deg, #4338ca 0%, #6d28d9 55%, #7c3aed 100%);
    color: #fff;
  }
  .eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: 10px; font-weight: 600; opacity: .82; }
  .hero h1 { margin: 6px 0 0; font-size: 30px; font-weight: 700; letter-spacing: -.01em; }
  .hero h1 .amp { opacity: .6; font-weight: 400; margin: 0 4px; }
  .hero-right { text-align: right; }
  .period { font-size: 18px; font-weight: 400; }
  .period b { font-weight: 700; }
  .badge {
    display: inline-block; margin-top: 8px; padding: 4px 11px; border-radius: 999px;
    font-size: 10px; font-weight: 600; letter-spacing: .02em;
    background: rgba(255,255,255,.16); color: #fff; border: 1px solid rgba(255,255,255,.28);
  }

  /* KPIs */
  .kpis { display: flex; gap: 14px; padding: 0 40px; margin-top: -20px; }
  .kpi {
    flex: 1; background: var(--surface); border: 1px solid var(--line);
    border-radius: 12px; padding: 15px 16px 14px;
    box-shadow: 0 6px 18px rgba(24,27,40,.07);
  }
  .kpi-label { text-transform: uppercase; letter-spacing: .08em; font-size: 10px; font-weight: 700; color: var(--faint); }
  .kpi-value { font-size: 23px; font-weight: 700; margin-top: 4px; letter-spacing: -.01em; }
  .kpi-sub { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
  .kpi-balance { color: #fff; border: none; }
  .kpi-balance .kpi-label, .kpi-balance .kpi-sub { color: rgba(255,255,255,.85); }
  .kpi-balance.is-pos { background: linear-gradient(135deg, #15803d, #16a34a); }
  .kpi-balance.is-neg { background: linear-gradient(135deg, #b91c1c, #dc2626); }
  .kpi-balance .kpi-value { color: #fff; }

  /* Blocos / seções */
  .block { padding: 22px 40px 0; break-inside: avoid; }
  .block h2 {
    font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
    color: var(--ink); margin: 0 0 12px; padding-bottom: 7px;
    border-bottom: 2px solid var(--line);
  }
  .block h2 .count {
    font-size: 11px; color: var(--muted); background: var(--panel);
    border-radius: 999px; padding: 1px 8px; margin-left: 6px; letter-spacing: 0;
  }

  /* Por pessoa */
  .people { display: flex; gap: 14px; }
  .person {
    flex: 1; background: var(--surface); border: 1px solid var(--line);
    border-left: 4px solid var(--accent); border-radius: 10px; padding: 12px 15px;
  }
  .person-head { font-size: 14px; font-weight: 700; display: flex; align-items: center; margin-bottom: 8px; }
  .person-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); margin-right: 8px; }
  .person-line { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; font-size: 12px; }
  .person-line span { color: var(--muted); }
  .person-saldo { border-top: 1px dashed var(--line); margin-top: 4px; padding-top: 7px; font-size: 13px; }
  .person-saldo span { color: var(--ink); font-weight: 600; }
  .person-saldo b { font-weight: 700; }

  /* Barras de categoria */
  .bars { display: flex; flex-direction: column; gap: 9px; }
  .bar-row { display: grid; grid-template-columns: 150px 1fr 110px; align-items: center; gap: 12px; }
  .bar-label { font-size: 12px; font-weight: 500; }
  .bar-track { height: 15px; background: var(--brand-track); border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #4f46e5); border-radius: 999px; }
  .bar-val { text-align: right; font-size: 12px; }
  .bar-val b { font-weight: 700; }
  .bar-val span { color: var(--faint); margin-left: 6px; font-size: 11px; }

  /* Mês a mês (anual) */
  .months { display: flex; flex-direction: column; gap: 6px; }
  .month-row { display: grid; grid-template-columns: 44px 1fr 96px 96px 108px; align-items: center; gap: 12px; font-size: 12px; }
  .month-head { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; padding-bottom: 4px; border-bottom: 1.5px solid var(--line); }
  .month-head .month-num, .month-head .month-bar { text-align: right; }
  .month-head .month-bar { text-align: left; }
  .month-name { font-weight: 600; }
  .month-bar { height: 13px; background: var(--panel); border-radius: 999px; overflow: hidden; }
  .mb-fill { height: 100%; border-radius: 999px; }
  .mb-pos { background: linear-gradient(90deg, #16a34a, #15803d); }
  .mb-neg { background: linear-gradient(90deg, #ef4444, #dc2626); }
  .month-num { text-align: right; }
  .month-total { border-top: 1.5px solid var(--line); margin-top: 3px; padding-top: 6px; font-weight: 700; }
  .month-total .month-name { font-weight: 700; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .note b { color: var(--ink); }

  /* Tabelas */
  .tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .tbl th {
    text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--muted); font-weight: 700; padding: 7px 10px; border-bottom: 1.5px solid var(--line);
  }
  .tbl td { padding: 7px 10px; border-bottom: 1px solid var(--line); }
  .tbl tbody tr:nth-child(2n) { background: var(--panel); }
  .tbl .r { text-align: right; }
  .tbl-detail { font-size: 11px; }
  .bank-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: baseline; }
  .tag {
    display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
  }
  .tag-in { color: var(--pos); background: var(--pos-bg); }
  .tag-out { color: var(--neg); background: var(--neg-bg); }

  .foot { margin: 26px 40px 0; padding-top: 12px; border-top: 1px solid var(--line);
    font-size: 10px; color: var(--faint); text-align: center; }
`;

// Renderiza o corpo HTML do relatório em PDF e devolve o caminho do arquivo.
export function renderPdf(bodyHtml, baseName) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${baseName}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;

  const htmlFile = path.join(reportsDir, `${baseName}.html`);
  const pdfFile = path.join(reportsDir, `${baseName}.pdf`);
  fs.writeFileSync(htmlFile, html);

  execSync(
    `"${config.chromiumPath}" --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfFile}" "file://${htmlFile}"`,
    { stdio: 'pipe' }
  );
  fs.unlinkSync(htmlFile);
  return pdfFile;
}
