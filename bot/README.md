# Bot — desenvolvimento e operação

## Requisitos

- Node.js 22.
- Uma conta/bot do Telegram.
- Chave da Anthropic.
- Chave da Groq apenas se a entrada por áudio for utilizada.
- Chromium para gerar PDFs fora do container.

## Execução local

```bash
cp .env.example .env
npm ci
npm start
```

O Node não carrega `.env` automaticamente. Ao executar fora de uma ferramenta que injete essas variáveis, exporte-as antes de `npm start`. `ALLOWED_CHAT_IDS` é obrigatório e a ordem define o remetente de fallback: primeiro Eduardo, segundo Maria.

Variáveis principais:

| Variável | Obrigatória | Função |
|---|---:|---|
| `TELEGRAM_TOKEN` | Sim | Token do BotFather |
| `ANTHROPIC_API_KEY` | Sim | Extração de texto e imagem |
| `ALLOWED_CHAT_IDS` | Sim | IDs pessoais autorizados, separados por vírgula |
| `GROQ_API_KEY` | Não | Transcrição de áudio |
| `REPORT_CHAT_ID` | Não | Destino dos relatórios automáticos |
| `MODEL` | Não | Modelo Anthropic |
| `TZ` | Não | Fuso das datas e agendamentos |
| `DATA_DIR` | Não | Diretório persistente; padrão `/data` |
| `CHROMIUM_PATH` | Não | Executável usado para gerar PDF |

## Testes

```bash
npm test
```

A suíte cobre datas, aliases, bancos compartilhados e novos, relatórios, autorização, persistência atômica, backup e idempotência.

## Persistência e recuperação

Os dados ficam em:

```text
/data/state.json
/data/state.json.bak
/data/months/YYYY-MM.json
/data/months/YYYY-MM.json.bak
/data/reports/
```

As gravações usam arquivo temporário e `rename` atômico. Antes de substituir um JSON válido, o bot preserva a versão anterior em `.bak`. Se o arquivo principal estiver corrompido, a leitura usa o backup; se ambos estiverem inválidos, o bot falha em vez de assumir dados vazios.

O volume ainda deve participar do backup regular do servidor. Os PDFs são temporários e removidos depois do envio ao Telegram.

## Docker e deploy

Build local:

```bash
docker build -t financeiro-casal-bot .
```

O workflow em `../.github/workflows/docker.yml` publica `ghcr.io/eduardovougler/financeiro-casal-bot:latest` após push em `main`. O `docker-compose.yml` usa essa imagem e um volume persistente, com uma única réplica. Não aumente o número de réplicas: long-polling e arquivos JSON pressupõem um único processo escritor.

O container possui healthcheck. O loop atualiza um marcador após cada long-poll bem-sucedido; o serviço fica unhealthy se ele não for atualizado por cinco minutos.

## Garantias operacionais relevantes

- O offset do Telegram avança somente depois do processamento.
- Confirmações de novos lançamentos são idempotentes por ID.
- Fechamentos só são marcados depois do envio do PDF e tentam novamente após falha.
- Chamadas externas e Chromium possuem timeout.
- Uma lista vazia de usuários autorizados impede a inicialização.

