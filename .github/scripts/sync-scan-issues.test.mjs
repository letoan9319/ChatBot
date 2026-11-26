import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SCANNER_CONFIGS,
  buildIssueBody,
  extractFingerprintFromBody,
  extractScannerIdFromBody,
  loadScanResultsFromDir,
  parseBanditReport,
  parseGitleaksReport,
  parseNpmAuditReport,
  parsePipAuditReport,
  parseRuffReport,
  parseZizmorReport,
  redactSensitiveText,
  syncAllScanners,
} from "./sync-scan-issues.mjs";

function createFakeGitHubApi(initialIssues = [], initialLabels = []) {
  let nextIssueNumber =
    initialIssues.reduce((max, item) => Math.max(max, item.number), 0) + 1;
  const labels = [...initialLabels];
  const issues = initialIssues.map((item) => ({ ...item }));
  const calls = {
    createdLabels: [],
    createdIssues: [],
    updatedIssues: [],
    comments: [],
    closedIssues: [],
  };

  const api = {
    async listLabels() {
      return [...labels];
    },
    async createLabel(label) {
      labels.push(label);
      calls.createdLabels.push(label);
      return label;
    },
    async listOpenIssues(labelName) {
      return issues.filter(
        (issue) =>
          issue.state === "open" &&
          (!labelName || (Array.isArray(issue.labels) && issue.labels.includes(labelName))),
      );
    },
    async createIssue({ title, body, labels: issueLabels }) {
      const created = {
        number: nextIssueNumber,
        state: "open",
        title,
        body,
        labels: [...issueLabels],
      };
      nextIssueNumber += 1;
      issues.push(created);
      calls.createdIssues.push(created);
      return created;
    },
    async updateIssue(issueNumber, { title, body, labels: issueLabels }) {
      const target = issues.find((issue) => issue.number === issueNumber);
      assert.ok(target, `Expected issue #${issueNumber} to exist`);
      target.title = title;
      target.body = body;
      target.labels = [...issueLabels];
      calls.updatedIssues.push({ number: issueNumber, title, body, labels: [...issueLabels] });
      return target;
    },
    async createComment(issueNumber, body) {
      calls.comments.push({ number: issueNumber, body });
      return { id: calls.comments.length, body };
    },
    async closeIssue(issueNumber) {
      const target = issues.find((issue) => issue.number === issueNumber);
      assert.ok(target, `Expected issue #${issueNumber} to exist`);
      target.state = "closed";
      calls.closedIssues.push(issueNumber);
      return target;
    },
  };

  return { api, issues, labels, calls };
}

const SAMPLE_CONTEXT = {
  repository: "owner/learnstep",
  sha: "abcdef1234567890abcdef1234567890abcdef12",
  refName: "main",
  runId: "987654321",
  serverUrl: "https://github.com",
};

function makeAllCleanResults() {
  return {
    gitleaks: { scannerId: "gitleaks", status: "clean", totalCount: 0, items: [] },
    "npm-audit": { scannerId: "npm-audit", status: "clean", totalCount: 0, items: [] },
    "pip-audit": { scannerId: "pip-audit", status: "clean", totalCount: 0, items: [] },
    bandit: { scannerId: "bandit", status: "clean", totalCount: 0, items: [] },
    zizmor: { scannerId: "zizmor", status: "clean", totalCount: 0, items: [] },
    ruff: { scannerId: "ruff", status: "clean", totalCount: 0, items: [] },
  };
}

test("creates missing labels and opens a new issue when a scanner reports findings", async () => {
  const { api, calls } = createFakeGitHubApi();
  const results = makeAllCleanResults();
  results["npm-audit"] = parseNpmAuditReport(
    JSON.stringify({
      vulnerabilities: {
        next: {
          name: "next",
          severity: "high",
          range: "<16.5.0",
          via: [{ source: 12345, title: "Request smuggling in middleware" }],
          fixAvailable: { name: "next", version: "16.5.0" },
        },
        lowpkg: {
          name: "lowpkg",
          severity: "low",
          range: "<1.0.0",
          via: [{ title: "Minor issue" }],
          fixAvailable: true,
        },
      },
    }),
    1,
  );

  assert.equal(results["npm-audit"].totalCount, 1);

  const outcomes = await syncAllScanners(api, results, SAMPLE_CONTEXT);
  const npmOutcome = outcomes.find((item) => item.scannerId === "npm-audit");

  assert.equal(calls.createdLabels.length, 4);
  assert.equal(calls.createdIssues.length, 1);
  assert.equal(npmOutcome.action, "created");
  assert.equal(npmOutcome.issueNumber, 1);
  assert.equal(extractScannerIdFromBody(calls.createdIssues[0].body), "npm-audit");
  assert.ok(extractFingerprintFromBody(calls.createdIssues[0].body));
  assert.match(calls.createdIssues[0].body, /https:\/\/github\.com\/owner\/learnstep\/actions\/runs\/987654321/);
});

test("deduplicates when open issue already has the same fingerprint", async () => {
  const npmResult = parseNpmAuditReport(
    JSON.stringify({
      vulnerabilities: {
        zod: {
          name: "zod",
          severity: "critical",
          range: "<4.7.0",
          via: [{ source: 999, title: "DoS vulnerability" }],
          fixAvailable: true,
        },
      },
    }),
    1,
  );

  const { body } = buildIssueBody(SCANNER_CONFIGS["npm-audit"], npmResult, SAMPLE_CONTEXT);
  const { api, calls } = createFakeGitHubApi(
    [
      {
        number: 42,
        state: "open",
        title: SCANNER_CONFIGS["npm-audit"].title,
        body,
        labels: SCANNER_CONFIGS["npm-audit"].labels,
      },
    ],
    [
      { name: "automated-scan" },
      { name: "security" },
      { name: "dependencies" },
      { name: "code-quality" },
    ],
  );

  const results = makeAllCleanResults();
  results["npm-audit"] = npmResult;

  const outcomes = await syncAllScanners(api, results, {
    ...SAMPLE_CONTEXT,
    sha: "1111111111111111111111111111111111111111",
    runId: "999999999",
  });

  const npmOutcome = outcomes.find((item) => item.scannerId === "npm-audit");
  assert.equal(npmOutcome.action, "unchanged");
  assert.equal(npmOutcome.issueNumber, 42);
  assert.equal(calls.createdIssues.length, 0);
  assert.equal(calls.updatedIssues.length, 0);
  assert.equal(calls.closedIssues.length, 0);
});

test("updates existing open issue when findings fingerprint changes", async () => {
  const firstResult = parseRuffReport(
    JSON.stringify([
      {
        code: "F401",
        message: "os imported but unused",
        filename: "/home/runner/work/repo/services/worker/src/study_worker/main.py",
        location: { row: 10, column: 8 },
      },
    ]),
    1,
  );
  const { body: initialBody, fingerprint: firstFp } = buildIssueBody(
    SCANNER_CONFIGS.ruff,
    firstResult,
    SAMPLE_CONTEXT,
  );

  const { api, calls } = createFakeGitHubApi([
    {
      number: 7,
      state: "open",
      title: SCANNER_CONFIGS.ruff.title,
      body: initialBody,
      labels: SCANNER_CONFIGS.ruff.labels,
    },
  ]);

  const secondResult = parseRuffReport(
    JSON.stringify([
      {
        code: "F401",
        message: "os imported but unused",
        filename: "/home/runner/work/repo/services/worker/src/study_worker/main.py",
        location: { row: 10, column: 8 },
      },
      {
        code: "F841",
        message: "Local variable x is assigned to but never used",
        filename: "/home/runner/work/repo/services/worker/src/study_worker/rag.py",
        location: { row: 45, column: 5 },
      },
    ]),
    1,
  );

  const results = makeAllCleanResults();
  results.ruff = secondResult;

  const outcomes = await syncAllScanners(api, results, SAMPLE_CONTEXT);
  const ruffOutcome = outcomes.find((item) => item.scannerId === "ruff");

  assert.equal(ruffOutcome.action, "updated");
  assert.equal(ruffOutcome.issueNumber, 7);
  assert.notEqual(ruffOutcome.fingerprint, firstFp);
  assert.equal(calls.createdIssues.length, 0);
  assert.equal(calls.updatedIssues.length, 1);
  assert.match(calls.updatedIssues[0].body, /services\/worker\/src\/study_worker\/rag\.py:45:5/);
});

test("comments and auto-closes existing open issue when scanner passes cleanly", async () => {
  const banditResult = parseBanditReport(
    JSON.stringify({
      results: [
        {
          test_id: "B301",
          issue_severity: "MEDIUM",
          issue_confidence: "HIGH",
          filename: "services/worker/src/study_worker/main.py",
          line_number: 88,
          issue_text: "Pickle usage detected",
        },
      ],
    }),
    1,
  );
  const { body: initialBody } = buildIssueBody(SCANNER_CONFIGS.bandit, banditResult, SAMPLE_CONTEXT);

  const { api, issues, calls } = createFakeGitHubApi([
    {
      number: 15,
      state: "open",
      title: SCANNER_CONFIGS.bandit.title,
      body: initialBody,
      labels: SCANNER_CONFIGS.bandit.labels,
    },
  ]);

  const results = makeAllCleanResults();
  const outcomes = await syncAllScanners(api, results, SAMPLE_CONTEXT);
  const banditOutcome = outcomes.find((item) => item.scannerId === "bandit");

  assert.equal(banditOutcome.action, "closed");
  assert.equal(banditOutcome.issueNumber, 15);
  assert.equal(calls.comments.length, 1);
  assert.equal(calls.closedIssues.length, 1);
  assert.equal(issues[0].state, "closed");
  assert.match(calls.comments[0].body, /Bandit/);
  assert.match(calls.comments[0].body, /abcdef123456/);
});

test("never exposes raw secret values from gitleaks findings and caps oversized output", () => {
  const rawSecret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
  const gitleaksPayload = Array.from({ length: 35 }, (_, idx) => ({
    RuleID: "github-pat",
    File: `apps/web/src/config-${idx}.ts`,
    StartLine: idx + 1,
    Commit: "deadbeef1234567890deadbeef1234567890dead",
    Secret: rawSecret,
    Match: `TOKEN=${rawSecret}`,
  }));

  const parsed = parseGitleaksReport(JSON.stringify(gitleaksPayload), 1);
  assert.equal(parsed.status, "findings");
  assert.equal(parsed.totalCount, 35);

  const { body } = buildIssueBody(SCANNER_CONFIGS.gitleaks, parsed, SAMPLE_CONTEXT, {
    maxItems: 10,
    maxBodyLength: 5000,
  });

  assert.equal(body.includes(rawSecret), false);
  assert.match(body, /và 25 phát hiện khác/);
  assert.ok(body.length <= 5000);

  const redacted = redactSensitiveText(
    `Error auth Bearer supersecrettoken12345 and api_key=my_real_key_value_999 and ${rawSecret}`,
  );
  assert.equal(redacted.includes("supersecrettoken12345"), false);
  assert.equal(redacted.includes("my_real_key_value_999"), false);
  assert.equal(redacted.includes(rawSecret), false);
});

test("parses pip-audit, zizmor, and directory report loading accurately", () => {
  const pipParsed = parsePipAuditReport(
    JSON.stringify({
      dependencies: [
        {
          name: "httpx",
          version: "0.28.0",
          vulns: [{ id: "GHSA-xxxx-yyyy-zzzz", fix_versions: ["0.28.1"] }],
        },
        {
          name: "ruff",
          version: "0.11.0",
          vulns: [],
        },
      ],
    }),
    1,
  );
  assert.equal(pipParsed.status, "findings");
  assert.equal(pipParsed.totalCount, 1);
  assert.match(pipParsed.items[0].summary, /httpx==0\.28\.0/);

  const zizmorParsed = parseZizmorReport(
    JSON.stringify([
      {
        ident: "template-injection",
        desc: "code injection via template expansion",
        determinations: { severity: "High", confidence: "High" },
        locations: [
          {
            symbolic: {
              kind: "Primary",
              key: { Local: { given_path: ".github/workflows/ci.yml" } },
            },
            concrete: { location: { start_point: { row: 19, column: 2 } } },
          },
        ],
      },
    ]),
    1,
  );
  assert.equal(zizmorParsed.status, "findings");
  assert.match(zizmorParsed.items[0].summary, /\.github\/workflows\/ci\.yml:20/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "learnstep-scan-test-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "zizmor.exit"), "0\n", "utf8");
    fs.writeFileSync(path.join(tmpDir, "zizmor.json"), "[]\n", "utf8");
    fs.writeFileSync(path.join(tmpDir, "bandit.exit"), "0\n", "utf8");
    fs.writeFileSync(path.join(tmpDir, "bandit.json"), JSON.stringify({ results: [] }), "utf8");

    const loaded = loadScanResultsFromDir(tmpDir);
    assert.equal(loaded.zizmor.status, "clean");
    assert.equal(loaded.bandit.status, "clean");
    assert.equal(loaded.ruff.status, "missing");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
