// Cliente mínimo da Bot API do Telegram, usando fetch nativo (Node 18+).
// Long-polling via getUpdates — não precisa de webhook nem domínio.

import fs from 'node:fs';
import { config } from './config.js';

const API = `https://api.telegram.org/bot${config.telegramToken}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram ${method} falhou: ${json.error_code} ${json.description}`);
  }
  return json.result;
}

// Long-poll: espera até `timeout` segundos por mensagens novas a partir de `offset`.
export async function getUpdates(offset, timeout = 30) {
  const res = await fetch(`${API}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset, timeout, allowed_updates: ['message'] }),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`getUpdates falhou: ${json.error_code} ${json.description}`);
  }
  return json.result;
}

export function sendMessage(chatId, text) {
  return call('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
}

export function sendChatAction(chatId, action = 'typing') {
  return call('sendChatAction', { chat_id: chatId, action }).catch(() => {});
}

// Baixa um arquivo pelo file_id e devolve { buffer, mime, filePath }.
export async function downloadFile(fileId, defaultMime = 'application/octet-stream') {
  const file = await call('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = mimeFromPath(file.file_path, defaultMime);
  return { buffer, mime, filePath: file.file_path };
}

function mimeFromPath(p, fallback) {
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.oga') || p.endsWith('.ogg')) return 'audio/ogg';
  if (p.endsWith('.mp3')) return 'audio/mpeg';
  if (p.endsWith('.m4a')) return 'audio/mp4';
  if (p.endsWith('.wav')) return 'audio/wav';
  return fallback;
}

// Envia um documento (PDF). `filePath` é caminho local.
export async function sendDocument(chatId, filePath, caption = '') {
  const data = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append(
    'document',
    new Blob([data], { type: 'application/pdf' }),
    filePath.split('/').pop()
  );
  const res = await fetch(`${API}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`sendDocument falhou: ${json.error_code} ${json.description}`);
  }
  return json.result;
}
