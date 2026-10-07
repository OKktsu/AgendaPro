BEGIN;

CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE "Membership" (
    "accountId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "role" "AccountRole" NOT NULL DEFAULT 'STAFF',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("accountId", "tenantId"),
    CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantDirectory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

INSERT INTO "Membership" ("accountId", "tenantId", "role", "createdAt", "updatedAt")
SELECT "id", "tenantId", "role", "createdAt", "updatedAt" FROM "Account";

ALTER TABLE "Account" DROP CONSTRAINT "Account_tenantId_fkey";
DROP INDEX "Account_tenantId_idx";
ALTER TABLE "Account" DROP COLUMN "tenantId", DROP COLUMN "role";

COMMIT;
