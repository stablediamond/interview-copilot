import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lintAnswerStyle,
  bannedPhrasesIn,
  styleRiskNote,
} from "./answer-style";

test("flags banned corporate filler case-insensitively", () => {
  const phrases = bannedPhrasesIn(
    "I'm passionate about clean code and love to Leverage robust tooling."
  );
  assert.ok(phrases.includes("passionate about"));
  assert.ok(phrases.includes("leverage"));
  assert.ok(phrases.includes("robust"));
});

test("does not false-positive on inflections of a banned word", () => {
  // "leverages"/"delved" should not match the bare "leverage"/"delve" entries.
  assert.deepEqual(bannedPhrasesIn("The service leverages a queue."), []);
  assert.deepEqual(bannedPhrasesIn("We delved deeper afterwards."), []);
});

test("ignores the trailing ---META--- block", () => {
  const answer = [
    "I built a payments service.",
    "- Moved retries onto a queue.",
    "",
    '---META---',
    '{"detected_question": "leverage synergy", "keywords": []}',
  ].join("\n");
  // The banned words only appear inside META, so nothing should be flagged.
  assert.deepEqual(bannedPhrasesIn(answer), []);
});

test("strips markdown bullet markers before checking sentences", () => {
  const findings = lintAnswerStyle("- I owned the payments service.");
  assert.deepEqual(findings, []);
});

test("flags a run-on sentence over the word cap", () => {
  const runOn =
    "I worked on the platform and I did a lot of things which helped the team and then we shipped it and it was great and everyone was happy and the metrics went up over time.";
  const findings = lintAnswerStyle(runOn);
  assert.ok(findings.some((f) => f.type === "run_on"));
});

test("clean short answer produces no findings and empty risk note", () => {
  const clean = "I owned the payments service. Moved retries onto a queue. Failed charges stopped paging us.";
  assert.deepEqual(lintAnswerStyle(clean), []);
  assert.equal(styleRiskNote(clean), "");
});

test("styleRiskNote lists banned phrases when present", () => {
  const note = styleRiskNote("I'm excited to leverage synergy here.");
  assert.match(note, /Filler to avoid/);
  assert.match(note, /leverage/);
});

test("flags the newer AI/corporate tells", () => {
  const phrases = bannedPhrasesIn(
    "I spearheaded the migration and was instrumental in the rollout; this role aligns perfectly."
  );
  assert.ok(phrases.includes("spearheaded"));
  assert.ok(phrases.includes("instrumental in"));
  assert.ok(phrases.includes("aligns perfectly"));
});
