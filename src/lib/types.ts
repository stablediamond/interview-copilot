import type {
  BriefProject,
  BriefQa,
  CandidateStructured,
  JobStructured,
  PositioningBrief,
  WeakSpot,
} from "./schemas";

export interface CandidateProfileDto {
  id: string;
  name: string;
  targetTitle: string;
  rawResumeText: string;
  structuredProfileJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobProfileDto {
  id: string;
  company: string;
  roleTitle: string;
  rawJobDescription: string;
  structuredJobJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfilesResponse {
  candidates: CandidateProfileDto[];
  jobs: JobProfileDto[];
}

export interface ConfigStatus {
  openaiConfigured: boolean;
  openaiKeySource: "settings" | "env" | "none";
  deepgramConfigured: boolean;
  strongModel: string;
  fastModel: string;
  transcriptionModel: string;
  transcriptionAvailable: boolean;
}

export interface StoryDto {
  id: string;
  title: string;
  category: string;
  shortVersion: string;
  starVersion: string;
  technicalVersion: string;
  keywords: string[];
  evidence: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionListItem {
  id: string;
  title: string;
  candidateName: string | null;
  jobCompany: string | null;
  jobRole: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDto {
  id: string;
  rawTranscript: string;
  detectedQuestion: string;
  questionType: string;
  generatedAnswer: string;
  answerMode: string;
  interviewStage: string;
  keywords: string[];
  confidence: string;
  riskNote: string;
  possibleFollowUp: string;
  createdAt: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  transcript: string;
  candidateProfile: { id: string; name: string; targetTitle: string } | null;
  jobProfile: { id: string; company: string; roleTitle: string } | null;
  createdAt: string;
  updatedAt: string;
  turns: TurnDto[];
}

export type {
  BriefProject,
  BriefQa,
  CandidateStructured,
  JobStructured,
  PositioningBrief,
  WeakSpot,
};
