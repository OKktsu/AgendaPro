# Accounts e bancos por empresa: implementação incremental

## Estado desta branch

- Contexto autenticado definido em `backend/src/tenant/context.ts`.
- Rotas operacionais recebem a conexão pelo `TenantDatabaseResolver`.
- O resolvedor padrão continua compartilhado: nenhuma mudança de banco ocorre automaticamente.
- Resolvedor dedicado disponível para injeção: consulta diretório ativo, resolve segredo somente no servidor, reutiliza clientes e limita o total a 20 por processo.
- Ao atingir o limite, rejeita novas conexões com 503. Ainda não há evicção automática; nunca desconectar clientes em uso para liberar espaço.
- Dois schemas e migrations iniciais preparados: Accounts e tenant.
- O login e o cadastro existentes ainda usam o banco compartilhado.

## Divisão de dados acordada

Accounts contém Account (ID, e-mail, hash de senha, vínculo Google), Membership (accountId, tenantId, papel, estado) e TenantDirectory (ID, referência de conexão, estado técnico).
O banco da empresa contém Organization, UserProfile, clientes, serviços, profissionais, expediente e reservas. Não criar CPF/RG sem requisito real de produto; esses campos foram exemplos de dados que deverão permanecer no tenant.
UserProfile.accountId é referência lógica, sem foreign key entre bancos.

## Etapa de vínculos por empresa

- Uma identidade pode ter vários vínculos. A chave composta `(accountId, tenantId)` impede duplicidade, e o papel pertence ao vínculo, não à identidade.
- A migration `20261007000000_account_memberships` copia os vínculos existentes antes de remover `Account.tenantId` e `Account.role`. IDs, hashes e vínculos Google são preservados. Aplicar em manutenção, com backup, antes de iniciar a versão nova do backend dedicado. Não executar versões antiga e nova simultaneamente.
- O modo compartilhado permanece sem alteração. No modo dedicado, o middleware verifica vínculo ativo, papel atual e empresa ativa em cada requisição autenticada, incluindo `/auth/me`.
- Login com uma única empresa mantém o contrato atual. Com várias empresas ativas, retorna 409 sem emitir token nem escolher uma empresa arbitrariamente. O seletor público e sua sessão intermediária entram na próxima etapa.
- A seleção explícita existe somente na função interna de autenticação e exige senha válida ou identidade Google previamente verificada, além do vínculo ativo. Não há endpoint público para adicionar vínculos nesta etapa.
- Perfis continuam nas respectivas bases empresariais. Suspensão ou mudança de papel invalida o acesso de tokens antigos; não são alteradas permissões por confiar apenas nas claims do token.
- `npm run test:integration` valida backfill legado em schema transacional descartável e uma conta OWNER em A / STAFF em B, incluindo bloqueios e revogação. O healthcheck do laboratório espera TCP para não confundir o PostgreSQL temporário de inicialização com o servidor pronto.

O identificador atual `organizationId` é mantido como identificador de tenant para preservar o contrato da API. Um banco distinto no mesmo servidor PostgreSQL não isola CPU, disco nem administradores; permissões por banco são necessárias.

## Próximas etapas obrigatórias antes de ativar multi-base

1. Subir PostgreSQL local e aplicar as migrations em bancos NOVOS de teste, preservando o volume e a base atual.
2. Criar credenciais por banco com acesso restrito; a credencial de provisionamento não deve ser usada pela API.
3. Adaptar login: Accounts verifica hash, valida tenant ativo, carrega UserProfile por accountId na base correspondente e emite token. Emitir claims mínimos; nome e e-mail não precisam estar no JWT.
4. Adaptar cadastro com provisionamento rastreável e repetível. Uma transação Prisma não abrange Accounts e outro banco: usar estados PROVISIONING/ACTIVE/FAILED, com retomada após falha.
5. Conectar o resolvedor dedicado no bootstrap e encerrar todos os pools no shutdown. Sem fallback compartilhado para tenants desconhecidos/inativos.
6. Implementar migração idempotente com backup, modo de verificação, comparação de contagens e relações. Nunca apagar dados originais nesta etapa.
7. Testes reais com dois bancos: login, perfil, CRUD, IDs iguais entre tenants, falhas de permissão, disponibilidade e concorrência de reservas. Os testes atuais com mocks não comprovam isolamento PostgreSQL.
8. Só após validar, ativar o modo dedicado explicitamente e publicar PR pronta para revisão.

## Compatibilidade temporária

O resolvedor operacional ainda instancia o cliente Prisma original para manter os tipos dos serviços. Ele consulta as tabelas operacionais presentes no schema tenant; credenciais e perfil não são acessados por essa interface. A integração de autenticação deverá usar os clientes específicos de Accounts e tenant gerados por `npm run db:generate`.

## Desenvolvimento

Execute `npm run db:generate`, `npm run lint`, `npm test` e `npm run build`.
Migrations independentes: `prisma migrate deploy --schema prisma/accounts/schema.prisma` e `prisma migrate deploy --schema prisma/tenant/schema.prisma` dentro de backend, com URLs de bancos novos explicitamente configuradas.
