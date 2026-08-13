// Persistência simples em arquivos JSON no volume /data.
// - state.json: offset do getUpdates, confirmações pendentes, marcadores de agendamento.
// - months/<YYYY-MM>.json: todos os lançamentos (entradas e saídas) do mês.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  } catch (erro) {
    if (erro.code === 'ENOENT') return fallback;

    // Uma escrita anterior mantém a última versão válida em .bak. Recuperar
    // desse arquivo é seguro; fingir que um JSON corrompido está vazio não é.
    const backup = `${file}.bak`;
    try {
      const recuperado = JSON.parse(fs.readFileSync(backup, 'utf8'));
      console.warn(`[store] ${file} inválido; usando backup ${backup}: ${erro.message}`);
      return recuperado;
    } catch {
      throw new Error(`Não foi possível ler ${file}: ${erro.message}`);
    }
  }
}

function writeJson(file, obj) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });

    // Só substitui o backup quando o arquivo atual é JSON válido. Assim uma
    // corrupção preexistente não destrói também a última cópia recuperável.
    if (fs.existsSync(file)) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.copyFileSync(file, `${file}.bak`);
      } catch {
        // Mantém o .bak anterior.
      }
    }
    fs.renameSync(temp, file);
  } catch (erro) {
    try { fs.unlinkSync(temp); } catch {}
    throw erro;
  }
}

// ---- Estado global ----
export function loadState() {
  const state = readJson(statePath, { offset: 0, pending: {}, schedule: {} });
  return {
    ...state,
    offset: Number.isInteger(state.offset) ? state.offset : 0,
    pending: state.pending && typeof state.pending === 'object' ? state.pending : {},
    schedule: state.schedule && typeof state.schedule === 'object' ? state.schedule : {},
  };
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

// Vocabulário vivo de categorias: as que o casal JÁ usou, por tipo, mais usadas
// primeiro. É o que permite deixar a categorização aberta sem virar bagunça — o
// modelo recebe essa lista e reusa a grafia existente em vez de criar um sinônimo.
export function categoriasUsadas() {
  const contagem = { saida: new Map(), entrada: new Map() };
  let arquivos = [];
  try {
    arquivos = fs.readdirSync(monthsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return { saida: [], entrada: [] };
  }
  for (const f of arquivos) {
    const mes = readJson(path.join(monthsDir, f), { lancamentos: [] });
    for (const l of mes.lancamentos || []) {
      const cat = String(l.categoria || '').trim();
      if (!cat) continue;
      const m = contagem[l.tipo === 'entrada' ? 'entrada' : 'saida'];
      m.set(cat, (m.get(cat) || 0) + 1);
    }
  }
  const porFrequencia = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { saida: porFrequencia(contagem.saida), entrada: porFrequencia(contagem.entrada) };
}

// Vocabulário aberto de bancos, mais usados primeiro. Mantém bancos novos
// consistentes sem exigir alteração em domain.js ou novo deploy.
export function bancosUsados() {
  const contagem = new Map();
  let arquivos = [];
  try {
    arquivos = fs.readdirSync(monthsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  for (const f of arquivos) {
    const mes = readJson(path.join(monthsDir, f), { lancamentos: [] });
    for (const l of mes.lancamentos || []) {
      const banco = String(l.banco || '').trim();
      if (banco) contagem.set(banco, (contagem.get(banco) || 0) + 1);
    }
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
}

export function saveMonth(month) {
  writeJson(path.join(monthsDir, `${month.key}.json`), month);
}

// Todo lançamento carrega um `id` estável — é por ele que dá para editar/remover
// depois. Não pode ser a posição na lista: remover um item deslocaria todos os outros.
export function novoId() {
  return randomUUID().slice(0, 8);
}

// Adiciona um lançamento (entrada ou saída) ao mês.
export function addLancamento(lancamento, key = monthKey()) {
  const month = loadMonth(key);
  const id = lancamento.id || novoId();
  // Confirmações são reprocessáveis: se o bot cair depois de gravar o mês,
  // mas antes de avançar o offset, o mesmo SIM não duplica o lançamento.
  if (month.lancamentos.some((l) => l.id === id)) return month;
  month.lancamentos.push({ ...lancamento, id, registrado_em: new Date().toISOString() });
  saveMonth(month);
  return month;
}

// Lançamentos gravados antes dos ids ganham um na primeira leitura (migração
// preguiçosa) — sem isso eles seriam os únicos impossíveis de editar/remover.
function ensureIds(month) {
  let mudou = false;
  for (const l of month.lancamentos) {
    if (!l.id) {
      l.id = novoId();
      mudou = true;
    }
  }
  if (mudou) saveMonth(month);
  return month;
}

// Candidatos para editar/remover/listar: mais recentes primeiro, com o mês de cada um.
// Sem `meses`, olha o mês corrente + o anterior (é o que a pessoa tem em mente).
export function lancamentosRecentes({ meses, limite = 60 } = {}) {
  const chaves = meses?.length ? meses : [monthKey(), previousMonthKey()];
  const itens = [];
  for (const key of chaves) {
    const month = ensureIds(loadMonth(key));
    for (const l of [...month.lancamentos].reverse()) itens.push({ ...l, mes: key });
  }
  return itens.slice(0, limite);
}

// Substitui os campos de um lançamento, preservando id e data de registro.
export function updateLancamento(key, id, campos) {
  const month = loadMonth(key);
  const i = month.lancamentos.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const atual = month.lancamentos[i];
  month.lancamentos[i] = {
    ...atual,
    ...campos,
    id: atual.id,
    registrado_em: atual.registrado_em,
    editado_em: new Date().toISOString(),
  };
  saveMonth(month);
  return month.lancamentos[i];
}

export function removeLancamento(key, id) {
  const month = loadMonth(key);
  const i = month.lancamentos.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const [removido] = month.lancamentos.splice(i, 1);
  saveMonth(month);
  return removido;
}
