-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_organizationId_fkey";

-- AlterTable
ALTER TABLE "Organization"
ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

-- AlterTable
ALTER TABLE "User"
ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
