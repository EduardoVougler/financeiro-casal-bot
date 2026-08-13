# Financeiro do Casal

Bot privado de Telegram para registrar e acompanhar as finanças de Eduardo e Maria por conversa. Aceita texto, áudio e foto, pede confirmação antes de gravar e gera relatórios mensais e anuais em PDF.

## Como funciona

- Claude classifica a intenção e extrai um ou vários lançamentos estruturados.
- Áudios são transcritos pelo Groq Whisper; fotos são lidas pelo Claude.
- Todo lançamento pode ser corrigido, editado ou removido em linguagem natural, sempre com confirmação.
- Categorias e bancos são vocabulários abertos: instituições e categorias novas passam a ser reutilizadas depois do primeiro uso.
- Banco e titular são independentes. Eduardo e Maria podem ter contas separadas no mesmo banco; o par `banco + autor` identifica a conta.
- Datas omitidas são materializadas como `DD/MM` no momento da leitura. Registros antigos salvos como `"hoje"` recuperam o dia por `registrado_em`.

Exemplos de conversa:

```text
gastei 154,90 no mercado no crédito do Nubank
o 2 é Eduardo Nubank
esse gasto foi no C6 da Duda
apaga o último lançamento
relatório de agosto
como foi 2025?
```

## Relatórios

O relatório mensal separa a informação em duas camadas:

1. Resumo com entradas, saídas, saldo, pessoas, categorias e contas/cartões.
2. Extrato em nova página, no formato `Data | Lançamento | Conta | Valor`.

Entradas e saídas são indicadas por sinal e cor. Banco, titular e forma de pagamento aparecem juntos, e categoria não é repetida quando coincide com a descrição.

## Estrutura

```text
bot/src/       código da aplicação
bot/test/      testes automatizados
bot/           Dockerfile, Compose e configuração Node
.github/       build e publicação da imagem no GHCR
CLAUDE.md      regras de negócio e arquitetura detalhada
```

Para executar, testar e operar o serviço, consulte [bot/README.md](bot/README.md). As invariantes completas para manutenção estão em [CLAUDE.md](CLAUDE.md).

