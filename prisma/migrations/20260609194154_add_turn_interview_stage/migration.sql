-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InterviewTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "rawTranscript" TEXT NOT NULL,
    "detectedQuestion" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "generatedAnswer" TEXT NOT NULL,
    "answerMode" TEXT NOT NULL,
    "interviewStage" TEXT NOT NULL DEFAULT 'general',
    "keywordsJson" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "riskNote" TEXT NOT NULL,
    "possibleFollowUp" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterviewTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InterviewTurn" ("answerMode", "confidence", "createdAt", "detectedQuestion", "generatedAnswer", "id", "keywordsJson", "possibleFollowUp", "questionType", "rawTranscript", "riskNote", "sessionId") SELECT "answerMode", "confidence", "createdAt", "detectedQuestion", "generatedAnswer", "id", "keywordsJson", "possibleFollowUp", "questionType", "rawTranscript", "riskNote", "sessionId" FROM "InterviewTurn";
DROP TABLE "InterviewTurn";
ALTER TABLE "new_InterviewTurn" RENAME TO "InterviewTurn";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
