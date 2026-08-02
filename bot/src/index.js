// Bot financeiro do casal — loop principal (long-polling), confirmação de lançamentos
// (texto/áudio/foto) e agendador do fechamento mensal.

import { config } from './config.js';
import * as tg from './telegram.js';
import * as store from './store.js';
import { readFromText, readFromImage, applyCorrection, applyDono, resolveEdicao } from './extract.js';
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
    `Confirma? Responda *SIM* para ${alvo}, escreva a correção (ex.: "o 2 é da Duda", "valor é 154,90") ou diga "cancela".`
  );
  return partes.join('\n\n');
}

const AJUDA = [
  '💰 *Financeiro do Casal*',
  '',
  'Fale comigo normalmente — *não precisa de comando nenhum*. Vale texto, áudio ou foto do comprovante.',
  '',
  '*Para lançar*, é só contar o que aconteceu:',
  '· "gastei 154,90 no mercado no crédito do Nubank"',
  '· "recebi 3000 de salário"',
  'Eu leio, mostro os dados e peço confirmação antes de gravar — responda *SIM* para gravar, ou escreva a correção ("o 2 é da Duda", "valor é 154,90"). Para desistir, diga "cancela".',
  '',
  '*As categorias são livres*: escreva do seu jeito ("academia", "ração do pet", "streaming") e eu passo a usar essa categoria daí em diante. Quando o gasto encaixar numa que já existe, eu reuso — pra não virar categoria repetida no relatório.',
  '',
  'Pode mandar *vários de uma vez*, um por linha — eu leio todos e confirmo o lote.',
  'Se a primeira linha disser o mês, ele vale para o bloco inteiro:',
  '`Informações de agosto:`',
  '`Salário escritório: recebido R$ 2800,00`',
  '`Fatura Banco do Brasil: 666,00 (Eduardo)`',
  '`809,00 (Duda)`',
  '',
  '*Para ver, corrigir ou apagar* o que já foi gravado:',
  '· "lista" / "o que eu lancei esse mês?" / "mostra os gastos de agosto" — lista numerada',
  '· "muda o valor do 3 para 154,90" / "o mercado de ontem foi no débito" / "aquele uber era da Duda"',
  '· "apaga o 3" / "remove o último lançamento" / "exclui aquele gasto de 250 do mercado"',
  'Eu mostro o que vou mudar (ou remover) e só mexo depois do seu *SIM*.',
  '',
  '*Para pedir relatório*, peça em português mesmo:',
  '· "relatório" / "gere um relatório" — mês atual, parcial',
  '· "relatório de agosto" / "como ficou agosto?"',
  '· "fechamento do mês passado"',
  '· "relatório anual" / "como foi 2025?"',
  '',
  'O fechamento do mês chega sozinho no dia 01, e o do ano em 31/12.',
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
  state.pending[fromId] = { tipo: 'novo', lancamentos: lista };
  store.saveState(state);
  await tg.sendMessage(chatId, resumo(lista));
}

// Texto (digitado ou transcrito do áudio): descobre a intenção e roteia. Lançamento
// vira proposta de confirmação; o resto (relatório, ajuda, cancelar) vai para atenderPedido.
async function interpretarTexto(chatId, fromId, texto, origem) {
  const lido = await readFromText(texto);
  if (lido.intencao === 'lancamento' && lido.lancamentos.length) {
    await proporLancamentos(chatId, fromId, lido.lancamentos, origem);
    return;
  }
  // Mexer no que já foi gravado precisa da mensagem original (é ela que diz QUAL
  // lançamento) e dos candidatos — por isso não passa pelo atenderPedido.
  if (lido.intencao === 'listar') {
    await listarLancamentos(chatId, fromId, lido.mes);
    return;
  }
  if (lido.intencao === 'editar' || lido.intencao === 'remover') {
    await proporEdicao(chatId, fromId, texto, lido.mes ? [lido.mes] : escopoDe(fromId));
    return;
  }
  // Disse "lancamento" mas não achou nada: trata como conversa, não como erro.
  await atenderPedido(chatId, fromId, lido.intencao === 'lancamento' ? { intencao: 'conversa' } : lido);
}

// ---- Editar / remover o que já está gravado ----

// Escopo de meses em que procurar um lançamento. Precedência: mês citado na mensagem
// > mês da última listagem (é o que a pessoa está olhando) > mês corrente + anterior.
// A listagem só vale por um tempo: "apaga o 3" horas depois se refere ao que a pessoa
// tem na tela, não a uma lista de agosto vista semanas atrás.
const ESCOPO_TTL_MS = 30 * 60 * 1000;

function escopoDe(fromId) {
  const salvo = state.escopo?.[fromId];
  if (!salvo?.meses?.length) return null;
  return Date.now() - (salvo.em || 0) < ESCOPO_TTL_MS ? salvo.meses : null;
}

// Linha de uma lista/confirmação: "12/08 · Mercado — R$ 250,00 · Maria · Nubank (crédito)".
function linhaLancamento(l) {
  const sinal = l.tipo === 'entrada' ? '+' : '−';
  const partes = [`${sinal} R$ ${br(l.valor)}`, l.categoria || '—'];
  if (l.descricao && l.descricao !== l.categoria) partes.push(l.descricao);
  partes.push(l.autor || '—');
  if (l.banco) partes.push(`${nomeDoBanco(l.banco)}${l.forma_pagamento ? ` (${l.forma_pagamento})` : ''}`);
  const data = l.data && l.data !== 'hoje' ? `${l.data} · ` : '';
  return `${data}${partes.join(' · ')}`;
}

async function listarLancamentos(chatId, fromId, mes) {
  const chave = mes || store.monthKey();
  const itens = store.lancamentosRecentes({ meses: [chave], limite: 30 });
  if (!itens.length) {
    await tg.sendMessage(chatId, `Não há lançamentos em ${chave} ainda.`);
    return;
  }
  // A numeração mostrada aqui é a mesma que resolveEdicao recebe ("apaga o 3"),
  // por isso o escopo da listagem fica guardado para a próxima mensagem.
  state.escopo = state.escopo || {};
  state.escopo[fromId] = { meses: [chave], em: Date.now() };
  store.saveState(state);

  const linhas = itens.map((l, i) => `${i + 1}. ${linhaLancamento(l)}`);
  await tg.sendMessage(
    chatId,
    [
      `📒 *Lançamentos de ${chave}* (mais recentes primeiro)`,
      '',
      ...linhas,
      '',
      'Para mexer em algum, é só falar: "apaga o 3" ou "muda o valor do 2 para 154,90".',
    ].join('\n')
  );
}

// Resolve a instrução contra os lançamentos gravados e PROPÕE a mudança —
// nada é alterado sem o SIM (remoção não tem desfazer).
async function proporEdicao(chatId, fromId, texto, meses) {
  await tg.sendChatAction(chatId, 'typing');
  const candidatos = store.lancamentosRecentes({ meses });
  if (!candidatos.length) {
    await tg.sendMessage(chatId, 'Não encontrei lançamentos gravados para editar ou remover.');
    return;
  }

  const r = await resolveEdicao(candidatos, texto);
  const porId = new Map(candidatos.map((c) => [c.id, c]));

  if (r.acao === 'remover' && r.ids.length) {
    const itens = r.ids.map((id) => porId.get(id)).filter(Boolean);
    state.pending[fromId] = { tipo: 'remover', meses, itens };
    store.saveState(state);
    await tg.sendMessage(
      chatId,
      [
        itens.length === 1 ? '🗑 Vou *remover* este lançamento:' : `🗑 Vou *remover* estes ${itens.length} lançamentos:`,
        ...itens.map((l) => `• ${linhaLancamento(l)}${l.mes !== store.monthKey() ? ` [${l.mes}]` : ''}`),
        '',
        'Confirma? Responda *SIM* — remoção não tem desfazer.',
      ].join('\n')
    );
    return;
  }

  if (r.acao === 'editar' && r.atualizados.length) {
    const itens = r.atualizados
      .map((depois) => ({ antes: porId.get(depois.id), depois }))
      .filter((x) => x.antes && mudancas(x.antes, x.depois).length);
    if (itens.length) {
      state.pending[fromId] = { tipo: 'editar', meses, itens };
      store.saveState(state);
      await tg.sendMessage(chatId, resumoEdicao(itens));
      return;
    }
    // Pode acontecer quando a mudança pedida cai num sinônimo do que já está lá
    // (ex.: "categoria Delivery" quando ALIASES_CATEGORIA já leva a Alimentação/iFood).
    const atual = porId.get(r.atualizados[0].id);
    await tg.sendMessage(
      chatId,
      `Nada mudou — o lançamento já está assim:\n${atual ? linhaLancamento(atual) : ''}`,
      { markdown: false }
    );
    return;
  }

  await tg.sendMessage(
    chatId,
    `🤔 ${r.motivo || 'Não identifiquei de qual lançamento você está falando.'}\n\nDiga "lista" para ver os lançamentos numerados e depois, por exemplo, "apaga o 3".`,
    { markdown: false }
  );
}

const ROTULOS = {
  tipo: 'Tipo',
  valor: 'Valor',
  categoria: 'Categoria',
  descricao: 'Descrição',
  data: 'Data',
  banco: 'Banco',
  forma_pagamento: 'Forma',
  autor: 'Pessoa',
};

// Campos que realmente mudaram, para a confirmação mostrar antes → depois.
function mudancas(antes, depois) {
  const fmt = (campo, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (campo === 'valor') return `R$ ${br(v)}`;
    if (campo === 'banco') return nomeDoBanco(v);
    return String(v);
  };
  return Object.keys(ROTULOS)
    .filter((campo) => fmt(campo, antes[campo]) !== fmt(campo, depois[campo]))
    .map((campo) => `• ${ROTULOS[campo]}: ${fmt(campo, antes[campo])} → *${fmt(campo, depois[campo])}*`);
}

function resumoEdicao(itens) {
  const partes = [
    itens.length === 1 ? '✏️ Vou *alterar* este lançamento:' : `✏️ Vou *alterar* ${itens.length} lançamentos:`,
  ];
  for (const { antes, depois } of itens) {
    partes.push([linhaLancamento(antes), ...mudancas(antes, depois)].join('\n'));
  }
  partes.push('Confirma? Responda *SIM*, ou diga qual é o certo.');
  return partes.join('\n\n');
}

// Pendências antigas eram só a lista de lançamentos novos (ou um objeto só, antes disso).
function pendenteNormalizado(p) {
  if (!p) return null;
  if (Array.isArray(p)) return { tipo: 'novo', lancamentos: p };
  if (p.tipo) return p;
  return { tipo: 'novo', lancamentos: [p] };
}

// Executa o que foi confirmado com SIM: gravar novos, alterar ou remover.
async function aplicarPendente(chatId, fromId, pendente) {
  delete state.pending[fromId];

  if (pendente.tipo === 'remover') {
    const n = pendente.itens.filter((l) => store.removeLancamento(l.mes, l.id)).length;
    store.saveState(state);
    await tg.sendMessage(chatId, `🗑 ${n === 1 ? 'Lançamento removido' : `${n} lançamentos removidos`}.`);
    return;
  }

  if (pendente.tipo === 'editar') {
    let n = 0;
    for (const { antes, depois } of pendente.itens) {
      // Se a edição não nomeia a pessoa, a atual PERMANECE — sem isso o dono do banco
      // venceria em applyDono e uma fatura dividida ("BB: 666 Eduardo / 809 Duda")
      // voltaria toda para o dono do cartão na primeira edição de valor.
      const alvo = { ...depois, autor: depois.autor || antes.autor };
      const { id: _id, ...campos } = applyDono(alvo, antes.autor);
      if (store.updateLancamento(antes.mes, antes.id, campos)) n++;
    }
    store.saveState(state);
    await tg.sendMessage(chatId, `✏️ ${n === 1 ? 'Lançamento atualizado' : `${n} lançamentos atualizados`}.`);
    return;
  }

  const lista = pendente.lancamentos;
  for (const l of lista) store.addLancamento(l, mesDoLancamento(l));
  store.saveState(state);
  const quantos = lista.length === 1 ? 'Lançamento gravado' : `${lista.length} lançamentos gravados`;
  await tg.sendMessage(chatId, `✅ ${quantos}. Pode mandar o próximo!`);
}

// Pedidos que não são lançamento (relatório, ajuda, cancelar). Chega aqui tanto pela
// linguagem natural ("gere um relatório de agosto") quanto pelos comandos-atalho.
async function atenderPedido(chatId, fromId, { intencao, mes, ano }) {
  switch (intencao) {
    case 'relatorio_mes': {
      const mk = mes || store.monthKey();
      await gerarEnviar(chatId, mk, { parcial: mk === store.monthKey() });
      return;
    }
    case 'relatorio_ano': {
      const yk = ano || store.yearKey();
      await gerarEnviarAnual(chatId, yk, { parcial: yk === store.yearKey() });
      return;
    }
    case 'cancelar': {
      const tinha = Boolean(state.pending[fromId]);
      delete state.pending[fromId];
      store.saveState(state);
      await tg.sendMessage(
        chatId,
        tinha ? 'Ok, descartei o lançamento pendente.' : 'Não havia nada pendente por aqui.'
      );
      return;
    }
    case 'ajuda':
      await tg.sendMessage(chatId, AJUDA);
      return;
    default:
      await tg.sendMessage(
        chatId,
        'Não entendi 🤔 Me conte um gasto ou recebimento ("gastei 50 no mercado"), peça um relatório ("relatório de agosto") ou veja o que já foi gravado ("lista"). Diga *ajuda* para ver tudo.'
      );
  }
}

// Comandos com barra continuam funcionando como atalho (e o Telegram exige /start),
// mas são só um caminho alternativo para as mesmas intenções.
async function atenderComando(chatId, fromId, text) {
  // Em grupo o Telegram entrega "/relatorio@NomeDoBot" — descarta o sufixo.
  const [cmdRaw] = text.split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase();
  const arg = text.split(/\s+/).slice(1).join(' ').trim();

  switch (cmd) {
    case '/start':
    case '/ajuda':
      await atenderPedido(chatId, fromId, { intencao: 'ajuda' });
      return;
    case '/relatorio':
    case '/fechar': {
      let mes;
      if (arg) {
        mes = parseMonthArg(arg);
        if (!mes) {
          await tg.sendMessage(chatId, 'Mês inválido. Ex.: `relatório de agosto` ou `relatório 2026-08`.');
          return;
        }
      } else {
        mes = cmd === '/fechar' ? store.previousMonthKey() : store.monthKey();
      }
      await atenderPedido(chatId, fromId, { intencao: 'relatorio_mes', mes });
      return;
    }
    case '/anual': {
      if (arg && !/^\d{4}$/.test(arg)) {
        await tg.sendMessage(chatId, 'Ano inválido. Ex.: `relatório anual de 2025`.');
        return;
      }
      await atenderPedido(chatId, fromId, { intencao: 'relatorio_ano', ano: arg || null });
      return;
    }
    case '/cancelar':
      await atenderPedido(chatId, fromId, { intencao: 'cancelar' });
      return;
    default:
      await atenderPedido(chatId, fromId, { intencao: 'conversa' });
  }
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
      // Áudio também pede relatório ("me manda o fechamento do mês passado").
      await interpretarTexto(chatId, fromId, texto, 'audio');
    } catch (e) {
      console.error('[audio]', e);
      await tg.sendMessage(chatId, `❌ Áudio: ${e.message}`, { markdown: false });
    }
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  // Comandos com barra: atalho opcional para as mesmas intenções.
  if (text.startsWith('/')) {
    await atenderComando(chatId, fromId, text);
    return;
  }

  // Resposta a uma confirmação pendente (isolada por pessoa via fromId).
  const pendente = pendenteNormalizado(state.pending[fromId]);
  if (pendente) {
    // Desistir: resolvido por regex, sem ida ao modelo — aqui qualquer texto não
    // reconhecido vira correção/nova tentativa, então a saída precisa ser confiável.
    if (/^(cancela(r)?|esquece(r)?( isso)?|deixa pra l[áa]|desconsidera(r)?|n[ãa]o$|❌)/i.test(text)) {
      delete state.pending[fromId];
      store.saveState(state);
      await tg.sendMessage(chatId, 'Ok, descartei o que estava pendente.');
      return;
    }
    if (/^(sim|s|ok|confirmo?|confirmar|isso|pode gravar|pode|👍|✅)$/i.test(text)) {
      await aplicarPendente(chatId, fromId, pendente);
      return;
    }
    // Não é SIM nem cancelamento: é um ajuste do que está na mesa.
    await tg.sendChatAction(chatId, 'typing');
    try {
      if (pendente.tipo === 'novo') {
        // Correção em linguagem natural, aplicada sobre o lote inteiro.
        const origem = pendente.lancamentos[0]?.origem;
        const corrigidos = (await applyCorrection(pendente.lancamentos, text)).map((l) =>
          applyDono({ ...l, origem }, autorDoChat(fromId))
        );
        state.pending[fromId] = { tipo: 'novo', lancamentos: corrigidos };
        store.saveState(state);
        await tg.sendMessage(chatId, resumo(corrigidos));
      } else {
        // Edição/remoção: a pessoa está apontando outro alvo ("não, o 4") — resolve
        // de novo, no mesmo escopo de meses.
        await proporEdicao(chatId, fromId, text, pendente.meses);
      }
    } catch (e) {
      console.error('[pendente]', e);
      await tg.sendMessage(chatId, `❌ Não consegui aplicar: ${e.message}`, { markdown: false });
    }
    return;
  }

  // Texto solto → o modelo decide se é lançamento ou pedido (relatório, ajuda…).
  await tg.sendChatAction(chatId, 'typing');
  try {
    await interpretarTexto(chatId, fromId, text, 'texto');
  } catch (e) {
    console.error('[texto]', e);
    await tg.sendMessage(chatId, `❌ Não consegui processar a mensagem: ${e.message}`, {
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
