// Extração de um LANÇAMENTO (entrada ou saída) a partir de texto ou foto, com Claude.
// Saída estruturada via json_schema. Também aplica correções em linguagem natural.
//
// O BANCO define o dono do gasto — a derivação do autor é feita em applyDono(), não
// pelo modelo, para não depender da leitura.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { resolveBanco, donoDoBanco } from './domain.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// Schema de um lançamento do casal.
const lancamentoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipo: {
      type: 'string',
      enum: ['saida', 'entrada'],
      description: 'saida = gasto/despesa; entrada = recebimento/renda.',
    },
    valor: { type: 'number', description: 'Valor em reais (número decimal com ponto, ex.: 154.90).' },
    categoria: {
      type: 'string',
      description:
        'Categoria. Saídas: Alimentação/mercado, Uber, iFood, Gasolina, Outros… Entradas: Salário, Freela, Reembolso, Outros. Use a que melhor encaixar; crie nova se necessário.',
    },
    descricao: { type: 'string', description: 'Descrição curta do lançamento. Vazio se não houver.' },
    data: { type: 'string', description: 'Data DD/MM. Use "hoje" se não for citada.' },
    banco: {
      type: ['string', 'null'],
      description:
        'Banco de origem do gasto: Nubank, Banco do Brasil, Inter ou Bradesco. null para entradas ou se não citado.',
    },
    forma_pagamento: {
      type: ['string', 'null'],
      enum: ['credito', 'debito', null],
      description: 'Como o gasto foi pago: credito (fatura) ou debito. null para entradas ou se não citado.',
    },
    observacao: { type: 'string', description: 'Nota/incerteza de leitura. Vazio se não houver.' },
  },
  required: ['tipo', 'valor', 'categoria', 'descricao', 'data', 'banco', 'forma_pagamento', 'observacao'],
};

const SYSTEM = `Você registra lançamentos financeiros de um casal (Eduardo e Maria) a partir de mensagens de texto ou fotos de comprovantes/notas.

Classifique cada lançamento:
- "saida" (gasto/despesa): ex. "gastei", "paguei", "comprei", "mercado", "uber", "ifood", "gasolina".
- "entrada" (recebimento/renda): ex. "recebi", "salário", "caiu", "entrou", "freela", "reembolso".

Para GASTOS, capture quando possível:
- banco de origem: Nubank, Banco do Brasil, Inter ou Bradesco.
- forma de pagamento: "credito" (fatura do cartão) ou "debito" (sai direto da conta).
  Dicas: "no crédito"/"cartão"/"fatura" => credito; "no débito"/"débito"/"na conta" => debito.

Valores em número decimal com ponto (ex.: 154.90). Não use separador de milhar.
Se um campo não existir, use null (banco/forma) ou string vazia (texto). Se a data não for citada, use "hoje".
Se não tiver certeza de algo, registre em "observacao".`;

// Deriva o autor a partir do banco (fonte da verdade). Se não houver banco reconhecido,
// usa `fallbackAutor` (quem enviou a mensagem).
export function applyDono(lancamento, fallbackAutor) {
  const bancoKey = resolveBanco(lancamento.banco);
  const autor = donoDoBanco(bancoKey) || fallbackAutor || null;
  return { ...lancamento, banco: bancoKey, autor };
}

async function extract(messages) {
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1500,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: lancamentoSchema } },
    messages,
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

// Texto livre -> lançamento.
export function readFromText(texto) {
  return extract([{ role: 'user', content: `Registre este lançamento: "${texto}"` }]);
}

// Foto (comprovante/nota) -> lançamento.
export function readFromImage(buffer, mime) {
  const base64 = buffer.toString('base64');
  return extract([
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: 'Extraia o lançamento desta imagem seguindo o schema.' },
      ],
    },
  ]);
}

// Aplica uma correção em linguagem natural sobre um lançamento já lido.
export function applyCorrection(current, correctionText) {
  return extract([
    {
      role: 'user',
      content:
        `Dados atuais do lançamento (JSON):\n${JSON.stringify(current, null, 2)}\n\n` +
        `Correção do usuário: "${correctionText}"\n\n` +
        `Devolva o JSON corrigido, mantendo os demais campos.`,
    },
  ]);
}
