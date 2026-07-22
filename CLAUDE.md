# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status do projeto

O **bot está implementado** em `bot/`. Prontos: entrada por **texto, áudio (Groq Whisper) e foto**, extração via Claude, confirmação antes de gravar, persistência, e **relatórios mensal e anual** em PDF (HTML desenhado → Chromium) com por pessoa + total, saldo, categorias e banco/forma de pagamento. Falta principalmente: testar com token real do Telegram, ajustar categorias com o uso e criar o repositório Git + deploy.

## Objetivo do produto

Agente de **controle financeiro de um casal** — Eduardo e Maria. O agente:

- Recebe lançamentos por **Telegram**, em três formatos: **texto**, **áudio** e **foto** (ex.: foto de comprovante/nota).
- Registra dois tipos de lançamento: **gastos** (saídas) e **recebimentos/renda** (entradas). Cada recebimento tem um autor (Eduardo ou Maria), permitindo acompanhar a renda de cada um além dos gastos.
- **Documenta e categoriza** cada lançamento. Categorias iniciais de gasto: Alimentação/mercado, Uber, iFood, Gasolina — e outras conforme surgirem (a lista precisa ser extensível, não fixa em código). Recebimentos também são categorizáveis (ex.: salário, freela, reembolso).
- Gera **relatório mensal** de fechamento (automático em **01/mês às 9h**, fecha o mês anterior). Consolida gastos, recebimentos e o **saldo** (entradas − saídas), sempre em duas visões: **por pessoa** (Eduardo, Maria) e **total** (casal). Gastos aparecem **separados por banco** e por **forma de pagamento** (crédito/fatura vs. débito) — ver regra abaixo.
- Gera **relatório anual** de fechamento (automático em **31/12 às 20h**, `ANNUAL_HOUR`). Além dos agregados do ano (pessoa, categoria, banco), traz a visão **mês a mês** com barra de saldo por mês. Sob demanda via `/anual` (parcial do ano corrente).
- Gera **relatório parcial sob demanda**, sempre que Eduardo **ou** Maria pedirem (`/relatorio` para o mês, `/anual` para o ano).

## Regras de negócio que moldam a arquitetura

Estas restrições não são óbvias pelo código e devem ser respeitadas em qualquer implementação:

- **Dois usuários, um caixa compartilhado.** Os lançamentos de Eduardo e Maria alimentam o mesmo conjunto de dados. Identifique quem lançou (por chat/usuário do Telegram) e mantenha essa autoria, mas os relatórios são do casal (consolidados), com possibilidade de quebrar por pessoa — tanto para gastos quanto para recebimentos.
- **Gasto vs. recebimento é uma dimensão do lançamento, não uma entidade separada.** Todo lançamento tem um tipo (entrada/saída). O parsing precisa inferir esse tipo a partir da mensagem (ex.: "recebi", "salário", "caiu" → entrada; "gastei", "paguei" → saída).
- **Entrada multimodal exige extração.** Texto → parsing de valor/tipo/categoria/descrição. Áudio → transcrição antes do parsing. Foto → OCR/leitura do comprovante antes do parsing. Todos convergem para o mesmo formato normalizado de "lançamento" (valor, tipo, categoria, descrição, data, autor, origem).
- **Fechamentos são gatilhos temporais.** O mensal roda em **01/mês** (fecha o mês anterior); o anual roda em **31/12** (fecha o ano que termina). Cuidado com fuso (`TZ`) e com o marcador em `state.json` que evita disparo duplicado no mesmo dia. Decisão registrada: o anual fica em 31/12 mesmo (dezembro ainda fecha em 01/01 pelo mensal).
- **Relatório sob demanda é um comando conversacional.** Precisa distinguir intenção de "novo gasto" de intenção de "me dá o relatório" a partir da mensagem recebida.
- **Categorização deve ser extensível.** Novas categorias surgem com o uso; evite enum fixo — prefira dados/config que possam crescer sem mudar código.
- **Toda agregação tem duas dimensões: por pessoa e total.** Qualquer valor consolidado (por categoria, por banco, saldo) deve poder ser visto individualmente (Eduardo / Maria) e somado (casal).
- **Todo gasto tem um banco de origem e uma forma de pagamento.** Cada gasto (avulso ou não) sai de um banco, via **crédito** (entra na fatura do cartão) ou **débito** (sai direto da conta). O mesmo banco pode ser usado nas duas formas. O lançamento precisa capturar **banco** + **forma de pagamento** (crédito/débito) — o parsing infere isso da mensagem (ex.: "no crédito", "no débito", "débito", "cartão").
- **O banco pertence a uma pessoa e define o dono do gasto.** O mapeamento banco → pessoa deriva automaticamente o autor:
  - **Maria** → Nubank, Banco do Brasil
  - **Eduardo** → Inter, Bradesco

  Modele os bancos como dados/config (novos bancos podem surgir), com o mapeamento banco → pessoa. "Fatura" é a soma dos gastos de **crédito** de um banco no mês; débito não entra na fatura, mas ainda é rastreado por banco/pessoa.

## Stack

Reaproveitada do projeto irmão `agente-transfausto` (bot financeiro da empresa), com os mesmos padrões:

- **Node.js 22, ES Modules** (`"type": "module"`). Sem TypeScript.
- **Telegram Bot API via long-polling** (`getUpdates`), usando `fetch` nativo — **sem webhook, sem domínio**. Cliente mínimo escrito à mão (não usa lib de bot).
- **`@anthropic-ai/sdk`** (Claude Opus 4.8, `MODEL=claude-opus-4-8`) para leitura das entradas. Extração estruturada via **`output_config` com `json_schema`** — o modelo devolve JSON validado contra o schema do lançamento. Também usado para aplicar correções em linguagem natural sobre um lançamento já lido.
- **HTML desenhado → Chromium headless** para gerar os relatórios em **PDF A4**. `report.js` monta o HTML (hero, cartões de KPI, cartões por pessoa, barras de categoria, tabelas) e `pdf.js` aplica o CSS de design e imprime via `chromium --headless --no-sandbox --print-to-pdf`. O CSS usa `print-color-adjust: exact` para as cores saírem no PDF. (A dep `marked` não é mais usada pelo relatório.)
- **STT (transcrição de áudio): Groq — Whisper large v3 turbo** (`whisper-large-v3-turbo`), via `fetch` multipart para a API compatível-OpenAI da Groq (`GROQ_API_KEY`). Aceita o OGG/Opus do Telegram **sem ffmpeg**; gratuito no volume do casal. A Anthropic **não** transcreve áudio, por isso o provedor separado. A chave é **opcional**: sem ela, áudio é recusado com mensagem amigável e texto/foto seguem funcionando.
- **Persistência em arquivos JSON** num volume Docker (`/data`): `state.json` (offset do getUpdates, confirmações pendentes, marcadores de agendamento) + `months/<YYYY-MM>.json` (lançamentos do mês). Sem banco de dados.
- **Agendador in-process**: `setInterval` de 1 min que checa dia/hora e dispara os fechamentos (mensal em 01/mês; anual em 31/12), com marcadores `schedule.monthly`/`schedule.annual` em `state.json` para não disparar duas vezes no mesmo dia. Fuso via env `TZ`.
- **Configuração 100% por variáveis de ambiente** (`src/config.js`), com `required()` que aborta se faltar segredo. Nada de segredo no código.

### Diferenças em relação ao transfausto (o que precisa ser NOVO aqui)

- **Entrada multimodal:** o transfausto só lê **foto**. Aqui já foram adicionados **texto** (parsing direto em `extract.js`) e **áudio** (transcrição em `transcribe.js` via Groq Whisper → texto → `extract.js`).
- **Dois usuários** autorizados (Eduardo e Maria), não um. `ALLOWED_CHAT_IDS` com os dois; autoria do lançamento vem de quem enviou.
- **Modelo de dados diferente:** lançamento tem `tipo` (entrada/saída), `banco`, `forma de pagamento` (crédito/débito), `categoria`, `autor` (derivado do banco), em vez do schema de "viagem". Sem as 3 camadas de custo do transfausto.
- **Relatórios por pessoa + total** e **por banco/forma de pagamento**, não por viagem.

## Deploy

Mesmo pipeline do transfausto:

- **Docker** — imagem base `node:22-slim` + `chromium` e fontes (`fonts-liberation`, `fonts-dejavu-core`) para o PDF. Volume `/data` para persistir os meses.
- **CI:** GitHub Actions (`.github/workflows/docker.yml`) builda e publica a imagem no **GHCR** (`ghcr.io/eduardovougler/<nome>:latest`).
- **Runtime:** `docker-compose.yml` (compatível com **Docker Swarm** — usa `deploy.restart_policy`, não `restart:`; gerenciado via Portainer). No Swarm não se usa `build:`, aponta-se a imagem pronta do GHCR.
- **Segredos/env** (do Portainer): `TELEGRAM_TOKEN`, `ANTHROPIC_API_KEY`, `ALLOWED_CHAT_IDS`, `REPORT_CHAT_ID`, `MODEL`, `TZ`, e os horários de agendamento.

## Comandos

- **Rodar local:** `cd bot && npm install && npm start` (precisa de `.env` a partir de `.env.example`, e `chromium` instalado se for gerar PDF localmente — env `CHROMIUM_PATH`).
- **Build da imagem:** `docker build -t financeiro-casal ./bot` (ou deixar o GitHub Actions publicar no GHCR).
- Sem suíte de testes no projeto irmão — se for adicionar testes, documente aqui o comando.

## Arquitetura (fluxo ponta a ponta)

Código em `bot/src/`:

1. **`index.js`** — loop principal (long-polling), roteia mensagens: foto/áudio/texto → extração; comandos (`/relatorio`, `/fechar`, `/anual`, `/cancelar`, `/ajuda`); e o fluxo de **confirmação** ("li isto, confirma? responda SIM ou corrija em texto") antes de gravar. Roda o `tickSchedule` (fechamentos mensal e anual). Define o **autor de fallback** pelo chat id (1º autorizado = Eduardo, 2º = Maria).
2. **`telegram.js`** — cliente da Bot API (`getUpdates`, `sendMessage`, `sendDocument`, `downloadFile` para foto e áudio) via fetch. `sendMessage` usa `parse_mode: Markdown`.
3. **`extract.js`** — texto/foto → JSON do lançamento via Claude + `json_schema`; `applyCorrection` (correção em linguagem natural); `applyDono` deriva o **autor a partir do banco** (fonte da verdade), com fallback em quem enviou.
4. **`transcribe.js`** — áudio (OGG) → texto via Groq Whisper; o texto volta para `extract.js`.
5. **`domain.js`** — bancos (Nubank/BB → Maria; Inter/Bradesco → Eduardo), `resolveBanco`/`donoDoBanco`, e as listas de categorias. **É aqui que se adiciona banco ou categoria** — é dado, não código espalhado.
6. **`store.js`** — persistência JSON: `state.json` e `months/<YYYY-MM>.json`; `monthKey`/`previousMonthKey`, `addLancamento`, e `yearKey`/`loadYear` (consolida os 12 meses para o anual).
7. **`report.js`** — HTML dos relatórios. Seções reutilizáveis (KPIs, por pessoa, por categoria, por banco) compartilhadas por `buildReportHtml` (mensal, com detalhe de lançamentos) e `buildAnnualReportHtml` (anual, com a seção **mês a mês**).
8. **`pdf.js`** — CSS de design + HTML → PDF A4 via Chromium.

Fluxo: mensagem no Telegram → normalização (texto/áudio/foto → lançamento) → `applyDono` → **confirmação do usuário** → grava no mês → relatório (mensal em 01/mês, anual em 31/12, ou parcial sob demanda via `/relatorio`/`/anual`) → PDF enviado no chat.
