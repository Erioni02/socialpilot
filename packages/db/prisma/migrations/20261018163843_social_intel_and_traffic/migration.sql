-- CreateTable
CREATE TABLE "IntelEntity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "avatarUrl" TEXT,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelSnapshot" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "profile" JSONB,
    "posts" JSONB,
    "unavailable" JSONB NOT NULL DEFAULT '[]',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT,
    "kind" TEXT,
    "ok" BOOLEAN NOT NULL,
    "status" TEXT,
    "error" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebTrafficReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "maxBudget" DOUBLE PRECISION NOT NULL,
    "data" JSONB,
    "error" TEXT,
    "costUsd" DOUBLE PRECISION,
    "apifyRunId" TEXT,
    "datasetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WebTrafficReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntelEntity_userId_watched_idx" ON "IntelEntity"("userId", "watched");

-- CreateIndex
CREATE UNIQUE INDEX "IntelEntity_userId_platform_kind_externalId_key" ON "IntelEntity"("userId", "platform", "kind", "externalId");

-- CreateIndex
CREATE INDEX "IntelSnapshot_entityId_capturedAt_idx" ON "IntelSnapshot"("entityId", "capturedAt");

-- CreateIndex
CREATE INDEX "IntelSearch_userId_createdAt_idx" ON "IntelSearch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WebTrafficReport_projectId_createdAt_idx" ON "WebTrafficReport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "WebTrafficReport_userId_createdAt_idx" ON "WebTrafficReport"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "IntelSnapshot" ADD CONSTRAINT "IntelSnapshot_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "IntelEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
