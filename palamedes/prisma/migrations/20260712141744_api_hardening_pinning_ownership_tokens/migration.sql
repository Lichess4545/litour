-- AlterTable
ALTER TABLE "definition_change" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "registryId" TEXT NOT NULL DEFAULT 'chess/1',
ADD COLUMN     "schemaRev" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "definition_stream" (
    "streamId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "definition_stream_pkey" PRIMARY KEY ("streamId")
);

-- CreateTable
CREATE TABLE "lichess_token" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lichess_token_pkey" PRIMARY KEY ("tokenHash")
);
