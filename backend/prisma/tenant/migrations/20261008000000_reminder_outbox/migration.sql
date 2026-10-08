CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSED', 'CANCELLED', 'SKIPPED');
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_id_organizationId_key" UNIQUE ("id", "organizationId");
CREATE TABLE "ReminderOutbox" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReminderOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReminderOutbox_appointmentId_key" UNIQUE ("appointmentId"),
  CONSTRAINT "ReminderOutbox_appointmentId_organizationId_fkey"
    FOREIGN KEY ("appointmentId", "organizationId") REFERENCES "Appointment"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReminderOutbox_organizationId_status_updatedAt_idx" ON "ReminderOutbox"("organizationId", "status", "updatedAt");

