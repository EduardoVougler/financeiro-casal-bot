// Transcrição de áudio (STT): voz do Telegram (OGG/Opus) -> texto, que depois passa
// por extract.js.
//
// Provedor: Groq — Whisper large v3 turbo. API compatível com OpenAI, aceita OGG direto
// (sem ffmpeg), gratuita no volume do casal. Requer GROQ_API_KEY.

import { config } from './config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// (buffer, mime) => Promise<string> com o texto transcrito.
export async function transcribe(buffer, mime = 'audio/ogg') {
  if (!config.groqApiKey) {
    throw new Error(
      'Transcrição de áudio não configurada (GROQ_API_KEY ausente). Envie por texto ou foto.'
    );
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), 'audio.ogg');
  form.append('model', config.sttModel); // whisper-large-v3-turbo
  form.append('language', 'pt');
  form.append('response_format', 'text');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Groq STT falhou: ${res.status} ${detalhe}`);
  }

  // response_format=text devolve o texto puro no corpo.
  const texto = (await res.text()).trim();
  if (!texto) throw new Error('Transcrição vazia.');
  return texto;
}
