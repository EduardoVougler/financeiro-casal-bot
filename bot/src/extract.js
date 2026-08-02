// Leitura da mensagem com Claude: descobre a INTENÇÃO (lançar algo, pedir relatório,
// ajuda, cancelar) e, quando é lançamento, extrai a lista de LANÇAMENTOS (entradas e
// saídas). Saída estruturada via json_schema. Também aplica correções em linguagem natural.
//
// Intenção e extração vêm na MESMA chamada: o caso comum (mandar um gasto) não paga
// duas idas ao modelo, e "me manda o relatório de agosto" não precisa de comando.
//
// Uma mensagem pode conter VÁRIOS lançamentos (ex.: "salário 2800; fatura BB 666
// (Eduardo) e 809 (Duda)"), por isso o schema devolve uma lista.
//
// Dono do lançamento, em ordem de precedência: pessoa citada na mensagem > dono do
// banco > quem enviou. Ver applyDono().

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import {
  resolveBanco,
  donoDoBanco,
  resolvePessoa,
  normalizeCategoria,
  CATEGORIAS_SAIDA,
  CATEGORIAS_ENTRADA,
} from './domain.js';
import { categoriasUsadas } from './store.js';

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
        'Categoria do lançamento. A lista é aberta: reuse uma das categorias conhecidas (enviadas no contexto) quando couber e crie uma nova, com as palavras da própria mensagem, quando nenhuma servir.',
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

// A resposta traz a intenção da mensagem e, quando é lançamento, a LISTA de
// lançamentos — sempre lista, mesmo quando há um único.
const respostaSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intencao: {
      type: 'string',
      enum: [
        'lancamento',
        'relatorio_mes',
        'relatorio_ano',
        'listar',
        'editar',
        'remover',
        'cancelar',
        'ajuda',
        'conversa',
      ],
      description: 'O que a pessoa quer com esta mensagem.',
    },
    mes: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'Mês pedido no relatório, em YYYY-MM. Resolva expressões relativas ("mês passado", "agosto") usando a data de hoje. null se a intenção não for relatorio_mes ou se nenhum mês for citado (nesse caso vale o mês corrente).',
    },
    ano: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'Ano pedido no relatório anual, em YYYY. null se a intenção não for relatorio_ano ou se nenhum ano for citado (nesse caso vale o ano corrente).',
    },
    lancamentos: {
      type: 'array',
      items: lancamentoSchema,
      description: 'Lançamentos lidos. Lista vazia quando a intenção não é "lancamento".',
    },
  },
  required: ['intencao', 'mes', 'ano', 'lancamentos'],
};

const SYSTEM = `Você é o assistente financeiro de um casal (Eduardo e Maria, também chamada de Duda). Eles conversam com você em linguagem natural, por texto, áudio ou foto de comprovante — nunca por comandos.

PRIMEIRO, classifique a INTENÇÃO da mensagem:
- "lancamento": a pessoa está registrando gasto(s) ou recebimento(s). Ex.: "gastei 154,90 no mercado", "recebi 3000 de salário", "fatura do BB 666 (Eduardo)". É o caso mais comum: na dúvida entre lançamento e conversa, se houver valor em dinheiro, é lançamento.
- "relatorio_mes": pede o relatório/fechamento/resumo/balanço de um mês. Ex.: "relatorio", "gere um relatório", "me manda o fechamento do mês passado", "como ficou agosto?", "quanto a gente gastou esse mês?". Preencha "mes" (YYYY-MM) quando um mês for citado ou dedutível ("mês passado"); senão null (= mês corrente).
- "relatorio_ano": pede o relatório do ANO ou uma visão anual. Ex.: "relatório anual", "como foi 2025?", "fechamento do ano". Preencha "ano" (YYYY) quando citado; senão null (= ano corrente).
- "listar": quer VER os lançamentos já gravados, sem PDF. Ex.: "lista", "meus últimos lançamentos", "o que eu lancei esse mês?", "mostra os gastos de agosto". Preencha "mes" se um mês for citado.
- "editar": quer ALTERAR um lançamento JÁ GRAVADO. Ex.: "muda o valor do 3 para 154,90", "o mercado de ontem foi no débito", "corrige: aquele uber era da Duda", "troca a categoria do último para Mercado".
- "remover": quer APAGAR um lançamento JÁ GRAVADO. Ex.: "apaga o 3", "remove o último lançamento", "exclui aquele gasto de 250 do mercado", "esse lançamento foi duplicado, tira um".
- "cancelar": desistir do que está PENDENTE de confirmação (nada foi gravado ainda). Ex.: "cancela", "esquece", "deixa pra lá".

Cuidado para não confundir: "editar"/"remover" mexem em algo JÁ GRAVADO; "cancelar" descarta algo que ainda nem foi gravado; e uma mensagem que só descreve um gasto novo é "lancamento".
- "ajuda": quer saber o que você faz ou como usar. Ex.: "ajuda", "o que você faz?", "como funciona?".
- "conversa": qualquer outra coisa (saudação, papo, mensagem sem valor nem pedido claro).

Quando a intenção NÃO for "lancamento", devolva "lancamentos" como lista vazia.

Se a intenção for "lancamento", extraia os lançamentos como descrito abaixo.

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

CATEGORIA é campo ABERTO — não há lista fixa. O contexto traz as categorias já conhecidas (as que o casal usa). Regra:
1. Se uma categoria conhecida descreve o lançamento, use-a EXATAMENTE como está escrita (mesma grafia, mesmos acentos). Não crie sinônimo do que já existe ("Supermercado" quando já existe "Mercado", "Farmácia" quando já existe "Saúde/farmácia").
2. Se nenhuma serve, crie uma categoria nova, curta (1–3 palavras) e com as palavras da própria mensagem — é assim que o casal ensina categorias novas ao bot ("gastei 80 na academia" => "Academia").
3. "Mercado" é compra de supermercado/feira; "Alimentação/iFood" é comida pronta (iFood, delivery, restaurante, lanche). São categorias diferentes.
4. Só use "Outros" quando realmente não der para nomear.

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

const INTENCOES = [
  'lancamento',
  'relatorio_mes',
  'relatorio_ano',
  'listar',
  'editar',
  'remover',
  'cancelar',
  'ajuda',
  'conversa',
];

// Categorias que o modelo deve conhecer: as já usadas nos meses gravados primeiro
// (é o vocabulário real do casal), completadas pelas sementes de domain.js.
function vocabulario() {
  const usadas = categoriasUsadas();
  const juntar = (jaUsadas, sementes) => [
    ...jaUsadas,
    ...sementes.filter((s) => !jaUsadas.some((u) => u.toLowerCase() === s.toLowerCase())),
  ];
  return {
    saida: juntar(usadas.saida, CATEGORIAS_SAIDA),
    entrada: juntar(usadas.entrada, CATEGORIAS_ENTRADA),
  };
}

// Vai no system: muda conforme o casal cria categorias novas — é o que torna a
// lista extensível sem tocar em código.
function blocoDeCategorias(vocab) {
  return `\n\nCATEGORIAS CONHECIDAS (reuse a grafia exata quando couber; crie nova só se nenhuma servir):
- Saídas: ${vocab.saida.join(', ')}
- Entradas: ${vocab.entrada.join(', ')}`;
}

// Chamada ao modelo -> { intencao, mes, ano, lancamentos }, já normalizado.
async function extract(messages) {
  const vocab = vocabulario();
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4000,
    system: SYSTEM + blocoDeCategorias(vocab),
    output_config: { format: { type: 'json_schema', schema: respostaSchema } },
    messages,
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text);
  // Rede de segurança da categoria aberta: mesmo que o modelo escreva "supermercado"
  // ou "MERCADO", o lançamento gravado usa a grafia que o relatório já agrupa.
  const lancamentos = (Array.isArray(parsed.lancamentos) ? parsed.lancamentos : []).map((l) => ({
    ...l,
    categoria: normalizeCategoria(l.categoria, l.tipo === 'entrada' ? vocab.entrada : vocab.saida),
  }));
  // Intenção/período fora do formato esperado não podem virar leitura errada:
  // caem no default (lançamento, período corrente).
  const intencao = INTENCOES.includes(parsed.intencao) ? parsed.intencao : 'lancamento';
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(parsed.mes || '') ? parsed.mes : null;
  const ano = /^\d{4}$/.test(parsed.ano || '') ? parsed.ano : null;
  return { intencao, mes, ano, lancamentos };
}

// Só faz sentido cobrar lançamentos quando a intenção era registrar algo.
function exigirLancamentos(lista) {
  if (!lista.length) throw new Error('Nenhum lançamento identificado na mensagem.');
  return lista;
}

// ---- Editar / remover lançamentos JÁ GRAVADOS ----
//
// Segundo passo, separado da classificação: recebe os lançamentos gravados (com id)
// e a instrução original, e resolve QUAL item mexer. Fica separado porque só aqui os
// candidatos entram no prompt — mensagem comum não paga esse contexto.

// Campos editáveis = os do lançamento, menos a competência (mudar de mês seria mover
// o registro de arquivo; edição acontece dentro do mês onde o lançamento já está).
const { competencia: _competencia, ...camposEditaveis } = lancamentoSchema.properties;

const lancamentoEditadoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'id do lançamento, copiado EXATAMENTE do candidato.' },
    ...camposEditaveis,
  },
  required: ['id', ...lancamentoSchema.required.filter((c) => c !== 'competencia')],
};

const edicaoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    acao: {
      type: 'string',
      enum: ['editar', 'remover', 'nenhum'],
      description: 'O que fazer com os lançamentos identificados.',
    },
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'ids a REMOVER (só quando acao = remover). Lista vazia nos outros casos.',
    },
    atualizados: {
      type: 'array',
      items: lancamentoEditadoSchema,
      description:
        'Lançamentos com a alteração já aplicada (só quando acao = editar). Lista vazia nos outros casos.',
    },
    motivo: {
      type: 'string',
      description:
        'Quando acao = nenhum, uma frase em português dizendo por que não deu (nada bateu / ambíguo). Vazio nos outros casos.',
    },
  },
  required: ['acao', 'ids', 'atualizados', 'motivo'],
};

const SYSTEM_EDICAO = `Você mantém o registro financeiro de um casal (Eduardo e Maria, também chamada de Duda). Recebe a lista de lançamentos JÁ GRAVADOS — cada um com "pos" (posição na lista mostrada) e "id" — e uma instrução em linguagem natural para EDITAR ou REMOVER um ou mais deles.

Identifique o alvo pela instrução, que pode citar:
- a posição na lista: "o 3", "o segundo", "o último" (o último lançado é o de pos 1, a lista vem do mais recente para o mais antigo);
- o valor: "aquele de 154,90";
- a descrição/categoria: "o mercado de ontem", "o uber", "a fatura do BB";
- a pessoa ou o banco: "o gasto da Duda no Nubank".

Copie o "id" EXATAMENTE como aparece no candidato — nunca invente id.

- acao "remover": ponha os ids em "ids".
- acao "editar": devolva em "atualizados" o lançamento INTEIRO com a alteração aplicada — repita todos os campos como estão e mude só o que a instrução pediu.
- acao "nenhum": quando nada na lista corresponde, OU quando mais de um candidato é igualmente plausível e escolher seria adivinhar. Explique em "motivo".

Prefira "nenhum" a chutar: um lançamento removido por engano não tem desfazer.`;

// Resolve uma instrução de edição/remoção contra os lançamentos gravados.
// Devolve { acao, ids, atualizados, motivo } — nada é gravado aqui.
export async function resolveEdicao(candidatos, instrucao) {
  const vocab = vocabulario();
  const lista = candidatos.map((l, i) => ({
    pos: i + 1,
    id: l.id,
    mes: l.mes,
    tipo: l.tipo,
    valor: l.valor,
    categoria: l.categoria,
    descricao: l.descricao,
    data: l.data,
    banco: l.banco,
    forma_pagamento: l.forma_pagamento,
    autor: l.autor,
  }));

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4000,
    system: SYSTEM_EDICAO + blocoDeCategorias(vocab),
    output_config: { format: { type: 'json_schema', schema: edicaoSchema } },
    messages: [
      {
        role: 'user',
        content:
          `${contextoDeHoje()}\n\n` +
          `Lançamentos gravados (JSON):\n${JSON.stringify(lista, null, 2)}\n\n` +
          `Instrução: "${instrucao}"`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text);
  const acao = ['editar', 'remover', 'nenhum'].includes(parsed.acao) ? parsed.acao : 'nenhum';
  const idsValidos = new Set(candidatos.map((c) => c.id));
  // Só passa id que existe de verdade: alucinação de id não pode virar remoção.
  const ids = (Array.isArray(parsed.ids) ? parsed.ids : []).filter((id) => idsValidos.has(id));
  const atualizados = (Array.isArray(parsed.atualizados) ? parsed.atualizados : [])
    .filter((l) => idsValidos.has(l.id))
    .map((l) => ({
      ...l,
      categoria: normalizeCategoria(l.categoria, l.tipo === 'entrada' ? vocab.entrada : vocab.saida),
    }));
  return { acao, ids, atualizados, motivo: String(parsed.motivo || '') };
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

// Texto livre (digitado ou transcrito do áudio) -> intenção + lançamentos.
// É por aqui que "gere um relatório de agosto" vira um pedido de relatório.
export function readFromText(texto) {
  return extract([
    {
      role: 'user',
      content: `${contextoDeHoje()}\n\nClassifique a intenção desta mensagem e, se for lançamento, registre os lançamentos: "${texto}"`,
    },
  ]);
}

// Foto (comprovante/nota) -> lista de lançamentos. Foto é sempre lançamento.
export async function readFromImage(buffer, mime) {
  const base64 = buffer.toString('base64');
  const { lancamentos } = await extract([
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        {
          type: 'text',
          text: `${contextoDeHoje()}\n\nExtraia os lançamentos desta imagem seguindo o schema (intencao = "lancamento").`,
        },
      ],
    },
  ]);
  return exigirLancamentos(lancamentos);
}

// Aplica uma correção em linguagem natural sobre os lançamentos já lidos.
// Recebe e devolve a LISTA inteira (a correção pode citar um item específico).
export async function applyCorrection(currentList, correctionText) {
  const { lancamentos } = await extract([
    {
      role: 'user',
      content:
        `${contextoDeHoje()}\n\n` +
        `Lançamentos atuais (JSON):\n${JSON.stringify(currentList, null, 2)}\n\n` +
        `Correção do usuário: "${correctionText}"\n\n` +
        `Devolva a lista corrigida por inteiro (intencao = "lancamento"), mantendo os itens e campos não citados na correção.`,
    },
  ]);
  return exigirLancamentos(lancamentos);
}
