// Bot financeiro do casal — loop principal (long-polling), confirmação de lançamentos
// (texto/áudio/foto) e agendador do fechamento mensal.

import { config } from './config.js';
import * as tg from './telegram.js';
import * as store from './store.js';
import { readFromText, readFromImage, applyCorrection, applyDono } from './extract.js';
import { transcribe } from './transcribe.js';
import { nomeDoBanco } from './domain.js';
import { buildReportHtml, buildAnnualReportHtml } from './report.js';
import { renderPdf } from './pdf.js';

let state = store.loadState();

// Nome da pessoa a partir do chat id (fallback quando o gasto não tem banco).
function autorDoChat(chatId) {
  const idx = config.allowedChatIds.indexOf(String(chatId));
  // Convenção: 1º chat autorizado = Eduardo, 2º = Maria (ajuste em ALLOWED_CHAT_IDS).
  return idx === 1 ? 'Maria' : 'Eduardo';
}

function isAllowed(chatId) {
  if (!config.allowedChatIds.length) return true;
  return config.allowedChatIds.includes(String(chatId));
}

function br(n) {
  return n === null || n === undefined
    ? '—'
    : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function resumo(l) {
  const linhas = [
    `📝 Li este lançamento:`,
    ``,
    `• Tipo: ${l.tipo === 'entrada' ? 'Entrada (recebimento)' : 'Saída (gasto)'}`,
    `• Valor: R$ ${br(l.valor)}`,
    `• Categoria: ${l.categoria || '—'}`,
    `• Pessoa: ${l.autor || '—'}`,
  ];
  if (l.tipo === 'saida') {
    linhas.push(`• Banco: ${l.banco ? nomeDoBanco(l.banco) : '—'}`);
    linhas.push(`• Forma: ${l.forma_pagamento || '—'}`);
  }
  linhas.push(`• Data: ${l.data || 'hoje'}`);
  if (l.descricao) linhas.push(`• Descrição: ${l.descricao}`);
  if (l.observacao) linhas.push(`⚠️ ${l.observacao}`);
  linhas.push(
    ``,
    `Confirma? Responda *SIM* para gravar, ou escreva a correção (ex.: "foi no débito", "valor é 154,90").`
  );
  return linhas.join('\n');
}

const AJUDA = [
  '💰 *Financeiro do Casal*',
  '',
  'Mande o lançamento por *texto*, *áudio* ou *foto* do comprovante — eu leio, mostro os dados e peço confirmação antes de gravar.',
  'Ex.: "gastei 154,90 no mercado no crédito do Nubank" ou "recebi 3000 de salário".',
  '',
  'Comandos:',
  '/relatorio — PDF parcial do mês atual',
  '/fechar — PDF de fechamento do mês passado',
  '/anual — PDF do ano atual (parcial)',
  '/cancelar — descarta a confirmação pendente',
  '/ajuda — mostra esta ajuda',
].join('\n');

async function gerarEnviar(chatId, monthKeyStr, { parcial }) {
  const month = store.loadMonth(monthKeyStr);
  if (!month.lancamentos.length) {
    await tg.sendMessage(chatId, `Não há lançamentos para ${monthKeyStr} ainda.`);
    return;
  }
  await tg.sendChatAction(chatId, 'upload_document');
  const { html } = buildReportHtml(month, { parcial });
  const base = `relatorio-${monthKeyStr}${parcial ? '-parcial' : ''}`;
  const pdf = renderPdf(html, base);
  await tg.sendDocument(chatId, pdf, `Relatório ${parcial ? 'parcial' : 'de fechamento'} — ${monthKeyStr}`);
}

async function gerarEnviarAnual(chatId, yearStr, { parcial }) {
  const yearData = store.loadYear(yearStr);
  if (!yearData.lancamentos.length) {
    await tg.sendMessage(chatId, `Não há lançamentos em ${yearStr} ainda.`);
    return;
  }
  await tg.sendChatAction(chatId, 'upload_document');
  const { html } = buildAnnualReportHtml(yearData, { parcial });
  const base = `relatorio-anual-${yearStr}${parcial ? '-parcial' : ''}`;
  const pdf = renderPdf(html, base);
  await tg.sendDocument(chatId, pdf, `Relatório anual ${parcial ? 'parcial' : 'de fechamento'} — ${yearStr}`);
}

// Recebeu um lançamento lido (de texto/áudio/foto): deriva dono e pede confirmação.
async function proporLancamento(chatId, lidoBruto, origem) {
  const l = applyDono({ ...lidoBruto, origem }, autorDoChat(chatId));
  state.pending[chatId] = l;
  store.saveState(state);
  await tg.sendMessage(chatId, resumo(l));
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) {
    await tg.sendMessage(chatId, 'Desculpe, este bot é de uso restrito.');
    return;
  }

  // Foto → ler comprovante.
  if (msg.photo) {
    await tg.sendChatAction(chatId, 'typing');
    try {
      const best = msg.photo[msg.photo.length - 1]; // maior resolução
      const { buffer, mime } = await tg.downloadFile(best.file_id, 'image/jpeg');
      const lido = await readFromImage(buffer, mime);
      await proporLancamento(chatId, lido, 'foto');
    } catch (e) {
      await tg.sendMessage(chatId, `❌ Não consegui ler a foto: ${e.message}`);
    }
    return;
  }

  // Áudio (voice note ou arquivo de áudio) → transcrever → ler.
  const audio = msg.voice || msg.audio;
  if (audio) {
    await tg.sendChatAction(chatId, 'typing');
    try {
      const { buffer, mime } = await tg.downloadFile(audio.file_id, 'audio/ogg');
      const texto = await transcribe(buffer, mime);
      const lido = await readFromText(texto);
      await proporLancamento(chatId, lido, 'audio');
    } catch (e) {
      await tg.sendMessage(chatId, `❌ Áudio: ${e.message}`);
    }
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  // Comandos.
  if (text.startsWith('/')) {
    const [cmd] = text.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case '/start':
      case '/ajuda':
        await tg.sendMessage(chatId, AJUDA);
        return;
      case '/relatorio':
        await gerarEnviar(chatId, store.monthKey(), { parcial: true });
        return;
      case '/fechar':
        await gerarEnviar(chatId, store.previousMonthKey(), { parcial: false });
        return;
      case '/anual':
        await gerarEnviarAnual(chatId, store.yearKey(), { parcial: true });
        return;
      case '/cancelar':
        delete state.pending[chatId];
        store.saveState(state);
        await tg.sendMessage(chatId, 'Confirmação pendente descartada.');
        return;
      default:
        await tg.sendMessage(chatId, 'Comando não reconhecido. /ajuda para ver as opções.');
        return;
    }
  }

  // Resposta a uma confirmação pendente.
  const pending = state.pending[chatId];
  if (pending) {
    if (/^(sim|s|ok|confirmo?|confirmar|👍|✅)$/i.test(text)) {
      store.addLancamento(pending, store.monthKey());
      delete state.pending[chatId];
      store.saveState(state);
      await tg.sendMessage(chatId, '✅ Lançamento gravado. Pode mandar o próximo!');
    } else {
      // Correção em linguagem natural.
      await tg.sendChatAction(chatId, 'typing');
      try {
        const corrigido = applyDono(await applyCorrection(pending, text), autorDoChat(chatId));
        state.pending[chatId] = { ...corrigido, origem: pending.origem };
        store.saveState(state);
        await tg.sendMessage(chatId, resumo(state.pending[chatId]));
      } catch (e) {
        await tg.sendMessage(chatId, `❌ Não consegui aplicar a correção: ${e.message}`);
      }
    }
    return;
  }

  // Texto solto → tratar como novo lançamento.
  await tg.sendChatAction(chatId, 'typing');
  try {
    const lido = await readFromText(text);
    await proporLancamento(chatId, lido, 'texto');
  } catch (e) {
    await tg.sendMessage(chatId, `❌ Não entendi o lançamento: ${e.message}. Use /ajuda.`);
  }
}

// ---- Agendador: fechamento mensal (dia X às HH fecha o mês anterior) ----
async function tickSchedule() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hour = now.getHours();
  const chat = config.reportChatId;
  if (!chat) return;

  if (now.getDate() === config.monthlyDay && hour === config.monthlyHour && state.schedule.monthly !== today) {
    state.schedule.monthly = today;
    store.saveState(state);
    try {
      await gerarEnviar(chat, store.previousMonthKey(), { parcial: false });
    } catch (e) {
      console.error('[schedule] mensal:', e.message);
    }
  }

  // Anual: fecha o ano em 31/12 (mês 12, dia 31), à hora configurada.
  if (
    now.getMonth() === 11 &&
    now.getDate() === 31 &&
    hour === config.annualHour &&
    state.schedule.annual !== today
  ) {
    state.schedule.annual = today;
    store.saveState(state);
    try {
      await gerarEnviarAnual(chat, store.yearKey(), { parcial: false });
    } catch (e) {
      console.error('[schedule] anual:', e.message);
    }
  }
}

// ---- Loop principal ----
async function main() {
  console.log(`[bot] Financeiro do casal iniciado. Modelo: ${config.model}. TZ: ${config.tz}.`);
  console.log(`[bot] Chats autorizados: ${config.allowedChatIds.join(', ') || '(todos)'}`);
  setInterval(() => tickSchedule().catch((e) => console.error('[tick]', e.message)), 60 * 1000);

  while (true) {
    try {
      const updates = await tg.getUpdates(state.offset + 1, 30);
      for (const u of updates) {
        state.offset = u.update_id;
        store.saveState(state);
        if (u.message) {
          try {
            await handleMessage(u.message);
          } catch (e) {
            console.error('[handleMessage]', e);
          }
        }
      }
    } catch (e) {
      console.error('[getUpdates]', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
