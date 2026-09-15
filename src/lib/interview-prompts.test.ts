import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INTERVIEW_PROMPTS,
  looksLikeResumeWriterPrompt,
  resolveInterviewPrompts,
} from "./interview-prompts";

test("looksLikeResumeWriterPrompt detects Job Track candidate resume prompts", () => {
  assert.equal(
    looksLikeResumeWriterPrompt(
      "You are a senior technical resume strategist, ATS optimization specialist",
    ),
    true,
  );
  assert.equal(
    looksLikeResumeWriterPrompt(DEFAULT_INTERVIEW_PROMPTS),
    false,
  );
});

test("resolveInterviewPrompts uses Settings when saved text is empty or a resume writer prompt", () => {
  assert.equal(
    resolveInterviewPrompts("", "From settings"),
    "From settings",
  );
  assert.equal(
    resolveInterviewPrompts(
      "You are a senior technical resume strategist, ATS optimization specialist",
      "From settings",
    ),
    "From settings",
  );
  assert.equal(
    resolveInterviewPrompts("Ask about distributed systems.", "From settings"),
    "Ask about distributed systems.",
  );
});
