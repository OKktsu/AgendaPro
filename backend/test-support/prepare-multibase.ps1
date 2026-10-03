$ErrorActionPreference = 'Stop'
# Somente o laboratório isolado na porta 55433. Não usa DATABASE_URL do projeto.
$previousAccounts = $env:ACCOUNTS_DATABASE_URL
$previousTenant = $env:TENANT_DATABASE_URL
$labHost = if ($env:MULTIBASE_PG_HOST) { $env:MULTIBASE_PG_HOST } else { '127.0.0.1' }
$labPort = if ($env:MULTIBASE_PG_PORT) { $env:MULTIBASE_PG_PORT } else { '55433' }
try {
  $env:ACCOUNTS_DATABASE_URL = "postgresql://accounts_lab:accounts_lab_only@${labHost}:${labPort}/accounts_lab"
  npx prisma migrate deploy --schema backend/prisma/accounts/schema.prisma
  if ($LASTEXITCODE -ne 0) { throw 'Migration Accounts falhou.' }
  $labTenants = @(
    @{ Name = 'tenant_a_lab'; Password = 'tenant_a_lab_only' },
    @{ Name = 'tenant_b_lab'; Password = 'tenant_b_lab_only' }
  )
  foreach ($labTenant in $labTenants) {
    $env:TENANT_DATABASE_URL = "postgresql://$($labTenant.Name):$($labTenant.Password)@${labHost}:${labPort}/$($labTenant.Name)"
    npx prisma migrate deploy --schema backend/prisma/tenant/schema.prisma
    if ($LASTEXITCODE -ne 0) { throw 'Migration tenant falhou.' }
  }
} finally {
  $env:ACCOUNTS_DATABASE_URL = $previousAccounts
  $env:TENANT_DATABASE_URL = $previousTenant
}
