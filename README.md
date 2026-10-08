# AgendaPro

## Filas: Redis e worker

A fundação das filas já está disponível. Consulte
[o guia de execução e testes](docs/queues-foundation.md) para iniciar o Redis,
o worker separado da API e um trabalho de demonstração.

As reservas novas também geram pedidos duráveis de lembretes, com processamento
simulado (sem envio externo). Veja [o guia de lembretes](docs/appointment-reminders.md).

Dispatcher e consumidor agora são processos independentes. Em terminais separados,
execute `npm run dispatcher:dev` e `npm run worker:dev`; `npm run dev` continua
iniciando somente API e frontend. Após `npm run build -w backend`, use
`npm run dispatcher:start` e `npm run worker:start`.

Migração: `worker:dev` não publica mais o outbox nem consome a demonstração probe.
Para esta última, use `npm run worker:probe:dev` (ou `worker:probe:start` após build)
e `npm run queue:probe`. Nenhum desses comandos altera a configuração do Docker.

AgendaPro é uma plataforma de agendamento para negócios de serviços. Esta primeira entrega fornece uma base local reproduzível, pronta para a evolução de empresas, equipe e reservas.

## Stack

- Monorepo com npm workspaces: `frontend/` (React + Vite) e `backend/` (Fastify + TypeScript)
- PostgreSQL em Docker Compose e Prisma ORM
- ESLint, Prettier, testes com Vitest e CI no GitHub Actions

## Pré-requisitos

- Node.js 24 ou superior
- Docker Desktop (para o PostgreSQL)

## Rodando localmente

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie sua configuração local:

   ```bash
   cp .env.example .env
   cp .env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

   No Windows PowerShell: use `Copy-Item` no lugar de `cp`.

3. Para habilitar “Continuar com Google”, crie um OAuth Client ID do tipo **Web application**
   no Google Cloud Console. Adicione `http://localhost:5173` como origem JavaScript autorizada,
   depois use o mesmo Client ID em `GOOGLE_CLIENT_ID` no `backend/.env` (e no `.env` da raiz) e em
   `VITE_GOOGLE_CLIENT_ID` no `frontend/.env`. Não é necessário colocar um Client Secret no
   frontend. Sem essas configurações, o login por e-mail e senha continua disponível.

4. Suba o banco:

   ```bash
   docker compose up -d
   ```

5. Gere o cliente do Prisma e aplique as migrations:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

6. Inicie a aplicação:

   ```bash
   npm run dev
   ```

   No Windows, se o Node reportar `UNABLE_TO_VERIFY_LEAF_SIGNATURE` ao consultar o Google,
   habilite os certificados confiáveis do sistema antes de iniciar: `$env:NODE_OPTIONS = '--use-system-ca'`.
   Essa opção mantém a validação HTTPS ativa.

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- Saúde da API: `http://localhost:3000/health`

## Comandos úteis

```bash
npm run lint
npm test
npm run build
npm run format:check
```

## Merge automático após CI

PRs prontas do próprio repositório para `main` ativam auto-merge pela etapa
`Enable auto-merge` do CI. A etapa aguarda `verify` e `multibase`, usa o token
temporário do GitHub Actions e confere se a revisão da PR continua a mesma.
O GitHub conclui o merge apenas após os checks obrigatórios e demais regras
de proteção. Rascunhos e PRs de forks não ativam auto-merge.

A proteção de `main` exige `verify`, `multibase`, `Build frontend` e
`Enable auto-merge`, além de branch atualizada e conversas resolvidas. Não há
aprovação humana obrigatória. A configuração está versionada em
`.github/branch-protection.main.json`, mas é uma configuração do repositório:
alterar o arquivo sozinho não modifica as regras no GitHub.

Para reaplicar em uma conta com permissão administrativa:

```bash
gh api --method PATCH repos/OKktsu/AgendaPro -F allow_auto_merge=true
gh api --method PUT repos/OKktsu/AgendaPro/branches/main/protection --input .github/branch-protection.main.json
```

Os workflows de frontend geram apenas um artefato de build; o merge não publica
a aplicação no GitHub Pages.

O CI marca as PRs elegíveis com `discord-pending`. O workflow de alertas observa
o término do CI e envia a mensagem somente para PRs já integradas em `main`.
Depois de receber sucesso do Discord, troca a marca por `discord-sent`.
Execuções são serializadas para evitar envios concorrentes. A verificação a cada
15 minutos recupera avisos que ficaram pendentes por atraso do merge ou falha no
envio; o agendamento do GitHub pode sofrer atrasos. Também é possível executar
manualmente o workflow `Alerta no Discord` para processar avisos pendentes.
Os merges manuais continuam sendo detectados por `push`.

As labels `discord-pending` e `discord-sent` devem existir no repositório.
O webhook permanece no secret `DISCORD_WEBHOOK_URL`; não são necessários
tokens pessoais ou mudanças nas credenciais do Discord.

## Autenticação e Contexto de Organização

As rotas protegidas da API identificam o usuário autenticado, sua organização e seu papel (`role`) exclusivamente a partir do token JWT validado.

### Enviando o token nas requisições

Para acessar endpoints autenticados, envie o token JWT no cabeçalho HTTP `Authorization` com o esquema `Bearer`:

```http
Authorization: Bearer <SEU_TOKEN_JWT>
```

#### Exemplos com `curl`

1. Consultar os dados do usuário autenticado e contexto da organização (`GET /me`):

   ```bash
   curl -H "Authorization: Bearer SEU_TOKEN_JWT" http://localhost:3000/me
   ```

2. Acessar área restrita a proprietários (`GET /owner-area`, requer papel `OWNER`):

   ```bash
   curl -H "Authorization: Bearer SEU_TOKEN_JWT" http://localhost:3000/owner-area
   ```

> **Segurança multitenant**: O contexto de organização e privilégios é derivado unicamente do token JWT. O backend rejeita tentativas de manipulação ou troca de empresa via `body`, `query` ou `params`.

### Login com Google (OAuth 2.0 / OpenID Connect)

Na tela de entrada, o botão do Google usa o Google Identity Services para obter uma credencial de
identidade. O backend valida assinatura, emissor, validade e audiência da credencial com o Client
ID configurado e exige e-mail verificado. O token do Google nunca é usado diretamente nas rotas da
AgendaPro: após a validação, o backend associa o identificador estável do Google (`sub`) a uma
conta existente e emite o JWT próprio da aplicação.

Se não existe conta, o primeiro login retorna `registration_required` com nome e e-mail verificados
e abre o cadastro de empresa. O usuário confirma a empresa e define uma senha local; o backend
revalida a credencial Google, utiliza o e-mail verificado e cria a conta já vinculada, emitindo a sessão.
A credencial de cadastro permanece apenas em memória no frontend. Nenhuma empresa é criada ao
simplesmente clicar no Google. A associação é persistida no campo `googleSubject` da base de identidade (`User` no
modo compartilhado ou `Account` no modo Accounts), nunca na base de dados do tenant.

Para ativar localmente, configure o mesmo Client ID em `GOOGLE_CLIENT_ID` no `.env` da raiz e
`VITE_GOOGLE_CLIENT_ID` em `frontend/.env`, reinicie a aplicação e aplique as migrations. O
Client ID é público; não adicione o Client Secret ao frontend.

No modo padrão (`DATABASE_MODE=shared`), aplique as migrations com `npm run db:deploy -w backend`.
Se estiver usando o modo de base dedicada, aplique também a migration de Accounts com
`npm run db:deploy:accounts -w backend`, apontando `ACCOUNTS_DATABASE_URL` para a base Accounts.

## Reservas sem Conflito de Horário e Garantia PostgreSQL

A plataforma AgendaPro impede sobreposição de reservas tanto na camada de aplicação quanto de forma definitiva e atômica no motor relacional do PostgreSQL.

### Como aplicar as migrations

1. Suba o container do banco de dados (se estiver rodando localmente via Docker):

   ```bash
   docker compose up -d
   ```

2. Em ambiente de desenvolvimento, aplique as migrations pendentes:

   ```bash
   npm run db:migrate
   ```

3. Em ambiente de produção ou CI (sem prompt interativo):

   ```bash
   npm run db:deploy -w backend
   ```

### Garantia final no PostgreSQL: Exclusion Constraint (`EXCLUDE USING gist`)

A consulta prévia de disponibilidade não é a única proteção. Mesmo que duas requisições HTTP paralelas cheguem no exato mesmo milissegundo, a integridade é assegurada pela constraint de exclusão declarada na migration `20260923030000_add_customers_and_appointments`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
ADD CONSTRAINT "no_overlapping_scheduled_appointments"
EXCLUDE USING gist (
  "professionalId" WITH =,
  tsrange("startsAt", "endsAt", '[)') WITH &&
)
WHERE ("status" = 'SCHEDULED');
```

- **Intervalos semiabertos `[)`**: o operador `tsrange("startsAt", "endsAt", '[)')` define que o término é exclusivo. Uma reserva de `10:00–10:45` impede uma nova reserva às `10:30`, mas permite perfeitamente uma reserva adjacente às `10:45` sem colisão.
- **Isolamento por profissional**: o predicado `"professionalId" WITH =` (habilitado pela extensão `btree_gist`) permite que profissionais distintos atendam no mesmo horário simultaneamente.
- **Predicado de status ativo**: a cláusula `WHERE ("status" = 'SCHEDULED')` garante que agendamentos com status `CANCELLED` não impeçam novos agendamentos para o mesmo intervalo.
- **Tradução transacional**: caso ocorra tentativa simultânea, o PostgreSQL aborta a transação conflitante com o erro `23P01` (`exclusion_violation`), que a API intercepta e converte em resposta HTTP `409 Conflict`.

### Como testar concorrência

Os testes automatizados cobrem cenários concorrentes disparando requisições em paralelo (`Promise.all`):

```bash
npm test -w backend -- appointment-concurrency.test.ts
```

Ou execute a suíte de testes completa:

```bash
npm test
```

Cenários validados na concorrência:

- Duas requisições simultâneas para o mesmo profissional e horário: exatamente uma retorna `201 Created` e a outra retorna `409 Conflict`.
- Reserva das 10:00–10:45 impede tentativa às 10:30 (`409`).
- Reserva das 10:45 é permitida após uma de 10:00–10:45 (`201`).
- Dois profissionais diferentes podem ser agendados simultaneamente no mesmo horário (`201`).
- Cancelamento de reserva (`PATCH /appointments/:id/cancel`) libera o intervalo imediatamente.
- Disponibilidade (`GET /availability`) remove horários ocupados por reservas ativas e ignora canceladas.

## Frontend MVP (Interface Web)

A interface do usuário do AgendaPro é construída com React 19 + TypeScript + Vite, localizada em `frontend/`.

### Configuração de Ambiente (`VITE_API_URL`)

O frontend se comunica com a API Fastify centralizada. Para configurar o endereço do backend:

1. Crie o arquivo de ambiente em `frontend/`:

   ```bash
   cp frontend/.env.example frontend/.env
   ```

   No Windows PowerShell:

   ```powershell
   Copy-Item frontend\.env.example frontend\.env
   ```

2. O conteúdo padrão define:
   ```env
   VITE_API_URL=http://localhost:3000
   ```

### Como Executar Frontend e Backend

- **Simultaneamente (recomendado)**:

  ```bash
  npm run dev
  ```

  Inicia concorrentemente o frontend em `http://localhost:5173` e a API em `http://localhost:3000`.

- **Apenas o Frontend**:

  ```bash
  npm run dev -w frontend
  ```

- **Apenas o Backend**:
  ```bash
  npm run dev -w backend
  ```

### Fluxo Resumido de Uso da Aplicação

1. **Cadastrar Empresa**:
   - Acesse `http://localhost:5173` e selecione a aba **"Cadastrar Empresa"**.
   - Preencha o nome do estabelecimento, seu nome completo, e-mail e senha (mínimo 8 caracteres).
   - O sistema cria a organização e a conta de usuário com papel `OWNER`.
2. **Fazer Login**:
   - Entre com as credenciais cadastradas na aba **"Entrar"**.
   - A sessão é persistida via JWT e validada automaticamente via `GET /auth/me` ao recarregar a página.
3. **Criar Serviços**:
   - Navegue até a aba **"Serviços"** no menu lateral.
   - Clique em **"Novo Serviço"**, informe o nome, duração em minutos e preço em reais (ex: `85,00`).
4. **Criar Profissional e Definir Expediente**:
   - Navegue até a aba **"Equipe"**.
   - Clique em **"Novo Profissional"** e insira o nome.
   - No card do profissional criado, clique em **"Vincular Serviço"** e associe os serviços executados por ele.
   - Em seguida, clique em **"Adicionar Horário"** para cadastrar os dias da semana e horários de início e término (ex: Segunda-feira das 08:00 às 18:00).
5. **Cadastrar Cliente**:
   - Navegue até a aba **"Clientes"**.
   - Clique em **"Novo Cliente"**, informe o nome, telefone e e-mail (opcional).
6. **Agendar Reserva sem Conflitos**:
   - Acesse a aba **"Agenda"**.
   - Clique no botão **"+ Novo Agendamento"**.
   - Escolha a data, o cliente, o profissional e o serviço.
   - O sistema consulta automaticamente a rota `GET /availability` e exibe os horários livres como botões de seleção rápida.
   - Selecione o horário desejado e clique em **"Confirmar Reserva"**.
   - Em caso de concorrência ou conflito simultâneo (`409 Conflict`), a interface exibirá a mensagem orientando a escolher outro horário disponível.
7. **Cancelar Reserva**:
   - Na lista da Agenda Diária, selecione o atendimento desejado para inspecionar os detalhes no painel lateral.
   - Clique em **"Cancelar Agendamento"** e confirme a operação. O slot será liberado instantaneamente.
