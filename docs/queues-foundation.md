# Fundação das filas

Esta etapa prepara Redis, BullMQ e um worker independente. Não muda as rotas da
API, não acessa bancos de empresas e não envia e-mail, WhatsApp ou Discord.
O trabalho `probe` recebe somente um UUID e devolve o UUID e a data de processamento.

## Rodar localmente

Com Docker Desktop ativo e dependências instaladas, na raiz do projeto:

```powershell
docker compose up -d --wait redis
npm run worker:dev
```

Deixe o worker aberto e, em outro terminal, execute:

```powershell
npm run queue:probe
```

O produtor imprime o ID aceito na fila; o worker imprime a conclusão desse ID.
Sem worker, o trabalho fica aguardando no Redis e será consumido quando ele iniciar.
Use Ctrl+C para encerrar o worker. API, frontend e worker são processos separados;
nenhum worker é iniciado dentro de uma requisição HTTP.

Depois de `npm run build -w backend`, também é possível iniciar o worker compilado:
`npm run worker:start -w backend`.

## Configuração

Os comandos do workspace backend leem `backend/.env`; use os valores de
`.env.example` quando precisar sobrescrever os padrões:

| Variável           | Padrão                   | Uso                                       |
| ------------------ | ------------------------ | ----------------------------------------- |
| REDIS_URL          | redis://127.0.0.1:6379/0 | Conexão do produtor e do worker           |
| QUEUE_PREFIX       | agendapro-local          | Namespace das chaves da fila              |
| WORKER_CONCURRENCY | 1                        | Trabalhos simultâneos por worker (1 a 10) |

`REDIS_PORT` altera a porta publicada pelo Compose. Ao alterá-la, ajuste também
`REDIS_URL`. Produtor e worker precisam usar a mesma URL e prefixo.
Prefixo separa ambientes, mas não substitui autenticação ou isolamento de tenants.
URLs inválidas falham sem expor suas credenciais. `rediss://` habilita TLS.

## Docker e persistência

O serviço Redis publica sua porta somente em `127.0.0.1` e usa um volume próprio,
`redis_data`. AOF com sincronização a cada segundo preserva trabalhos após um
restart normal; falha abrupta pode perder os últimos dados não sincronizados.
`noeviction` impede descartar chaves para liberar memória: ao atingir o limite de
128 MB, novas escritas podem falhar. Essa configuração local não é uma configuração
de produção: ainda seria necessário configurar acesso restrito, ACL, TLS e monitoramento.

Para parar somente Redis: `docker compose stop redis`. Não use `docker compose
down --volumes` no ambiente normal: esse comando também apagaria o volume PostgreSQL.

## Comportamento e limites

- O produtor falha em tempo limitado quando Redis está indisponível.
- O worker tenta reconectar; isso não equivale a repetir um trabalho que falhou.
- Nesta etapa cada trabalho tem uma tentativa, sem chamadas externas.
- Histórico concluído: até 100 trabalhos/24 horas; falhas: até 100/7 dias.
  A limpeza por idade ocorre durante operações da fila, não como um cron exato.
- O worker tenta finalizar trabalhos ativos ao receber SIGINT/SIGTERM, com limite
  de 10 segundos. Um encerramento abrupto pode levar à recuperação/reexecução.
- Não há garantia de execução exatamente uma vez. Também não existe ainda uma
  transação atômica entre PostgreSQL e Redis. A próxima etapa deve tratar a entrega
  confiável dos lembretes, idempotência, cancelamento e contexto da empresa.
- Um timeout do produtor não comprova que o trabalho não foi aceito no servidor;
  não repita efeitos externos sem uma estratégia de idempotência.

## Testes e CI

`npm test -w backend` executa os testes unitários de configuração e payload sem
exigir Redis. `npm run test:queue` cria um projeto Compose aleatório com Redis e
volume descartáveis, verifica espera sem worker, processamento, payload inválido,
separação de namespaces, indisponibilidade e persistência após restart.

O script remove somente esse laboratório ao terminar; não apaga filas ou volumes
do ambiente normal. Se houver interrupção forçada do script, confira o nome
`agendapro-queue-test-*` impresso antes de limpar manualmente o laboratório.
O teste integrado é opt-in e não deve ser executado apontando para Redis de produção.

O workflow CI executa os testes unitários no job `verify` e o laboratório Redis no
job `multibase`, além dos testes PostgreSQL já existentes. O merge automático
continua aguardando esses jobs; não foi adicionado deploy.
