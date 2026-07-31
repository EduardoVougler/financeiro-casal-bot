// Extração de LANÇAMENTOS (entradas e saídas) a partir de texto ou foto, com Claude.
// Saída estruturada via json_schema. Também aplica correções em linguagem natural.
//
// Uma mensagem pode conter VÁRIOS lançamentos (ex.: "salário 2800; fatura BB 666
// (Eduardo) e 809 (Duda)"), por isso o schema devolve uma lista.
//
// Dono do lançamento, em ordem de precedência: pessoa citada na mensagem > dono do
// banco > quem enviou. Ver applyDono().

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { resolveBanco, donoDoBanco, resolvePessoa } from './domain.js';

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
        'Categoria. Saídas: Alimentação/mercado, Uber, iFood, Gasolina, Fatura, Outros… Entradas: Salário, Freela, Reembolso, Outros. Use a que melhor encaixar; crie nova se necessário.',
    },
    descricao: { type: 'string', description: 'Descrição curta do lançamento. Vazio se não houver.' },
    data: { type: 'string', description: 'Data DD/MM. Use "hoje" se não for citada.' },
    competencia: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'Mês de referência no formato YYYY-MM, quando a mensagem indicar a que mês os lançamentos pertencem (ex.: "informações já de agosto" => "2026-08"). null se nenhum mês for citado.',
    },
    banco: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'Banco de origem do gasto: Nubank, Banco do Brasil, Inter ou Bradesco. null para entradas ou se não citado.',
    },
    // Valor fixo + null precisa de anyOf: a API rejeita `type: ['string','null']`
    // combinado com `enum` ("Enum value 'credito' does not match declared type").
    forma_pagamento: {
      anyOf: [{ type: 'string', enum: ['credito', 'debito'] }, { type: 'null' }],
      description: 'Como o gasto foi pago: credito (fatura) ou debito. null para entradas ou se não citado.',
    },
    autor: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'Pessoa citada na mensagem como dona DESTE lançamento (ex.: "Eduardo", "Duda", "Maria"), normalmente entre parênteses ou logo após o valor. null se ninguém for citado.',
    },
    observacao: { type: 'string', description: 'Nota/incerteza de leitura. Vazio se não houver.' },
  },
  required: [
    'tipo',
    'valor',
    'categoria',
    'descricao',
    'data',
    'competencia',
    'banco',
    'forma_pagamento',
    'autor',
    'observacao',
  ],
};

// A resposta é sempre uma LISTA — mesmo quando há um único lançamento.
const respostaSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lancamentos: { type: 'array', items: lancamentoSchema },
  },
  required: ['lancamentos'],
};

const SYSTEM = `Você registra lançamentos financeiros de um casal (Eduardo e Maria, também chamada de Duda) a partir de mensagens de texto ou fotos de comprovantes/notas.

UMA MENSAGEM PODE CONTER VÁRIOS LANÇAMENTOS. Extraia TODOS, um item por valor citado.
Uma linha com apenas um valor e um nome (ex.: "809,00 (Duda)") logo abaixo de outra linha herda dela o contexto (mesmo banco, mesma forma de pagamento, mesma categoria) e é um lançamento próprio.

Classifique cada lançamento:
- "saida" (gasto/despesa): ex. "gastei", "paguei", "comprei", "fatura", "mercado", "uber", "ifood", "gasolina".
- "entrada" (recebimento/renda): ex. "recebi", "salário", "caiu", "entrou", "freela", "reembolso".

Para GASTOS, capture quando possível:
- banco de origem: Nubank, Banco do Brasil, Inter ou Bradesco.
- forma de pagamento: "credito" (fatura do cartão) ou "debito" (sai direto da conta).
  Dicas: "no crédito"/"cartão"/"fatura" => credito; "no débito"/"débito"/"na conta" => debito.

Em "autor", registre a pessoa citada para AQUELE lançamento (o nome entre parênteses ou junto do valor). Não invente: se ninguém for citado, use null.

CABEÇALHO DE MÊS: se a mensagem abrir dizendo a que mês os lançamentos se referem ("vou enviar as informações já de agosto:", "referente a julho", "fechamento de 08/2026"), preencha "competencia" com esse mês em YYYY-MM em TODOS os lançamentos do bloco — inclusive nos que não repetem o mês. Use o ano corrente, salvo quando o mês citado for claramente do passado recente (ex.: em janeiro, "dezembro" é o ano anterior). Se a mensagem não citar mês nenhum, "competencia" é null. Um lançamento com data própria (ex.: "05/08 mercado") mantém essa data em "data"; "competencia" continua sendo o mês do cabeçalho.

Valores em número decimal com ponto (ex.: 154.90). Não use separador de milhar.
Se um campo não existir, use null (banco/forma/autor) ou string vazia (texto). Se a data não for citada, use "hoje".
Se não tiver certeza de algo, registre em "observacao".`;

// Deriva o autor: pessoa citada na mensagem > dono do banco > quem enviou.
// O banco também é normalizado para a chave canônica.
export function applyDono(lancamento, fallbackAutor) {
  const bancoKey = resolveBanco(lancamento.banco);
  const autor =
    resolvePessoa(lancamento.autor) || donoDoBanco(bancoKey) || fallbackAutor || null;
  return { ...lancamento, banco: bancoKey, autor };
}

async function extract(messages) {
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: respostaSchema } },
    messages,
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text);
  const lista = Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [];
  if (!lista.length) throw new Error('Nenhum lançamento identificado na mensagem.');
  return lista;
}

// O modelo precisa da data atual para resolver "hoje" e para transformar um
// cabeçalho como "de agosto" na competência YYYY-MM certa. Segue o TZ do processo.
function contextoDeHoje() {
  const agora = new Date();
  const dia = agora.toLocaleDateString('pt-BR');
  return `Hoje é ${dia} (mês corrente ${monthKeyOf(agora)}).`;
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Texto livre -> lista de lançamentos.
export function readFromText(texto) {
  return extract([
    {
      role: 'user',
      content: `${contextoDeHoje()}\n\nRegistre os lançamentos desta mensagem: "${texto}"`,
    },
  ]);
}

// Foto (comprovante/nota) -> lista de lançamentos.
export function readFromImage(buffer, mime) {
  const base64 = buffer.toString('base64');
  return extract([
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        {
          type: 'text',
          text: `${contextoDeHoje()}\n\nExtraia os lançamentos desta imagem seguindo o schema.`,
        },
      ],
    },
  ]);
}

// Aplica uma correção em linguagem natural sobre os lançamentos já lidos.
// Recebe e devolve a LISTA inteira (a correção pode citar um item específico).
export function applyCorrection(currentList, correctionText) {
  return extract([
    {
      role: 'user',
      content:
        `${contextoDeHoje()}\n\n` +
        `Lançamentos atuais (JSON):\n${JSON.stringify(currentList, null, 2)}\n\n` +
        `Correção do usuário: "${correctionText}"\n\n` +
        `Devolva a lista corrigida por inteiro, mantendo os itens e campos não citados na correção.`,
    },
  ]);
}
