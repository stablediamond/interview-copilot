import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewBriefPrompt } from "./interview-prompt";

test("buildInterviewBriefPrompt appends resume and JD when template has no placeholders", () => {
  const prompt = buildInterviewBriefPrompt(
    "You are an interviewer.",
    "Jane Doe\nSkills: TypeScript",
    "Build APIs in Node.js",
    "Backend Engineer",
    "Acme",
  );
  assert.match(prompt, /You are an interviewer/);
  assert.match(prompt, /Jane Doe/);
  assert.match(prompt, /JOB_TITLE: Backend Engineer/);
  assert.match(prompt, /COMPANY: Acme/);
  assert.match(prompt, /Build APIs in Node\.js/);
});

test("buildInterviewBriefPrompt fills PROFILE and HTML_PAGE_SOURCE placeholders", () => {
  const prompt = buildInterviewBriefPrompt(
    "Intro\n{{PROFILE}}\n---\n{{HTML_PAGE_SOURCE}}",
    "Resume text",
    "Job text",
  );
  assert.equal(prompt, "Intro\nResume text\n---\nJob text");
});

test("buildInterviewBriefPrompt rejects empty resume", () => {
  assert.throws(
    () => buildInterviewBriefPrompt("prompts", "  ", "JD"),
    /Resume is empty/,
  );
});
