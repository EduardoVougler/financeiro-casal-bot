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

// Nome da pessoa a partir do id de quem enviou (fallback quando o gasto não tem banco).
// Em grupo recebe o from.id (a pessoa), não o id do grupo.
function autorDoChat(fromId) {
  const idx = config.allowedChatIds.indexOf(String(fromId));
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

function itemResumo(l, i, total) {
  const linhas = [total > 1 ? `${i + 1}) ${l.descricao || l.categoria || 'Lançamento'}` : ''];
  linhas.push(`• Tipo: ${l.tipo === 'entrada' ? 'Entrada (recebimento)' : 'Saída (gasto)'}`);
  linhas.push(`• Valor: R$ ${br(l.valor)}`);
  linhas.push(`• Categoria: ${l.categoria || '—'}`);
  linhas.push(`• Pessoa: ${l.autor || '—'}`);
  if (l.tipo === 'saida') {
    linhas.push(`• Banco: ${l.banco ? nomeDoBanco(l.banco) : '—'}`);
    linhas.push(`• Forma: ${l.forma_pagamento || '—'}`);
  }
  linhas.push(`• Data: ${l.data || 'hoje'}`);
  // Só destaca o mês quando não é o corrente — é o caso em que gravar errado passaria batido.
  const mes = mesDoLancamento(l);
  if (mes !== store.monthKey()) linhas.push(`• Mês: ${mes}`);
  if (total === 1 && l.descricao) linhas.push(`• Descrição: ${l.descricao}`);
  if (l.observacao) linhas.push(`⚠️ ${l.observacao}`);
  return linhas.filter(Boolean).join('\n');
}

// Uma mensagem pode gerar vários lançamentos — o resumo (e a confirmação) valem para o lote.
function resumo(lista) {
  const total = lista.length;
  const partes = [
    total === 1 ? '📝 Li este lançamento:' : `📝 Li ${total} lançamentos:`,
    ...lista.map((l, i) => itemResumo(l, i, total)),
  ];
  if (total > 1) {
    const entradas = lista.filter((l) => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0);
    const saidas = lista.filter((l) => l.tipo === 'saida').reduce((s, l) => s + l.valor, 0);
    partes.push(`Total: entradas R$ ${br(entradas)} · saídas R$ ${br(saidas)}`);
  }
  const alvo = total === 1 ? 'gravar' : `gravar os ${total}`;
  partes.push(
    `Confirma? Responda *SIM* para ${alvo}, ou escreva a correção (ex.: "o 2 é da Duda", "valor é 154,90").`
  );
  return partes.join('\n\n');
}

const AJUDA = [
  '💰 *Financeiro do Casal*',
  '',
  'Mande o lançamento por *texto*, *áudio* ou *foto* do comprovante — eu leio, mostro os dados e peço confirmação antes de gravar.',
  'Ex.: "gastei 154,90 no mercado no crédito do Nubank" ou "recebi 3000 de salário".',
  '',
  'Pode mandar *vários de uma vez*, um por linha — eu leio todos e confirmo o lote.',
  'Se a primeira linha disser o mês, ele vale para o bloco inteiro:',
  '`Informações de agosto:`',
  '`Salário escritório: recebido R$ 2800,00`',
  '`Fatura Banco do Brasil: 666,00 (Eduardo)`',
  '`809,00 (Duda)`',
  '',
  'Comandos:',
  '/relatorio — PDF do mês atual (ou passe um mês: `/relatorio 2026-08`, `/relatorio 08`, `/relatorio agosto`)',
  '/fechar — PDF de fechamento do mês passado (também aceita um mês: `/fechar 2026-08`)',
  '/anual — PDF do ano atual (ou passe o ano: `/anual 2025`)',
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

const MESES = {
  janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function normMonth(y, mo) {
  if (mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

// Interpreta o argumento de mês de /relatorio e /fechar. Aceita:
//   "2026-08" | "2026/8" | "08" | "8" (ano corrente) | "agosto" | "agosto de 2025".
// Devolve a chave "YYYY-MM" ou null se não reconhecer.
function parseMonthArg(arg) {
  const s = arg.trim().toLowerCase();
  const anoAtual = new Date().getFullYear();
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return normMonth(+m[1], +m[2]);
  m = s.match(/^([a-zç]+)(?:\s+de\s+(\d{4}))?$/);
  if (m && MESES[m[1]] != null) return normMonth(m[2] ? +m[2] : anoAtual, MESES[m[1]]);
  m = s.match(/^(\d{1,2})$/);
  if (m) return normMonth(anoAtual, +m[1]);
  return null;
}

// Mês de destino, em ordem: competência declarada no cabeçalho ("informações de
// agosto") > data do próprio lançamento (DD/MM) > mês atual. Sem isso, um bloco
// enviado em 31/07 referente a agosto cairia todo em julho.
function mesDoLancamento(l) {
  const c = String(l.competencia || '').match(/^(\d{4})-(\d{2})$/);
  if (c && +c[2] >= 1 && +c[2] <= 12) return `${c[1]}-${c[2]}`;
  const m = String(l.data || '').match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!m) return store.monthKey();
  const mes = +m[2];
  if (mes < 1 || mes > 12) return store.monthKey();
  let ano = m[3] ? +m[3] : new Date().getFullYear();
  if (ano < 100) ano += 2000;
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

// Recebeu os lançamentos lidos (de texto/áudio/foto): deriva dono e pede confirmação.
// Uma mensagem pode trazer vários — a confirmação é do lote inteiro.
// chatId = onde responder (grupo ou privado); fromId = quem enviou (autor + chave da confirmação).
async function proporLancamentos(chatId, fromId, lidosBrutos, origem) {
  const lista = lidosBrutos.map((l) => applyDono({ ...l, origem }, autorDoChat(fromId)));
  state.pending[fromId] = lista;
  store.saveState(state);
  await tg.sendMessage(chatId, resumo(lista));
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;          // onde responder (grupo ou privado)
  const fromId = msg.from?.id ?? chatId; // quem enviou (autor + autorização + confirmação)
  // Em grupo, autoriza por PESSOA (from.id), não pelo id do grupo.
  if (!isAllowed(fromId)) {
    await tg.sendMessage(chatId, 'Desculpe, este bot é de uso restrito.');
    return;
  }

  // Foto → ler comprovante.
  if (msg.photo) {
    await tg.sendChatAction(chatId, 'typing');
    try {
      const best = msg.photo[msg.photo.length - 1]; // maior resolução
      const { buffer, mime } = await tg.downloadFile(best.file_id, 'image/jpeg');
      const lidos = await readFromImage(buffer, mime);
      await proporLancamentos(chatId, fromId, lidos, 'foto');
    } catch (e) {
      console.error('[foto]', e);
      await tg.sendMessage(chatId, `❌ Não consegui ler a foto: ${e.message}`, { markdown: false });
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
      const lidos = await readFromText(texto);
      await proporLancamentos(chatId, fromId, lidos, 'audio');
    } catch (e) {
      console.error('[audio]', e);
      await tg.sendMessage(chatId, `❌ Áudio: ${e.message}`, { markdown: false });
    }
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  // Comandos.
  if (text.startsWith('/')) {
    // Em grupo o Telegram entrega "/relatorio@NomeDoBot" — descarta o sufixo.
    const [cmdRaw] = text.split(/\s+/);
    const cmd = cmdRaw.split('@')[0].toLowerCase();
    switch (cmd) {
      case '/start':
      case '/ajuda':
        await tg.sendMessage(chatId, AJUDA);
        return;
      case '/relatorio':
      case '/fechar': {
        const arg = text.split(/\s+/).slice(1).join(' ').trim();
        let mk;
        if (arg) {
          mk = parseMonthArg(arg);
          if (!mk) {
            await tg.sendMessage(chatId, 'Mês inválido. Ex.: `/relatorio 2026-08`, `/relatorio 08` ou `/relatorio agosto`.');
            return;
          }
        } else {
          mk = cmd.toLowerCase() === '/fechar' ? store.previousMonthKey() : store.monthKey();
        }
        await gerarEnviar(chatId, mk, { parcial: mk === store.monthKey() });
        return;
      }
      case '/anual': {
        const arg = text.split(/\s+/).slice(1).join(' ').trim();
        let yk = store.yearKey();
        if (arg) {
          if (!/^\d{4}$/.test(arg)) {
            await tg.sendMessage(chatId, 'Ano inválido. Ex.: `/anual 2025`.');
            return;
          }
          yk = arg;
        }
        await gerarEnviarAnual(chatId, yk, { parcial: yk === store.yearKey() });
        return;
      }
      case '/cancelar':
        delete state.pending[fromId];
        store.saveState(state);
        await tg.sendMessage(chatId, 'Confirmação pendente descartada.');
        return;
      default:
        await tg.sendMessage(chatId, 'Comando não reconhecido. /ajuda para ver as opções.');
        return;
    }
  }

  // Resposta a uma confirmação pendente (isolada por pessoa via fromId).
  // O pendente é sempre uma lista; estados gravados antes disso eram um objeto só.
  const pending = state.pending[fromId];
  if (pending) {
    const lista = Array.isArray(pending) ? pending : [pending];
    if (/^(sim|s|ok|confirmo?|confirmar|👍|✅)$/i.test(text)) {
      for (const l of lista) store.addLancamento(l, mesDoLancamento(l));
      delete state.pending[fromId];
      store.saveState(state);
      const quantos = lista.length === 1 ? 'Lançamento gravado' : `${lista.length} lançamentos gravados`;
      await tg.sendMessage(chatId, `✅ ${quantos}. Pode mandar o próximo!`);
    } else {
      // Correção em linguagem natural, aplicada sobre o lote inteiro.
      await tg.sendChatAction(chatId, 'typing');
      try {
        const origem = lista[0]?.origem;
        const corrigidos = (await applyCorrection(lista, text)).map((l) =>
          applyDono({ ...l, origem }, autorDoChat(fromId))
        );
        state.pending[fromId] = corrigidos;
        store.saveState(state);
        await tg.sendMessage(chatId, resumo(corrigidos));
      } catch (e) {
        console.error('[correcao]', e);
        await tg.sendMessage(chatId, `❌ Não consegui aplicar a correção: ${e.message}`, {
          markdown: false,
        });
      }
    }
    return;
  }

  // Texto solto → tratar como novo lançamento.
  await tg.sendChatAction(chatId, 'typing');
  try {
    const lidos = await readFromText(text);
    await proporLancamentos(chatId, fromId, lidos, 'texto');
  } catch (e) {
    console.error('[texto]', e);
    await tg.sendMessage(chatId, `❌ Não entendi o lançamento: ${e.message}. Use /ajuda.`, {
      markdown: false,
    });
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
