-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "openaiApiKey" TEXT,
    "strongModel" TEXT,
    "fastModel" TEXT,
    "transcriptionModel" TEXT,
    "updatedAt" DATETIME NOT NULL
);
