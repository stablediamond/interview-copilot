import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCodingStream,
  hasCodingContent,
  fullCode,
  codingTurnTitle,
} from "./coding";

const FULL = [
  "@@MODE@@ new",
  "@@SAY@@",
  "Let me use a hash map so lookups are O(1) and I only pass once.",
  "@@STEP@@ python",
  "def two_sum(nums, target):",
  "    seen = {}",
  "@@NARRATE@@",
  "I'll map each value to its index as I go, so I can check the complement in O(1).",
  "@@STEP@@",
  "    for i, n in enumerate(nums):",
  "        if target - n in seen:",
  "            return [seen[target - n], i]",
  "        seen[n] = i",
  "@@NARRATE@@",
  "For each number I check whether its complement is already stored before inserting it.",
  "@@COMPLEXITY@@",
  "Time O(n) · Space O(n)",
  "@@POINTS@@",
  "- Handles negatives since it's a map, not sorted",
  "@@NOTE@@",
  "If they want all pairs, mention we'd store a list per key.",
].join("\n");

test("parses steps as code+narration pairs", () => {
  const s = parseCodingStream(FULL);
  assert.equal(s.mode, "new");
  assert.equal(s.language, "python");
  assert.equal(s.steps.length, 2);
  assert.match(s.steps[0].code, /def two_sum/);
  assert.match(s.steps[0].narrate, /map each value to its index/);
  assert.match(s.steps[1].code, /seen\[n\] = i$/);
  assert.match(s.steps[1].narrate, /complement is already stored/);
  assert.equal(s.complexity, "Time O(n) · Space O(n)");
  assert.match(s.points, /Handles negatives/);
  assert.match(s.note, /all pairs/);
  assert.equal(s.error, null);
});

test("fullCode concatenates every step in order", () => {
  const s = parseCodingStream(FULL);
  const code = fullCode(s);
  assert.match(code, /^def two_sum/);
  assert.match(code, /seen\[n\] = i$/);
  // Setup line precedes the loop line.
  assert.ok(code.indexOf("seen = {}") < code.indexOf("for i, n"));
});

test("preserves code indentation within a step", () => {
  const s = parseCodingStream(FULL);
  assert.ok(s.steps[1].code.includes("        if target - n in seen:"));
});

test("verbal mode (answer) has no steps, uses points", () => {
  const s = parseCodingStream(
    [
      "@@MODE@@ answer",
      "@@SAY@@",
      "A message queue decouples producers from consumers.",
      "@@POINTS@@",
      "- Buffering absorbs traffic spikes",
      "- Backpressure protects the consumer",
    ].join("\n")
  );
  assert.equal(s.mode, "answer");
  assert.equal(s.steps.length, 0);
  assert.match(s.points, /Backpressure/);
});

test("tolerates the legacy CODE/PLAN markers as a single step + points", () => {
  const s = parseCodingStream(
    ["@@MODE@@ fix", "@@CODE@@ python", "x = 1", "@@PLAN@@", "- change < to <="].join("\n")
  );
  assert.equal(s.steps.length, 1);
  assert.equal(s.steps[0].code, "x = 1");
  assert.match(s.points, /change < to/);
});

test("renders early tokens before the first marker under SAY", () => {
  const s = parseCodingStream("Let me think about this");
  assert.equal(s.say, "Let me think about this");
  assert.ok(hasCodingContent(s));
});

test("hides a partially-streamed trailing marker", () => {
  const partial = ["@@MODE@@ fix", "@@SAY@@", "Off-by-one on the loop bound.", "@@NAR"].join(
    "\n"
  );
  const s = parseCodingStream(partial);
  assert.equal(s.mode, "fix");
  assert.equal(s.say, "Off-by-one on the loop bound.");
  assert.ok(!s.say.includes("@@NAR"));
});

test("invalid mode value resolves to null", () => {
  const s = parseCodingStream("@@MODE@@ banana\n@@SAY@@\nhi");
  assert.equal(s.mode, null);
  assert.equal(s.say, "hi");
});

test("surfaces a mid-stream transport error", () => {
  const s = parseCodingStream(
    "@@MODE@@ new\n@@SAY@@\nStarting…\n\n---ERROR---\nThe model failed while streaming."
  );
  assert.equal(s.say, "Starting…");
  assert.equal(s.error, "The model failed while streaming.");
});

test("codingTurnTitle prefers the first SAY line", () => {
  const s = parseCodingStream(FULL);
  assert.match(codingTurnTitle(s), /hash map/);
});

test("empty input yields an empty, content-free solution", () => {
  const s = parseCodingStream("");
  assert.equal(hasCodingContent(s), false);
  assert.equal(s.steps.length, 0);
});
