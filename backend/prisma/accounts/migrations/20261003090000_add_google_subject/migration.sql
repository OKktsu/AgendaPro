ALTER TABLE "Account" ADD COLUMN "googleSubject" TEXT;

CREATE UNIQUE INDEX "Account_googleSubject_key" ON "Account"("googleSubject");
