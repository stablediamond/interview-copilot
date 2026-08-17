-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    "rawResumeText" TEXT NOT NULL,
    "structuredProfileJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "rawJobDescription" TEXT NOT NULL,
    "structuredJobJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "shortVersion" TEXT NOT NULL,
    "starVersion" TEXT NOT NULL,
    "technicalVersion" TEXT NOT NULL,
    "keywordsJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InterviewSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "candidateProfileId" TEXT,
    "jobProfileId" TEXT,
    "transcript" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewSession_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InterviewSession_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterviewTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "rawTranscript" TEXT NOT NULL,
    "detectedQuestion" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "generatedAnswer" TEXT NOT NULL,
    "answerMode" TEXT NOT NULL,
    "keywordsJson" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "riskNote" TEXT NOT NULL,
    "possibleFollowUp" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterviewTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
