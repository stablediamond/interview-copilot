import assert from "node:assert/strict";
import test from "node:test";
import {
  displayResumeText,
  formatResumeJsonAsPlainText,
} from "./resume-plain-text";

test("formatResumeJsonAsPlainText flattens FlowCV resume JSON to plain text", () => {
  const text = formatResumeJsonAsPlainText({
    summaryTitle: "Senior Backend Engineer",
    personalDetails: { fullName: "Jane Doe", email: "jane@example.com" },
    profile: { entries: [{ text: "Builds APIs in TypeScript." }] },
    skill: {
      entries: [{ skill: "Languages", infoHtml: "<p>TypeScript, Go</p>" }],
    },
    work: {
      entries: [
        {
          title: "Staff Engineer",
          company: "Acme",
          startDateNew: "03/2021",
          endDateNew: "Present",
          description: "<p>- Cut p99 latency 40%</p>",
        },
      ],
    },
    education: {
      entries: [
        {
          degree: "B.S. CS",
          institution: "State University",
          startDateNew: "09/2011",
          endDateNew: "05/2015",
        },
      ],
    },
  });

  assert.match(text, /Jane Doe/);
  assert.match(text, /Senior Backend Engineer/);
  assert.match(text, /Builds APIs in TypeScript/);
  assert.match(text, /TypeScript, Go/);
  assert.match(text, /Staff Engineer at Acme/);
  assert.match(text, /03\/2021 – Present/);
  assert.match(text, /Cut p99 latency 40%/);
  assert.match(text, /B\.S\. CS — State University — 09\/2011 – 05\/2015/);
  assert.doesNotMatch(text, /"entries"/);
  assert.doesNotMatch(text, /<p>/);
});

test("formatResumeJsonAsPlainText unwraps nested FlowCV content and JSON strings", () => {
  const payload = JSON.stringify({
    data: {
      resumes: [
        {
          personalDetails: { fullName: "Alex Kim" },
          content: {
            work: {
              entries: [{ title: "iOS Engineer", company: "Northwind" }],
            },
          },
        },
      ],
    },
    summaryTitle: "iOS Engineer",
  });
  const text = formatResumeJsonAsPlainText(payload);
  assert.match(text, /Alex Kim/);
  assert.match(text, /iOS Engineer at Northwind/);
  assert.doesNotMatch(text, /\{/);
});

test("formatResumeJsonAsPlainText reads FlowCV jobTitle, employer, and date objects", () => {
  const text = formatResumeJsonAsPlainText({
    work: {
      entries: [
        {
          jobTitle: "iOS Engineer",
          employer: "Northwind",
          startDate: { year: 2019, month: 7 },
          endDate: { year: 2021, month: 2 },
        },
      ],
    },
  });
  assert.match(text, /iOS Engineer at Northwind/);
  assert.match(text, /07\/2019 – 02\/2021/);
});

test("displayResumeText flattens leftover JSON strings", () => {
  const text = displayResumeText(
    JSON.stringify({
      profile: { entries: [{ text: "Builds ML pipelines." }] },
    }),
  );
  assert.match(text, /Builds ML pipelines/);
  assert.doesNotMatch(text, /"entries"/);
});
