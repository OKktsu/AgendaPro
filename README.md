# AgendaPro

AgendaPro é uma plataforma de agendamento para negócios de serviços. Esta primeira entrega fornece uma base local reproduzível, pronta para a evolução de empresas, equipe e reservas.

## Stack

- Monorepo com npm workspaces: `frontend/` (React + Vite) e `backend/` (Fastify + TypeScript)
- PostgreSQL em Docker Compose e Prisma ORM
- ESLint, Prettier, testes com Vitest e CI no GitHub Actions

## Pré-requisitos

- Node.js 22 ou superior
- Docker Desktop (para o PostgreSQL)

## Rodando localmente

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie sua configuração local:

   ```bash
   cp .env.example .env
   ```

   No Windows PowerShell: `Copy-Item .env.example .env`.

3. Suba o banco:

   ```bash
   docker compose up -d
   ```

4. Gere o cliente do Prisma e aplique as migrations:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Inicie a aplicação:

   ```bash
   npm run dev
   ```

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

## Próximas entregas

1. Organizações, autenticação e isolamento de dados.
2. Serviços, profissionais, especialidades e horários de trabalho.
3. Reservas transacionais sem conflitos de agenda.
4. Interface de agenda e gestão do catálogo.
