# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status do projeto

O **bot está implementado** em `bot/`, versionado no GitHub e preparado para deploy pelo GHCR/Portainer. Prontos: entrada por **texto, áudio (Groq Whisper) e foto**, extração via Claude, confirmação antes de gravar, edição/remoção conversacional, persistência atômica com backup e **relatórios mensal e anual** em PDF. O mensal separa resumo e extrato compacto. A validação automatizada cobre as regras locais; integrações reais dependem dos tokens e do ambiente de produção.

## Objetivo do produto

Agente de **controle financeiro de um casal** — Eduardo e Maria. O agente:

- Recebe lançamentos por **Telegram**, em três formatos: **texto**, **áudio** e **foto** (ex.: foto de comprovante/nota).
- Registra dois tipos de lançamento: **gastos** (saídas) e **recebimentos/renda** (entradas). Cada recebimento tem um autor (Eduardo ou Maria), permitindo acompanhar a renda de cada um além dos gastos.
- **Documenta e categoriza** cada lançamento. A categoria é **campo aberto**: vale o que o casal escrever ("academia", "ração do pet") — ver a regra de vocabulário vivo abaixo. Sementes de gasto: Mercado, Alimentação/iFood, Uber, Gasolina, Fatura, Outros. Recebimentos também são categorizáveis (ex.: salário, freela, reembolso).
- Gera **relatório mensal** de fechamento (automático em **01/mês às 9h**, fecha o mês anterior). Consolida gastos, recebimentos e o **saldo** (entradas − saídas), sempre em duas visões: **por pessoa** (Eduardo, Maria) e **total** (casal). Gastos aparecem **separados por banco** e por **forma de pagamento** (crédito/fatura vs. débito) — ver regra abaixo.
- Gera **relatório anual** de fechamento (automático em **31/12 às 20h**, `ANNUAL_HOUR`). Além dos agregados do ano (pessoa, categoria, banco), traz a visão **mês a mês** com barra de saldo por mês. Sob demanda pedindo "relatório anual" / "como foi 2025?" (parcial do ano corrente).
- Gera **relatório parcial sob demanda**, sempre que Eduardo **ou** Maria pedirem — em **linguagem natural** ("relatório", "gere um relatório", "fechamento do mês passado", "como ficou agosto?"), por texto ou áudio.

## Regras de negócio que moldam a arquitetura

Estas restrições não são óbvias pelo código e devem ser respeitadas em qualquer implementação:

- **Dois usuários, um caixa compartilhado.** Os lançamentos de Eduardo e Maria alimentam o mesmo conjunto de dados. Identifique quem lançou (por chat/usuário do Telegram) e mantenha essa autoria, mas os relatórios são do casal (consolidados), com possibilidade de quebrar por pessoa — tanto para gastos quanto para recebimentos.
- **Gasto vs. recebimento é uma dimensão do lançamento, não uma entidade separada.** Todo lançamento tem um tipo (entrada/saída). O parsing precisa inferir esse tipo a partir da mensagem (ex.: "recebi", "salário", "caiu" → entrada; "gastei", "paguei" → saída).
- **Entrada multimodal exige extração.** Texto → parsing de valor/tipo/categoria/descrição. Áudio → transcrição antes do parsing. Foto → OCR/leitura do comprovante antes do parsing. Todos convergem para o mesmo formato normalizado de "lançamento" (valor, tipo, categoria, descrição, data, autor, origem).
- **Fechamentos são gatilhos temporais.** O mensal roda em **01/mês** (fecha o mês anterior); o anual roda em **31/12** (fecha o ano que termina). Cuidado com fuso (`TZ`) e com o marcador em `state.json` que evita disparo duplicado no mesmo dia. Decisão registrada: o anual fica em 31/12 mesmo (dezembro ainda fecha em 01/01 pelo mensal).
- **A interface é conversa, não comando.** O casal fala português normal; nada de `/relatorio`. A **intenção** da mensagem (`lancamento`, `relatorio_mes`, `relatorio_ano`, `cancelar`, `ajuda`, `conversa`) é classificada pelo modelo **na mesma chamada** que extrai os lançamentos (`extract.js`) — o caso comum (mandar um gasto) não paga duas idas ao modelo, e o mês/ano pedido ("mês passado", "agosto") já vem resolvido em `mes`/`ano` porque a data de hoje é injetada no prompt. Os comandos com barra continuam existindo como **atalho** (o Telegram exige `/start`), mas nenhum fluxo depende deles e a ajuda não os divulga.
- **Lançamento gravado é editável e removível — por conversa, e sempre com confirmação.** "apaga o 3", "muda o valor do 2 para 154,90", "aquele uber era da Duda". Isso impõe três coisas:
  1. **Todo lançamento tem `id` estável** (`store.novoId()`, 8 chars). Não pode ser a posição na lista: remover um item deslocaria todos os outros. Registros anteriores aos ids ganham um na primeira leitura (`ensureIds`, migração preguiçosa dentro de `lancamentosRecentes`).
  2. **Resolver o alvo é um 2º passo** (`extract.resolveEdicao`), separado do classificador: só ele recebe os lançamentos gravados no prompt, então mensagem comum não paga esse contexto. Aceita posição ("o 3", "o último"), valor, categoria/descrição, pessoa ou banco. Devolve `nenhum` + `motivo` quando é ambíguo — **prefere não fazer nada a chutar**, porque remoção não tem desfazer. Ids que não existem na lista de candidatos são descartados antes de virar ação (alucinação de id não remove nada).
  3. **Escopo de busca**: mês citado na mensagem > mês da última listagem (`state.escopo[fromId]`, válido por 30 min — é "o que a pessoa está vendo") > mês corrente + anterior.

  Na hora de aplicar a edição, **se a instrução não nomear a pessoa, o `autor` atual permanece**. Banco e titular são independentes; "o 2 é Eduardo Nubank" muda ambos os campos, enquanto "o 2 é Nubank" preserva a pessoa. Edição não muda o mês do lançamento (mudar de mês seria mover de arquivo) — por isso `competencia` fica fora dos campos editáveis.
- **`state.pending[fromId]` é uma operação, não uma lista.** `{ tipo: 'novo' | 'editar' | 'remover', ... }` — o SIM despacha por tipo em `aplicarPendente`. `pendenteNormalizado()` aceita os formatos antigos (lista pura, ou objeto único mais antigo ainda) para não quebrar um `state.json` já em produção.
- **Confirmação pendente não passa pelo classificador.** Enquanto há um lote aguardando SIM, qualquer texto não reconhecido é tratado como **correção** do lote — por isso "SIM" e "cancela" são resolvidos por regex ali, sem ida ao modelo: uma classificação errada nesse ponto viraria uma correção sem sentido.
- **Categoria é campo aberto com vocabulário vivo.** Não existe enum: a categoria é a string que o casal escreveu. O que impede isso de virar bagunça (a mesma coisa em três barras do relatório) são três camadas, nessa ordem:
  1. **Vocabulário vivo** — `store.categoriasUsadas()` varre os meses gravados e devolve as categorias já usadas por tipo (mais frequentes primeiro); `extract.js` injeta essa lista no system a cada chamada, mandando reusar a grafia exata e só criar categoria nova quando nenhuma servir. Categoria nova nasce do uso ("gastei 80 na academia" → `Academia`) e, uma vez gravada, já entra no vocabulário da próxima mensagem. **Nunca é preciso mexer em código para adicionar categoria.**
  2. **Aliases** (`ALIASES_CATEGORIA` em `domain.js`) — só para os sinônimos que se repetem muito (supermercado→Mercado, delivery/restaurante→Alimentação/iFood).
  3. **`normalizeCategoria()`** — rede de segurança que colapsa caixa/acento na grafia já usada ("MERCADO", "saude/farmacia" → `Mercado`, `Saúde/farmácia`) e capitaliza a categoria nova.

  As listas em `domain.js` (`CATEGORIAS_SAIDA`/`CATEGORIAS_ENTRADA`) são **só a semente** do primeiro uso, não uma restrição. **Mercado** (supermercado/feira) e **Alimentação/iFood** (comida pronta) são categorias distintas de propósito — a antiga "Alimentação/mercado" foi desmembrada.
- **Toda agregação tem duas dimensões: por pessoa e total.** Qualquer valor consolidado (por categoria, por banco, saldo) deve poder ser visto individualmente (Eduardo / Maria) e somado (casal).
- **Todo gasto tem um banco de origem e uma forma de pagamento.** Cada gasto (avulso ou não) sai de um banco, via **crédito** (entra na fatura do cartão) ou **débito** (sai direto da conta). O mesmo banco pode ser usado nas duas formas. O lançamento precisa capturar **banco** + **forma de pagamento** (crédito/débito) — o parsing infere isso da mensagem (ex.: "no crédito", "no débito", "débito", "cartão").
- **Banco e titular são dimensões independentes.** Eduardo e Maria podem ter contas separadas na mesma instituição — ambos podem possuir Nubank, Banco do Brasil etc. O par `{ banco, autor }` identifica a conta. A pessoa citada na mensagem vence; se ninguém for citado, vale quem enviou. O banco **nunca** define a pessoa. Assim, "Eduardo Nubank" pertence a Eduardo e "Nubank da Duda" pertence a Maria.
- **Banco é campo aberto com vocabulário vivo**, como categoria. `store.bancosUsados()` encontra as instituições já gravadas e o prompt manda reusar a grafia; uma instituição nova citada passa a ser reconhecida sem alterar código. Os aliases em `domain.js` apenas normalizam nomes recorrentes (BB → Banco do Brasil etc.). "Fatura" é a soma dos gastos de **crédito** de um banco **e titular** no mês; débito não entra na fatura, mas continua rastreado pela mesma dupla.

- **Pessoas têm apelidos.** As mensagens usam apelidos ("Duda" = Maria). O mapeamento apelido → pessoa canônica é dado em `domain.js` (`APELIDOS`/`resolvePessoa`), extensível como os bancos.

- **Uma mensagem pode conter vários lançamentos.** O casal manda blocos ("salário X; despesas: fatura Y (Eduardo), Z (Duda)"). A extração devolve sempre uma **lista**, a confirmação é do **lote inteiro** (um `SIM` grava todos) e a correção em linguagem natural é reaplicada sobre a lista ("o 2 é da Duda"). Linhas com só valor + nome herdam o contexto da linha anterior (mesmo banco/forma/categoria).

- **O mês de destino vem do lançamento, não da data do envio.** Precedência em `mesDoLancamento` (`dates.js`): **competência declarada > data do lançamento (DD/MM) > mês atual**. A `competencia` (`YYYY-MM`) é preenchida pela extração quando a mensagem traz um **cabeçalho de mês** ("informações já de agosto:"), e vale para **todos** os lançamentos do bloco — é o que permite fechar agosto ainda em julho. Competência malformada é ignorada (cai no mês atual) em vez de gravar em lugar errado. Como o modelo não sabe a data corrente, `extract.js` injeta a data de hoje no turno do usuário. Antes da confirmação, `normalizarData()` materializa `"hoje"`/data ausente em `DD/MM`; relatórios antigos recuperam o dia por `registrado_em`.

- **O resumo de confirmação mostra o mês só quando ele não é o corrente.** É exatamente o caso em que gravar no mês errado passaria despercebido; no dia a dia a linha não aparece e não polui.

## Stack

Reaproveitada do projeto irmão `agente-transfausto` (bot financeiro da empresa), com os mesmos padrões:

- **Node.js 22, ES Modules** (`"type": "module"`). Sem TypeScript.
- **Telegram Bot API via long-polling** (`getUpdates`), usando `fetch` nativo — **sem webhook, sem domínio**. Cliente mínimo escrito à mão (não usa lib de bot).
- **`@anthropic-ai/sdk`** (Claude Opus 4.8, `MODEL=claude-opus-4-8`) para leitura das entradas. Extração estruturada via **`output_config` com `json_schema`** — o modelo devolve JSON validado contra o schema do lançamento. Também usado para aplicar correções em linguagem natural sobre um lançamento já lido.
- **HTML desenhado → Chromium headless** para gerar os relatórios em **PDF A4**. `report.js` monta o HTML (hero, cartões de KPI, cartões por pessoa, barras de categoria, tabelas) e `pdf.js` aplica o CSS de design e imprime via `chromium --headless --no-sandbox --print-to-pdf`. O CSS usa `print-color-adjust: exact` para as cores saírem no PDF. A antiga dependência `marked`, sem uso, foi removida.
- **STT (transcrição de áudio): Groq — Whisper large v3 turbo** (`whisper-large-v3-turbo`), via `fetch` multipart para a API compatível-OpenAI da Groq (`GROQ_API_KEY`). Aceita o OGG/Opus do Telegram **sem ffmpeg**; gratuito no volume do casal. A Anthropic **não** transcreve áudio, por isso o provedor separado. A chave é **opcional**: sem ela, áudio é recusado com mensagem amigável e texto/foto seguem funcionando.
- **Persistência em arquivos JSON** num volume Docker (`/data`): `state.json` (offset do getUpdates, confirmações pendentes, marcadores de agendamento) + `months/<YYYY-MM>.json` (lançamentos do mês). Sem banco de dados.
- **Agendador in-process**: `setInterval` de 1 min que checa dia/hora e dispara os fechamentos (mensal em 01/mês; anual em 31/12), com marcadores `schedule.monthly`/`schedule.annual` em `state.json` para não disparar duas vezes no mesmo dia. Fuso via env `TZ`.
- **Configuração 100% por variáveis de ambiente** (`src/config.js`), com `required()` que aborta se faltar segredo. Nada de segredo no código.

### Diferenças em relação ao transfausto (o que precisa ser NOVO aqui)

- **Entrada multimodal:** o transfausto só lê **foto**. Aqui já foram adicionados **texto** (parsing direto em `extract.js`) e **áudio** (transcrição em `transcribe.js` via Groq Whisper → texto → `extract.js`).
- **Dois usuários** autorizados (Eduardo e Maria), não um. `ALLOWED_CHAT_IDS` com os dois; autoria do lançamento vem de quem enviou.
- **Modelo de dados diferente:** lançamento tem `tipo` (entrada/saída), `banco`, `forma de pagamento` (crédito/débito), `categoria`, `autor` (pessoa citada ou remetente; nunca derivada do banco), em vez do schema de "viagem". Sem as 3 camadas de custo do transfausto.
- **Relatórios por pessoa + total** e **por banco/forma de pagamento**, não por viagem.

## Deploy

Mesmo pipeline do transfausto:

- **Docker** — imagem base `node:22-slim` + `chromium` e fontes (`fonts-liberation`, `fonts-dejavu-core`) para o PDF. Volume `/data` para persistir os meses.
- **CI:** GitHub Actions (`.github/workflows/docker.yml`) builda e publica a imagem no **GHCR** (`ghcr.io/eduardovougler/<nome>:latest`).
- **Runtime:** `docker-compose.yml` (compatível com **Docker Swarm** — usa `deploy.restart_policy`, não `restart:`; gerenciado via Portainer). No Swarm não se usa `build:`, aponta-se a imagem pronta do GHCR.
- **Segredos/env** (do Portainer): `TELEGRAM_TOKEN`, `ANTHROPIC_API_KEY`, `ALLOWED_CHAT_IDS`, `REPORT_CHAT_ID`, `MODEL`, `TZ`, e os horários de agendamento.

## Comandos

- **Rodar local:** `cd bot && npm ci`, configure as variáveis de `.env.example` no ambiente e execute `npm start`. O Node não carrega `.env` automaticamente; como alternativa local, use `node --env-file=.env src/index.js`. Para gerar PDF fora do container, configure `CHROMIUM_PATH`.
- **Build da imagem:** `docker build -t financeiro-casal ./bot` (ou deixar o GitHub Actions publicar no GHCR).
- **Testes:** `cd bot && npm test`.

## Arquitetura (fluxo ponta a ponta)

Código em `bot/src/`:

1. **`index.js`** — loop principal (long-polling), roteia mensagens: foto → extração; texto/áudio → `interpretarTexto` (intenção + lançamentos) → `proporLancamentos` ou `atenderPedido` (relatório do mês/ano, ajuda, cancelar); `atenderComando` mapeia os atalhos com barra (`/relatorio`, `/fechar`, `/anual`, `/cancelar`, `/ajuda`) para as mesmas intenções; e o fluxo de **confirmação** ("li isto, confirma? responda SIM ou corrija em texto") antes de gravar. Roda o `tickSchedule` (fechamentos mensal e anual). Define o **autor de fallback** pelo chat id (1º autorizado = Eduardo, 2º = Maria).
2. **`telegram.js`** — cliente da Bot API (`getUpdates`, `sendMessage`, `sendDocument`, `downloadFile` para foto e áudio) via fetch. `sendMessage` usa `parse_mode: Markdown` **com fallback para texto puro**: descrições vindas do modelo e mensagens de erro podem ter `*`/`_` soltos, e o Telegram rejeita o envio inteiro com `400 can't parse entities`. Mensagens de erro são enviadas com `{ markdown: false }`.
3. **`extract.js`** — texto/foto → via Claude + `json_schema` (raiz `{ intencao, mes, ano, lancamentos: [...] }`, cada item com `competencia`). `readFromText` devolve o objeto inteiro (é o classificador de intenção **e** o extrator); `readFromImage` devolve só a lista (foto é sempre lançamento). Intenção/`mes`/`ano` fora do formato caem no default (lançamento, período corrente) em vez de virar leitura errada. Também expõe `applyCorrection` (correção em linguagem natural sobre a lista); `applyDono` resolve o autor por precedência **pessoa citada > quem enviou**, independentemente do banco. `contextoDeHoje()` injeta a data corrente em toda chamada (texto, foto e correção).
4. **`transcribe.js`** — áudio (OGG) → texto via Groq Whisper; o texto volta para `extract.js`.
5. **`domain.js`** — aliases e sementes de bancos abertos (`resolveBanco`), apelidos de pessoas (`resolvePessoa`), regra independente banco/titular (`applyDono`) e sementes de categoria + `ALIASES_CATEGORIA`/`normalizeCategoria`. Banco e categoria novos se adicionam pelo uso no Telegram; só aliases especiais e apelidos exigem código.
6. **`store.js`** — persistência JSON atômica com backup `.bak`: `state.json` e `months/<YYYY-MM>.json`; `monthKey`/`previousMonthKey`, `addLancamento` idempotente por id, `yearKey`/`loadYear` (consolida os 12 meses para o anual) e `categoriasUsadas()` (vocabulário vivo de categorias, lido pelo `extract.js`).
7. **`report.js`** — HTML dos relatórios. Seções reutilizáveis (KPIs, por pessoa, por categoria, por banco) compartilhadas por `buildReportHtml` e `buildAnnualReportHtml` (anual, com a seção **mês a mês**). No mensal, a primeira página é o resumo e o extrato começa em nova página, numa tabela compacta (`Data | Lançamento | Conta | Valor`): tipo vira sinal/cor do valor, banco + titular + forma compõem a conta, e categoria não se repete quando é igual à descrição.
8. **`pdf.js`** — CSS de design + HTML → PDF A4 via Chromium.

Confiabilidade operacional: escritas JSON usam arquivo temporário + rename atômico e backup `.bak`; `ALLOWED_CHAT_IDS` vazio impede a inicialização; o offset do Telegram avança depois do processamento e confirmações são idempotentes por id; fechamentos automáticos só são marcados depois do envio e tentam novamente em caso de falha. PDFs enviados são removidos do volume, e o container tem healthcheck do loop de long-polling.

Fluxo: mensagem no Telegram → intenção + normalização (texto/áudio/foto → lançamento) → `applyDono` → **confirmação do usuário** → grava no mês → relatório (mensal em 01/mês, anual em 31/12, ou parcial sob demanda ao pedir "relatório" em português) → PDF enviado no chat.
