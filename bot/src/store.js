// Persistência simples em arquivos JSON no volume /data.
// - state.json: offset do getUpdates, confirmações pendentes, marcadores de agendamento.
// - months/<YYYY-MM>.json: todos os lançamentos (entradas e saídas) do mês.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const monthsDir = path.join(config.dataDir, 'months');
const statePath = path.join(config.dataDir, 'state.json');
export const reportsDir = path.join(config.dataDir, 'reports');

function ensureDirs() {
  fs.mkdirSync(monthsDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
}
ensureDirs();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// ---- Estado global ----
export function loadState() {
  return readJson(statePath, { offset: 0, pending: {}, schedule: {} });
}

export function saveState(state) {
  writeJson(statePath, state);
}

// ---- Mês (YYYY-MM) ----
export function monthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function previousMonthKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return monthKey(d);
}

// ---- Ano (YYYY) ----
export function yearKey(date = new Date()) {
  return String(date.getFullYear());
}

// Carrega os 12 meses do ano e devolve { year, months, lancamentos } consolidado.
export function loadYear(year) {
  const months = {};
  const lancamentos = [];
  for (let m = 1; m <= 12; m++) {
    const mk = `${year}-${String(m).padStart(2, '0')}`;
    const mo = loadMonth(mk);
    months[mk] = mo;
    lancamentos.push(...mo.lancamentos);
  }
  return { year, months, lancamentos };
}

export function loadMonth(key) {
  return readJson(path.join(monthsDir, `${key}.json`), {
    key,
    lancamentos: [], // { tipo, valor, categoria, descricao, data, autor, banco, forma_pagamento, origem, observacao }
  });
}

export function saveMonth(month) {
  writeJson(path.join(monthsDir, `${month.key}.json`), month);
}

// Adiciona um lançamento (entrada ou saída) ao mês.
export function addLancamento(lancamento, key = monthKey()) {
  const month = loadMonth(key);
  month.lancamentos.push({ ...lancamento, registrado_em: new Date().toISOString() });
  saveMonth(month);
  return month;
}
