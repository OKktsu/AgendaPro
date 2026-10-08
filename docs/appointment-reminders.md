# Lembretes de agendamentos — etapa 2

Esta etapa conecta as reservas a uma fila real. O processamento é simulado:
marca `PROCESSED` no banco e imprime o resultado no worker. Não envia mensagens
externas e `PROCESSED` NÃO significa e-mail/WhatsApp entregue.

## Fluxo

1. A API cria a reserva e uma linha `ReminderOutbox` na mesma transação PostgreSQL.
   Se o pedido de lembrete falhar, a reserva também é revertida.
2. O processo worker consulta os pedidos e os publica no Redis usando BullMQ.
3. O BullMQ libera o trabalho quando chegar a hora programada.
4. O worker resolve a empresa pelo Accounts (modo dedicado), consulta sua base
   e só processa um pedido devido cuja reserva ainda esteja `SCHEDULED` e futura.
5. O banco registra o processamento com atualização condicional atômica.

Outbox é o nome do registro durável que faz a ponte entre PostgreSQL e Redis.
A API não abre uma conexão Redis para criar/cancelar uma reserva. Não existe
transação distribuída: pode haver reenvio após crash, tratado com ID estável e
atualização idempotente no banco. Vários workers podem publicar o mesmo ID;
o BullMQ mantém um trabalho por ID enquanto ele existir na fila.

## Política desta versão

- Um lembrete por reserva nova, 24 horas antes do início, calculado em instantes UTC.
- Reservas criadas com menos de 24 horas: processamento assim que possível.
- Reservas passadas: `SKIPPED`. Reservas existentes antes da migration não recebem
  lembretes retroativos. A data atual já pode ser criada pela API existente.
- Cancelar reserva cancela o pedido pendente/enfileirado na mesma transação.
  O trabalho pode permanecer fisicamente no Redis até seu horário; o worker ignora
  o pedido cancelado. Não se promete apagar nem interromper um trabalho já ativo.
- Cancelar depois do processamento não desfaz o efeito já concluído.
- Se o worker voltar depois do início da reserva, ignora o lembrete vencido.
- Se o trabalho chegar antes do horário confirmado pelo PostgreSQL, volta ao estado
  delayed sem concluir o pedido nem consumir tentativas de falha.
- Payload da fila: somente IDs de organização, reserva e lembrete. Sem nome,
  telefone, e-mail, token ou connection string. Dados pessoais permanecem na base.
- Filas usam três tentativas com backoff exponencial para falhas de processamento.
  Depois delas, um job `failed` exige investigação/retry operacional; alerta e
  recuperação automática avançada ficam para a etapa seguinte.
- Pedidos `PENDING` permanecem no banco enquanto Redis estiver indisponível.
  O produtor de longa duração tenta reconectar, mas limita cada comando.
- Pedidos `QUEUED` devidos também são reconciliados. Se Redis perder um trabalho,
  o pedido ainda pode ser republicado; o registro terminal no banco impede repetir
  o efeito simulado, inclusive após a limpeza do histórico Redis.
- Atrasos não são um relógio exato: worker parado, carga ou indisponibilidade podem
  atrasar o processamento. Consulte [delayed jobs do BullMQ](https://docs.bullmq.io/guide/jobs/delayed).

## Rodar localmente

O backend e worker precisam apontar para as mesmas bases. Os comandos do workspace
leem `backend/.env`. Shared exige `DATABASE_URL`; dedicated exige
`ACCOUNTS_DATABASE_URL`, `TENANT_DATABASE_URLS` e `DATABASE_MODE=dedicated`.
O worker não usa JWT nem conta fictícia: é um processo interno com acesso restrito
às conexões configuradas. No modo dedicado, só considera tenants `ACTIVE`, sem fallback.

Antes de iniciar uma versão nova, aplique migrations, com API/worker parados
quando necessário para regenerar o cliente no Windows:

```powershell
npm run db:generate
npm run db:deploy -w backend
```

Para bases dedicadas, aplique também `prisma migrate deploy --schema
backend/prisma/tenant/schema.prisma` fornecendo `TENANT_DATABASE_URL` de CADA
empresa. Não execute a migration de negócio no Accounts. Bases provisionadas novas
devem receber todas as migrations de tenant antes de ficarem ativas.

```powershell
docker compose up -d --wait redis
npm run worker:dev
```

Com a API/frontend rodando, crie uma reserva futura com menos de 24h para observar
o resultado no terminal. Cancelando antes de iniciar o worker, ele não processará
o pedido. Nenhuma mensagem externa será enviada.

`REMINDER_POLL_INTERVAL_MS` controla o intervalo de consulta (padrão 5000, faixa
1000–60000). Não há consultas sobrepostas no mesmo processo. Cada ciclo considera
até 100 pedidos por empresa. Este runtime demo suporta até 20 empresas/clientes;
acima disso bloqueia explicitamente e exige paginação/gestão de pools, não promete
suportar escala ilimitada. Alterar mapa em runtime requer reiniciar o worker.

## Testes e limites

`npm run test:reminders` cria PostgreSQL e Redis exclusivos com nomes e portas
aleatórios. Aplica migrations shared, Accounts e de dois tenants; testa rollback,
duplicação, cancelamento, vencimento, concorrência, isolamento e consumo real.
Remove somente seu laboratório e volume. Nenhum dado normal é apagado.
O CI executa esses testes em cada atualização da PR, antes do merge automático.

Os SQLs parametrizados em `reminder-store.ts` são usados pelos clientes Prisma dos
dois modos. Doubles de testes em memória sem `$executeRaw` não simulam o outbox;
o contrato transacional é validado com PostgreSQL real. Não há bypass configurável
para Prisma real: sem a tabela/migration, a criação falha e a transação é revertida.

Ainda faltam envio externo, idempotência com o provedor, observabilidade, políticas
de retry operacional, limpeza de registros terminais no PostgreSQL e eventual
reagendamento (a API ainda não oferece alteração do horário de uma reserva).
As garantias desta etapa valem para a atualização simulada do banco, não para
execução exatamente uma vez de serviços externos.
