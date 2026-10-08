# Plano das próximas etapas de filas

Estado atual: fundação Redis/BullMQ e integração das reservas com outbox concluídas.
Dispatcher e consumidor são processos independentes; envio continua simulado.

## 3 — Separar os processos de background — implementada

Antes de integrar mensagens externas, separar dois papéis no mesmo backend e
repositório, compartilhando contratos, configuração e resolução de tenants:

- Dispatcher: consulta o outbox no PostgreSQL, publica no Redis e confirma a
  publicação. Não consome trabalhos nem envia mensagens.
- Worker de lembretes: consome a fila, revalida a reserva e processa o pedido.
  Não consulta periodicamente o outbox para publicar trabalhos.

Não é uma migração para microserviços. A separação permite iniciar, parar e
dimensionar cada processo independentemente, sem duplicar necessariamente o outro.
Começar com um dispatcher e permitir vários consumidores; manter publicação por
ID estável e processamento idempotente mesmo se dois dispatchers coincidirem.

Critérios de aceite:

1. Comandos independentes de desenvolvimento e execução compilada para cada papel.
2. Dispatcher sozinho publica trabalhos; eles aguardam sem consumidor.
3. Consumidor sozinho processa trabalhos já publicados, sem executar o polling.
4. Dois consumidores concorrentes não repetem o efeito simulado no banco.
5. Reiniciar um processo não exige reiniciar API nem o outro processo.
6. Falha Redis mantém pedidos recuperáveis; cancelamento, delayed jobs, isolamento
   entre empresas e encerramento das conexões continuam cobertos por testes.
7. Demonstração `probe` tem execução documentada e não é misturada silenciosamente
   com envio de lembretes. Migração dos comandos atuais fica explícita no README.
8. CI executa testes dos dois papéis e integração real antes do merge da PR.

Validação: testes unitários de polling/encerramento e sete testes com processos
Node reais, incluindo versões compiladas, consumidores e dispatchers concorrentes,
reinícios independentes e queda/recuperação real do Redis. Ver comandos no README.

Não implementar nesta etapa: provedor externo, mudanças de infraestrutura de
produção, Kubernetes, Kafka ou divisão de repositórios. Containers próprios para
os processos podem ser uma etapa posterior de estudo.

## 4 — Entrega externa e controle de falhas

Escolher com o usuário canal e provedor antes de configurar credenciais ou enviar
mensagens reais. Manter um modo local/teste sem envio externo por padrão.

Planejar persistência do estado de entrega, chave de idempotência com o provedor,
falhas transitórias versus permanentes, backoff, limite de tentativas, timeouts e
limites de envio. Não prometer entrega exatamente uma vez sem suporte do provedor.
Revalidar cancelamento antes do envio e explicitar que não é possível desfazer uma
mensagem já entregue.

Critérios de aceite: testes com provedor falso, nenhum segredo ou dado pessoal no
payload Redis/logs, isolamento por empresa, falhas registradas e uma demonstração
real somente com destinatário e credenciais autorizados pelo usuário.

## 5 — Operação, observabilidade e estudo de escala

Adicionar visibilidade de pendências, falhas e atrasos; retry operacional seguro,
alertas, limpeza do histórico PostgreSQL e paginação/gestão de conexões para superar
os limites atuais da demo. Testar carga e dimensionar consumidores conforme volume
e limites do provedor; aumentar consumidores não resolve sozinho todo gargalo.

Depois, estudar containers separados e Kubernetes para dimensionamento dos
processos. Configuração de deploy e eventual custo exigem planejamento próprio.
