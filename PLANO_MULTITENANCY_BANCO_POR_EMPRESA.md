# Evolução arquitetural: um banco PostgreSQL por empresa

## Objetivo de estudo

Evoluir o AgendaPro de multi-tenancy por linha (tabelas compartilhadas com `organizationId`) para um modelo híbrido:

- **Accounts**: credenciais mínimas de autenticação, vínculo do usuário ao tenant e mapeamento seguro para a base correta;
- **banco de cada organização**: usuários, credenciais, perfis, configurações pessoais, clientes, serviços, profissionais, expedientes e reservas daquela única empresa.

Cada organização deve usar uma conexão PostgreSQL independente. Uma organização não deve conseguir consultar os dados da outra nem pela aplicação nem usando o cliente Prisma do tenant errado.

## Modelo atual

```text
Um PostgreSQL + tabelas compartilhadas
Organization A ─┐
Organization B ─┼─ Customer, Service, Professional, Appointment
Organization C ─┘      (filtrados por organizationId)
```

O modelo atual é apropriado para construir o MVP: simples, barato, com uma única migration e bom para desenvolver as regras de produto.

## Modelo alvo

```text
Accounts
├─ Account
│  ├─ id opaco
│  ├─ email normalizado
│  ├─ passwordHash
│  └─ tenantId (ou Membership para múltiplos tenants no futuro)
└─ TenantDirectory
   ├─ tenantId opaco
   ├─ databaseKey ou referência segura de conexão
   └─ status técnico de provisionamento

Banco da Barbearia Central
├─ User
├─ UserProfile
├─ OrganizationSettings
├─ Customer
├─ Service
├─ Professional
├─ ProfessionalWorkSchedule
└─ Appointment

Banco do Salão Exemplo
├─ User
├─ UserProfile
├─ OrganizationSettings
├─ Customer
├─ Service
├─ Professional
├─ ProfessionalWorkSchedule
└─ Appointment
```

## Momento recomendado: o sweet spot

Implementar **após** estes itens estarem concluídos e integrados na `main`:

1. MVP de reservas completo: criar, listar, cancelar e validar conflitos.
2. CRUDs administrativos de clientes, serviços e profissionais.
3. Agenda semanal e filtros básicos.
4. Cobertura de testes do domínio atual e CI estável.

Implementar **antes** de:

- Redis/BullMQ e lembretes;
- pagamentos e webhooks;
- OAuth com Google;
- observabilidade distribuída;
- deploy definitivo e Kubernetes;
- página pública de agendamento e white label por domínio.

### Por que esse ponto é ideal

Antes desse ponto, o modelo de dados e as regras de negócio ainda mudam muito; separar bancos cedo multiplicaria migrations e atrasaria o MVP. Depois de filas, pagamentos e deploy, cada integração passa a depender do modelo de conexão e a migração fica consideravelmente mais cara e arriscada.

## Fases de implementação

### Fase A — Preparar a fronteira de dados

- Mapear quais tabelas são de plataforma e quais pertencem ao tenant.
- Criar interfaces/repositórios para que serviços não dependam diretamente de um Prisma global.
- Garantir que serviços recebam um `TenantContext` já validado pelo middleware.
- Manter comportamento atual e testes verdes; esta fase não troca banco ainda.

### Fase B — Accounts com autenticação mínima e catálogo de tenants

- Criar o banco `accounts` com `Account` e `TenantDirectory`.
- `Account` guarda somente `id`, e-mail normalizado, hash de senha, tenantId e campos técnicos mínimos de autenticação; não persistir CPF, RG, foto, endereço, preferências, perfil ou configurações pessoais nele.
- O diretório guarda `tenantId`, referência segura ao banco e estado de provisionamento.
- Nunca expor URLs de banco em API, logs ou frontend.
- Para estudo local, usar uma URL por tenant em variáveis de ambiente; em produção, usar secret manager/referência segura.
- O login valida e-mail e senha no Accounts; depois o tenantId localizado seleciona o banco que contém o perfil completo daquele usuário.
- O JWT contém `tenantId`, `userId` e `role`; o middleware o converte em `TenantContext`.

### Fase C — Provisionamento de tenant

Ao criar uma organização:

1. criar um banco PostgreSQL para a organização;
2. aplicar migrations daquele banco, incluindo as tabelas de perfil e preferências de usuário;
3. criar o `Account` mínimo do primeiro OWNER no Accounts;
4. criar no banco recém-criado o perfil desse OWNER, referenciando `accountId` sem foreign key entre bancos;
5. gravar no Accounts o mapeamento técnico para aquele tenant;
6. somente então concluir o cadastro da organização;
7. se algo falhar, limpar ou marcar o provisionamento como falho de forma rastreável.

Para o ambiente local, o primeiro experimento pode criar manualmente dois bancos: `agendapro_tenant_a` e `agendapro_tenant_b`. Não automatizar criação de bancos de produção antes de entender permissões, backups e segurança.

### Fase D — Resolvedor de conexão

- Criar um `TenantDatabaseResolver`.
- Fluxo de login: e-mail/senha -> Account no Accounts valida credenciais -> tenantId -> diretório de Accounts -> perfil no banco do tenant -> JWT.
- Fluxo autenticado: JWT -> tenantId -> diretório de Accounts -> cliente Prisma do banco correto.
- Usar cache/pool controlado de clientes Prisma; não criar uma conexão nova a cada requisição.
- Fechar conexões ao encerrar a aplicação.
- Testar explicitamente que tenant A e tenant B recebem clientes diferentes, mesmo com IDs iguais.

### Fase E — Migração de dados e validação

- Criar uma ferramenta idempotente de migração do banco compartilhado para cada banco de tenant.
- Migrar uma organização de teste primeiro.
- Contar registros antes/depois e validar integridade de relações.
- Criar backup antes de qualquer migração real.
- Apenas depois avaliar migração das demais organizações.

## Critérios de aceite da evolução

1. Duas organizações de teste usam bancos PostgreSQL distintos.
2. Usuário autenticado na empresa A cria dados somente no banco A.
3. Usuário autenticado na empresa B não encontra dados da empresa A, mesmo que tente manipular IDs ou parâmetros.
4. Login usa o Accounts com e-mail e hash de senha; dados pessoais detalhados e perfis ficam no banco do tenant.
5. Migrations são aplicadas de forma repetível para todos os bancos de tenant.
6. Testes de integração cobrem o resolvedor de tenant e a separação física.
7. Logs não contêm senhas ou URLs completas de banco.
8. CI continua passando; testes que precisem de PostgreSQL sobem bancos isolados em Docker Compose.

## Riscos e limites

- **Migrations**: cada mudança de schema precisa ser aplicada em todos os bancos de clientes.
- **Conexões**: muitos tenants podem esgotar conexões sem pool/cache e limites.
- **Operação**: backups, restauração e monitoramento tornam-se por tenant.
- **Custo**: bancos gerenciados por empresa podem ficar caros; para estudo/local, múltiplos bancos no mesmo servidor PostgreSQL são suficientes.
- **Relatórios globais**: métricas da plataforma devem ser agregadas com cuidado a partir do Accounts/eventos, não com consultas simples em uma tabela compartilhada.
- **Dados mínimos centralizados**: e-mail e hash de senha ainda são dados sensíveis. O Accounts deve ter acesso restrito, backup protegido, hash de senha forte e nunca registrar credenciais em logs.
- **Usuário em várias empresas**: substituir o `tenantId` único em Account por vínculos Membership conforme a evolução descrita abaixo.

## Evolução planejada: vários espaços e agenda pessoal

Decisão de produto: uma identidade no Accounts pode participar de várias empresas e possuir,
no máximo, um espaço pessoal. Esta evolução está planejada; não faz parte da implementação atual.

### Etapa 1 — Identidade e vínculos (após estabilizar OAuth e validar multibase)

- Accounts concentra identidade única, e-mail, hash de senha e vínculo Google.
- Separar Account dos acessos: Membership(accountId, workspaceId, role, status).
- Workspace diferencia COMPANY e PERSONAL e referencia o destino dos dados.
- Perfil e preferências continuam na base do espaço correspondente; nomes exibidos no seletor
  são metadados mínimos do espaço, sem centralizar perfis completos.
- Migrar cada acesso atual para Membership, preservando IDs e acesso existente.
- Critério: uma conta participa de três empresas com papéis distintos e uma agenda pessoal;
  unicidade impede duas Membership iguais e dois espaços pessoais para a mesma conta,
  inclusive em requisições concorrentes.

### Etapa 2 — Seleção do espaço após autenticação

- Autenticar identidade no Accounts e listar apenas espaços ativos autorizados.
- Mostrar seletor com empresas e agenda pessoal; com apenas um espaço, abrir diretamente.
- Validar Membership no servidor antes de emitir sessão do espaço selecionado.
- Troca de espaço renova o contexto da sessão e limpa caches de dados do frontend.
- Critério: IDs manipulados, vínculos removidos e espaços inativos não permitem acesso;
  a seleção não revela URLs ou credenciais de bancos.

### Etapa 3 — Banco compartilhado exclusivo das agendas pessoais

- Manter banco dedicado por empresa e adicionar uma base personal compartilhada.
- PersonalEvent guarda accountId, título, início, fim e descrição, sem exigir serviço,
  profissional ou cliente. Perfil e preferências pessoais ficam nessa base.
- Derivar accountId da sessão, aplicar escopo em todas as operações e avaliar RLS
  com contexto por transação para evitar vazamento entre conexões do pool.
- Critério: duas contas pessoais não conseguem ler, alterar ou excluir dados uma da outra,
  mesmo com IDs conhecidos; integrações cobrem os dois tipos de destino.

### Etapa 4 — Interface pessoal e operação

- Agenda pessoal diária/semanal, criação/edição/exclusão de compromissos e seletor de espaço.
- Escolha Pessoal ou Empresa no onboarding somente quando os dois modos estiverem prontos.
- Reutilizar componentes visuais; lembretes ficam para a etapa posterior de filas.
- Critério: trocar de empresa para agenda pessoal não reaproveita permissões nem dados;
  migrations, backup e CI contemplam Accounts, bases empresariais e base pessoal.

## Fora de escopo inicial

- Criar cluster PostgreSQL separado por empresa.
- Kubernetes e banco por pod.
- Domínio personalizado.
- Dados pessoais completos de usuário no Accounts.
- Expor conexão de banco ou configuração de tenant para o frontend.

## Próximo prompt para agente (quando chegar a hora)

> Implemente somente a Fase A deste plano: introduza uma fronteira de acesso a dados baseada em `TenantContext`, preservando o banco compartilhado atual e todo comportamento existente. Não crie bancos por tenant ainda. Adicione testes que provem que os serviços recebem o contexto de organização de forma explícita e que nenhuma chamada usa `organizationId` vindo do cliente. Faça uma PR pequena, com CI verde, para `main`.
