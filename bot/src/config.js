// Configuração central — tudo vem de variáveis de ambiente (definidas no Portainer).
// Nada de segredo fica no código.

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Variável de ambiente obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

function integer(name, fallback, { min, max }) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`[config] ${name} deve ser um inteiro entre ${min} e ${max}.`);
    process.exit(1);
  }
  return value;
}

const allowedChatIds = required('ALLOWED_CHAT_IDS')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!allowedChatIds.length) {
  console.error('[config] ALLOWED_CHAT_IDS precisa conter ao menos um id autorizado.');
  process.exit(1);
}

export const config = {
  // Segredos
  telegramToken: required('TELEGRAM_TOKEN'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  // Quem pode falar com o bot (Eduardo e Maria). Lista de chat ids separada por vírgula.
  allowedChatIds,

  // Para quem enviar os PDFs automáticos (fechamento mensal). Default: primeiro allowed.
  reportChatId: process.env.REPORT_CHAT_ID || '',

  // Modelo Claude (visão/texto/correção).
  model: process.env.MODEL || 'claude-opus-4-8',

  // STT (transcrição de áudio) — Groq Whisper. Opcional: sem a chave, áudio é recusado
  // com mensagem amigável, mas texto e foto continuam funcionando.
  groqApiKey: process.env.GROQ_API_KEY || '',
  sttModel: process.env.STT_MODEL || 'whisper-large-v3-turbo',

  // Onde os dados do mês persistem (volume Docker).
  dataDir: process.env.DATA_DIR || '/data',

  // Caminho do Chromium dentro do container (para gerar PDF).
  chromiumPath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',

  // Fuso horário para datas/agendamento.
  tz: process.env.TZ || 'America/Fortaleza',

  // Agendamento (horário local). Dia X às HH fecha o mês anterior.
  monthlyDay: integer('MONTHLY_DAY', 1, { min: 1, max: 31 }),
  monthlyHour: integer('MONTHLY_HOUR', 9, { min: 0, max: 23 }),

  // Fechamento anual: sempre em 31/12, à hora abaixo (padrão 20h).
  annualHour: integer('ANNUAL_HOUR', 20, { min: 0, max: 23 }),
};

// Se não definiram REPORT_CHAT_ID, usa o primeiro chat autorizado.
if (!config.reportChatId && config.allowedChatIds.length) {
  config.reportChatId = config.allowedChatIds[0];
}

// Garante que datas locais sigam a configuração mesmo fora do Docker Compose.
process.env.TZ = config.tz;
