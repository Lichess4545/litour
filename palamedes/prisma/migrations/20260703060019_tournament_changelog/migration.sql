-- CreateTable
CREATE TABLE "definition_change" (
    "seq" SERIAL NOT NULL,
    "streamId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "definition_change_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "definition_change_streamId_version_key" ON "definition_change"("streamId", "version");
