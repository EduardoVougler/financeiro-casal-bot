import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  dataParaExibicao,
  formatDateBr,
  mesDoLancamento,
  normalizarData,
} from '../src/dates.js';
import { applyDono, normalizeCategoria, resolveBanco, resolvePessoa } from '../src/domain.js';
import { buildReportHtml } from '../src/report.js';

const agora = new Date(2026, 7, 13, 12, 0, 0);

test('materializa hoje e datas ausentes como DD/MM concreto', () => {
  assert.equal(formatDateBr(agora), '13/08');
  assert.equal(normalizarData('hoje', agora), '13/08');
  assert.equal(normalizarData('', agora), '13/08');
  assert.equal(normalizarData('5/8', agora), '05/08');
  assert.equal(normalizarData('5-8-25', agora), '05/08/2025');
});

test('recupera a data de registros antigos salvos como hoje', () => {
  const registrado = new Date(2026, 6, 31, 10, 30, 0).toISOString();
  assert.equal(dataParaExibicao({ data: 'hoje', registrado_em: registrado }), '31/07');
});

test('competência tem precedência sobre data ao escolher arquivo mensal', () => {
  assert.equal(mesDoLancamento({ competencia: '2026-09', data: '13/08' }, agora), '2026-09');
  assert.equal(mesDoLancamento({ data: '02/07/2025' }, agora), '2025-07');
  assert.equal(mesDoLancamento({ data: 'hoje' }, agora), '2026-08');
});

test('normaliza aliases centrais do domínio', () => {
  assert.equal(resolvePessoa('Duda'), 'Maria');
  assert.equal(resolveBanco('Banco do Brasil'), 'bb');
  assert.equal(normalizeCategoria('supermercado'), 'Mercado');
  assert.equal(normalizeCategoria('SAÚDE', ['Saúde']), 'Saúde');
});

test('banco não determina titular e aceita instituições novas', () => {
  assert.deepEqual(
    applyDono({ banco: 'Nubank', autor: 'Eduardo' }, 'Maria'),
    { banco: 'nubank', autor: 'Eduardo' }
  );
  assert.deepEqual(
    applyDono({ banco: 'Nubank', autor: null }, 'Eduardo'),
    { banco: 'nubank', autor: 'Eduardo' }
  );
  assert.deepEqual(
    applyDono({ banco: 'Nubank', autor: null }, 'Maria'),
    { banco: 'nubank', autor: 'Maria' }
  );
  assert.equal(resolveBanco('c6 bank', ['C6 Bank']), 'C6 Bank');
  assert.equal(resolveBanco('Itaú'), 'Itaú');
});

test('relatório separa contas do mesmo banco por titular e inclui banco novo', () => {
  const { html } = buildReportHtml({
    key: '2026-08',
    lancamentos: [
      { tipo: 'saida', valor: 100, categoria: 'Fatura', autor: 'Eduardo', banco: 'nubank', forma_pagamento: 'credito', data: '01/08' },
      { tipo: 'saida', valor: 200, categoria: 'Fatura', autor: 'Maria', banco: 'nubank', forma_pagamento: 'credito', data: '01/08' },
      { tipo: 'saida', valor: 50, categoria: 'Mercado', autor: 'Eduardo', banco: 'C6 Bank', forma_pagamento: 'debito', data: '02/08' },
    ],
  });
  assert.equal((html.match(/<td><span class="bank-dot"[^>]*><\/span>Nubank<\/td>/g) || []).length, 2);
  assert.match(html, /<td>Eduardo<\/td>[\s\S]*?100,00/);
  assert.match(html, /<td>Maria<\/td>[\s\S]*?200,00/);
  assert.match(html, /C6 Bank/);
});

test('extrato mensal é compacto, sinaliza tipo pelo valor e não duplica categoria', () => {
  const { html } = buildReportHtml({
    key: '2026-08',
    lancamentos: [
      { tipo: 'saida', valor: 42, categoria: 'Mercado', descricao: 'Mercado', autor: 'Eduardo', banco: 'nubank', forma_pagamento: 'credito', data: '03/08' },
      { tipo: 'entrada', valor: 1000, categoria: 'Freela', descricao: 'Site do cliente', autor: 'Maria', data: '04/08' },
    ],
  });
  const extrato = html.slice(html.indexOf('ledger-page'));
  assert.match(extrato, /<th>Data<\/th><th>Lançamento<\/th><th>Conta<\/th><th class="r">Valor<\/th>/);
  assert.doesNotMatch(extrato, /<th>Tipo<\/th>|<th>Pessoa<\/th>|<th>Categoria<\/th>|<th>Descrição<\/th>/);
  assert.equal((extrato.match(/>Mercado</g) || []).length, 1);
  assert.match(extrato, /Nubank · Eduardo/);
  assert.match(extrato, /Crédito/);
  assert.match(extrato, /− R\$ 42,00/);
  assert.match(extrato, /\+ R\$ 1\.000,00/);
  assert.match(extrato, /Site do cliente[\s\S]*?Freela/);
});

test('relatório mostra a data recuperada, nunca a palavra hoje', () => {
  const registrado = new Date(2026, 7, 9, 10, 0, 0).toISOString();
  const { html } = buildReportHtml({
    key: '2026-08',
    lancamentos: [{
      tipo: 'saida', valor: 10, categoria: 'Mercado', autor: 'Maria',
      banco: 'nubank', forma_pagamento: 'debito', data: 'hoje', registrado_em: registrado,
    }],
  });
  assert.match(html, />09\/08</);
  assert.doesNotMatch(html, />hoje</i);
});

test('configuração recusa lista vazia de usuários autorizados', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "import('./src/config.js')"],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        TELEGRAM_TOKEN: 'teste',
        ANTHROPIC_API_KEY: 'teste',
        ALLOWED_CHAT_IDS: '',
      },
      encoding: 'utf8',
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ALLOWED_CHAT_IDS/);
});

test('store grava atomicamente, mantém backup e não duplica id', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'financeiro-casal-test-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  process.env.TELEGRAM_TOKEN = 'teste';
  process.env.ANTHROPIC_API_KEY = 'teste';
  process.env.ALLOWED_CHAT_IDS = '1,2';
  process.env.DATA_DIR = dataDir;

  const store = await import('../src/store.js');
  store.saveState({ offset: 10, pending: {}, schedule: {} });
  store.saveState({ offset: 11, pending: {}, schedule: {} });

  const statePath = path.join(dataDir, 'state.json');
  assert.ok(fs.existsSync(`${statePath}.bak`));
  fs.writeFileSync(statePath, '{json interrompido');
  assert.equal(store.loadState().offset, 10);

  const lancamento = { id: 'id-fixo', tipo: 'saida', valor: 20, categoria: 'Uber', data: '13/08' };
  store.addLancamento(lancamento, '2026-08');
  store.addLancamento(lancamento, '2026-08');
  assert.equal(store.loadMonth('2026-08').lancamentos.length, 1);
  store.addLancamento({ ...lancamento, id: 'c6', banco: 'C6 Bank' }, '2026-08');
  assert.deepEqual(store.bancosUsados(), ['C6 Bank']);
});
