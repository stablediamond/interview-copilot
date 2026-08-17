-- CreateTable
CREATE TABLE "PositioningBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateProfileId" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "briefJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PositioningBrief_candidateProfileId_jobProfileId_key" ON "PositioningBrief"("candidateProfileId", "jobProfileId");
