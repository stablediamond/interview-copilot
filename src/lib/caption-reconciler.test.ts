import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CaptionReconciler,
  collapseRepeatedText,
  stripLeadingOverlap,
  normWord,
} from "./caption-reconciler";

test("stripLeadingOverlap drops the committed suffix that reappears at the start", () => {
  const tail = ["how", "do", "you", "balance", "shipping", "fast"].map(normWord);
  const next = ["you", "balance", "shipping", "fast", "and", "keep", "quality"];
  assert.deepEqual(stripLeadingOverlap(tail, next), ["and", "keep", "quality"]);
});

test("stripLeadingOverlap returns the whole input when nothing overlaps", () => {
  const tail = ["i", "led", "the", "team"].map(normWord);
  const next = ["then", "i", "moved", "on"];
  assert.deepEqual(stripLeadingOverlap(tail, next), ["then", "i", "moved", "on"]);
});

test("stripLeadingOverlap ignores case and punctuation differences", () => {
  const tail = ["I", "built", "Canvas"].map(normWord);
  const next = ["Canvas,", "an", "internal", "platform"];
  assert.deepEqual(stripLeadingOverlap(tail, next), ["an", "internal", "platform"]);
});

test("collapseRepeatedText collapses an immediately repeated multi-word phrase", () => {
  assert.equal(
    collapseRepeatedText("what is your experience what is your experience with systems"),
    "what is your experience with systems"
  );
});

test("collapseRepeatedText leaves non-repeated text untouched", () => {
  const text = "tell me about a time you led a project";
  assert.equal(collapseRepeatedText(text), text);
});

test("collapseRepeatedText preserves grammatical single-word doublings", () => {
  // Only phrases of length >= 2 are collapsed, so this is left alone.
  assert.equal(collapseRepeatedText("I had had enough"), "I had had enough");
});

test("reconciler commits each sentence exactly once across a rolling window", () => {
  const reconciler = new CaptionReconciler();
  const snapshots = [
    "Tell me about yourself.",
    "Tell me about yourself. What are your strengths?",
    "about yourself. What are your strengths? Why here?",
    "What are your strengths? Why here? Anything else?",
  ];
  const finals: string[] = [];
  for (const snap of snapshots) finals.push(...reconciler.push(snap).finals);

  assert.deepEqual(finals, [
    "Tell me about yourself.",
    "What are your strengths?",
    "Why here?",
  ]);
});

test("reconciler does not double-commit a phrase repeated within one snapshot", () => {
  const reconciler = new CaptionReconciler();
  const { finals } = reconciler.push("I built Canvas. I built Canvas. Then I left.");
  assert.deepEqual(finals, ["I built Canvas."]);
});
