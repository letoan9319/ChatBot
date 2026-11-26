import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BOT_MARKER_PREFIX = "learnstep-scan-bot:";
export const FINGERPRINT_MARKER_PREFIX = "learnstep-scan-fingerprint:";
export const MAX_ITEMS_PER_ISSUE = 25;
export const MAX_BODY_LENGTH = 30000;

export const REQUIRED_LABELS = [
  {
    name: "automated-scan",
    color: "0e8a16",
    description: "Issues managed by automated security and quality scans",
  },
  {
    name: "security",
    color: "b60205",
    description: "Security vulnerabilities, leaked secrets, or workflow hardening findings",
  },
  {
    name: "dependencies",
    color: "0366d6",
    description: "Dependency advisories and package updates",
  },
  {
    name: "code-quality",
    color: "fbca04",
    description: "Static analysis and linting findings",
  },
];

export const SCANNER_CONFIGS = {
  gitleaks: {
    id: "gitleaks",
    displayName: "Gitleaks",
    title: "[Security Scan] Phát hiện nguy cơ lộ secret (Gitleaks)",
    labels: ["automated-scan", "security"],
    remediation:
      "Kiểm tra commit và tệp bị gắn cờ, thu hồi và xoay vòng ngay mọi key/token bị lộ, sau đó làm sạch lịch sử Git nếu cần.",
  },
  "npm-audit": {
    id: "npm-audit",
    displayName: "npm audit",
    title: "[Security Scan] Lỗ hổng dependency npm mức high trở lên (npm audit)",
    labels: ["automated-scan", "security", "dependencies"],
    remediation:
      "Kiểm tra advisory và cập nhật package lên phiên bản đã vá, sau đó chạy lại npm test, npm run typecheck và npm run build.",
  },
  "pip-audit": {
    id: "pip-audit",
    displayName: "pip-audit",
    title: "[Security Scan] Lỗ hổng dependency Python worker (pip-audit)",
    labels: ["automated-scan", "security", "dependencies"],
    remediation:
      "Cập nhật dependency trong services/worker/pyproject.toml và khóa lại services/worker/uv.lock, sau đó chạy uv run pytest.",
  },
  bandit: {
    id: "bandit",
    displayName: "Bandit",
    title: "[Security Scan] Cảnh báo bảo mật mã nguồn Python (Bandit)",
    labels: ["automated-scan", "security"],
    remediation:
      "Xem lại mã nguồn Python tại các vị trí báo lỗi và sửa theo khuyến nghị bảo mật thay vì bỏ qua cảnh báo.",
  },
  zizmor: {
    id: "zizmor",
    displayName: "zizmor",
    title: "[Security Scan] Cảnh báo bảo mật GitHub Actions (zizmor)",
    labels: ["automated-scan", "security"],
    remediation:
      "Kiểm tra cấu hình workflow trong .github/workflows và khắc phục các phát hiện mức medium trở lên.",
  },
  ruff: {
    id: "ruff",
    displayName: "Ruff",
    title: "[Quality Scan] Lỗi lint Python worker (Ruff)",
    labels: ["automated-scan", "code-quality"],
    remediation:
      "Chạy uv run ruff check src tests trong thư mục services/worker để xem chi tiết và sửa các lỗi lint.",
  },
};

const SENSITIVE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /((?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?)[^\s'",;]{6,}/gi,
];

export function redactSensitiveText(input, maxLength = 300) {
  if (!input || typeof input !== "string") {
    return "";
  }
  let sanitized = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, prefix) => {
      if (typeof prefix === "string" && prefix.length > 0) {
        return `${prefix}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  if (sanitized.length > maxLength) {
    return `${sanitized.slice(0, maxLength)}...`;
  }
  return sanitized;
}

export function normalizeRepoPath(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return "unknown";
  }
  const slashPath = filePath.replace(/\\/g, "/");
  const markers = ["services/worker/", "apps/web/", ".github/", "supabase/", "tests/", "docs/"];
  for (const marker of markers) {
    const idx = slashPath.indexOf(marker);
    if (idx >= 0) {
      return slashPath.slice(idx);
    }
  }
  return slashPath.replace(/^\.\//, "");
}

function safeJsonParse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { ok: false, value: null };
  }
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, value: null };
  }
}

function makeExecutionErrorResult(scannerId, exitCode, stderrText, detail) {
  const redactedStderr = redactSensitiveText(stderrText, 240);
  const summary = redactedStderr
    ? `${detail} (exit code ${exitCode}): ${redactedStderr}`
    : `${detail} (exit code ${exitCode}).`;
  return {
    scannerId,
    status: "findings",
    totalCount: 1,
    items: [
      {
        key: `scanner-error|${scannerId}|${exitCode}`,
        summary,
      },
    ],
  };
}

export function parseGitleaksReport(rawText, exitCode, stderrText = "") {
  const parsed = safeJsonParse(rawText);
  if (parsed.ok && Array.isArray(parsed.value)) {
    const items = parsed.value.map((entry) => {
      const ruleId = String(entry?.RuleID || "unknown-rule");
      const file = normalizeRepoPath(entry?.File || "unknown-file");
      const line = Number.isInteger(entry?.StartLine) ? entry.StartLine : 0;
      const commitRaw = typeof entry?.Commit === "string" ? entry.Commit.trim() : "";
      const commitShort = commitRaw ? commitRaw.slice(0, 12) : "working-tree";
      const linePart = line > 0 ? `:${line}` : "";
      return {
        key: `${ruleId}|${file}|${line}|${commitShort}`,
        summary: `Rule \`${ruleId}\` tại \`${file}${linePart}\` (commit \`${commitShort}\`, giá trị secret đã được ẩn)`,
      };
    });

    if (items.length > 0) {
      return {
        scannerId: "gitleaks",
        status: "findings",
        totalCount: items.length,
        items,
      };
    }
    if (exitCode === 0) {
      return { scannerId: "gitleaks", status: "clean", totalCount: 0, items: [] };
    }
  }

  if (exitCode === 0 && (!rawText || !rawText.trim())) {
    return { scannerId: "gitleaks", status: "clean", totalCount: 0, items: [] };
  }

  return makeExecutionErrorResult(
    "gitleaks",
    exitCode,
    stderrText,
    "Gitleaks kết thúc với lỗi và không tạo được báo cáo JSON hợp lệ",
  );
}

export function parseNpmAuditReport(rawText, exitCode, stderrText = "") {
  const parsed = safeJsonParse(rawText);
  const highSeverities = new Set(["high", "critical"]);

  if (parsed.ok && parsed.value && typeof parsed.value === "object") {
    const data = parsed.value;
    if (data.error) {
      return makeExecutionErrorResult(
        "npm-audit",
        exitCode,
        typeof data.error?.summary === "string" ? data.error.summary : stderrText,
        "npm audit trả về lỗi khi truy vấn dữ liệu advisory",
      );
    }

    const vulnsObj = data.vulnerabilities && typeof data.vulnerabilities === "object" ? data.vulnerabilities : {};
    const items = [];

    for (const [pkgName, info] of Object.entries(vulnsObj)) {
      const severity = String(info?.severity || "").toLowerCase();
      if (!highSeverities.has(severity)) {
        continue;
      }
      const viaList = Array.isArray(info?.via) ? info.via : [];
      const advisoryTitles = viaList
        .filter((v) => v && typeof v === "object")
        .map((v) => {
          const id = v.source ? `GHSA/Adv#${v.source}` : "";
          const title = redactSensitiveText(String(v.title || v.name || ""), 120);
          return id && title ? `${title} (${id})` : title || id;
        })
        .filter(Boolean);

      const viaFallback = viaList.filter((v) => typeof v === "string").slice(0, 3);
      const reason =
        advisoryTitles.length > 0
          ? advisoryTitles.slice(0, 2).join("; ")
          : viaFallback.length > 0
            ? `qua ${viaFallback.join(", ")}`
            : "advisory mức cao";

      const range = typeof info?.range === "string" ? info.range : "*";
      let fixText = "chưa rõ bản vá";
      if (info?.fixAvailable === true) {
        fixText = "có bản vá";
      } else if (info?.fixAvailable === false) {
        fixText = "chưa có bản vá tự động";
      } else if (info?.fixAvailable && typeof info.fixAvailable === "object") {
        const fixName = info.fixAvailable.name || pkgName;
        const fixVer = info.fixAvailable.version || "";
        fixText = fixVer ? `cập nhật ${fixName}@${fixVer}` : `cập nhật ${fixName}`;
      }

      items.push({
        key: `${pkgName}|${severity}|${range}|${reason}`,
        summary: `\`${pkgName}\` (${severity}, phạm vi \`${range}\`): ${reason} - ${fixText}`,
      });
    }

    if (items.length > 0) {
      return {
        scannerId: "npm-audit",
        status: "findings",
        totalCount: items.length,
        items,
      };
    }

    const metaHigh = Number(data?.metadata?.vulnerabilities?.high || 0);
    const metaCritical = Number(data?.metadata?.vulnerabilities?.critical || 0);
    if (metaHigh + metaCritical > 0) {
      return {
        scannerId: "npm-audit",
        status: "findings",
        totalCount: metaHigh + metaCritical,
        items: [
          {
            key: `npm-audit-meta|${metaCritical}|${metaHigh}`,
            summary: `Phát hiện ${metaCritical} lỗ hổng critical và ${metaHigh} lỗ hổng high trong lockfile npm`,
          },
        ],
      };
    }

    if (exitCode === 0) {
      return { scannerId: "npm-audit", status: "clean", totalCount: 0, items: [] };
    }
  }

  return makeExecutionErrorResult(
    "npm-audit",
    exitCode,
    stderrText,
    "npm audit thất bại và không đọc được báo cáo JSON",
  );
}

export function parsePipAuditReport(rawText, exitCode, stderrText = "") {
  const parsed = safeJsonParse(rawText);
  if (parsed.ok && parsed.value) {
    const deps = Array.isArray(parsed.value)
      ? parsed.value
      : Array.isArray(parsed.value?.dependencies)
        ? parsed.value.dependencies
        : null;

    if (deps) {
      const items = [];
      for (const dep of deps) {
        const name = String(dep?.name || "unknown");
        const version = String(dep?.version || "unknown");
        const vulns = Array.isArray(dep?.vulns) ? dep.vulns : [];
        for (const vuln of vulns) {
          const id = String(vuln?.id || "UNKNOWN");
          const fixes = Array.isArray(vuln?.fix_versions) && vuln.fix_versions.length > 0
            ? `bản vá: ${vuln.fix_versions.join(", ")}`
            : "chưa có bản vá";
          items.push({
            key: `${name}|${version}|${id}`,
            summary: `\`${name}==${version}\` - \`${id}\` (${fixes})`,
          });
        }
      }

      if (items.length > 0) {
        return {
          scannerId: "pip-audit",
          status: "findings",
          totalCount: items.length,
          items,
        };
      }
      if (exitCode === 0) {
        return { scannerId: "pip-audit", status: "clean", totalCount: 0, items: [] };
      }
    }
  }

  return makeExecutionErrorResult(
    "pip-audit",
    exitCode,
    stderrText,
    "pip-audit thất bại hoặc không hoàn tất kiểm tra dependency Python",
  );
}

export function parseBanditReport(rawText, exitCode, stderrText = "") {
  const parsed = safeJsonParse(rawText);
  if (parsed.ok && parsed.value && typeof parsed.value === "object") {
    const results = Array.isArray(parsed.value.results) ? parsed.value.results : [];
    const items = results.map((entry) => {
      const testId = String(entry?.test_id || "B000");
      const severity = String(entry?.issue_severity || "MEDIUM");
      const confidence = String(entry?.issue_confidence || "MEDIUM");
      const filename = normalizeRepoPath(entry?.filename || "unknown");
      const line = Number.isInteger(entry?.line_number) ? entry.line_number : 0;
      const text = redactSensitiveText(String(entry?.issue_text || ""), 160);
      const linePart = line > 0 ? `:${line}` : "";
      return {
        key: `${testId}|${severity}|${confidence}|${filename}|${line}`,
        summary: `\`${testId}\` (${severity}/${confidence}) tại \`${filename}${linePart}\`: ${text}`,
      };
    });

    if (items.length > 0) {
      return {
        scannerId: "bandit",
        status: "findings",
        totalCount: items.length,
        items,
      };
    }

    if (exitCode === 0) {
      return { scannerId: "bandit", status: "clean", totalCount: 0, items: [] };
    }
  }

  return makeExecutionErrorResult(
    "bandit",
    exitCode,
    stderrText,
    "Bandit kết thúc với lỗi và không tạo được báo cáo JSON hợp lệ",
  );
}

function extractZizmorLocation(entry) {
  const locations = Array.isArray(entry?.locations) ? entry.locations : [];
  const primary = locations.find((loc) => loc?.symbolic?.kind === "Primary") || locations[0];
  if (!primary) {
    return "unknown";
  }
  const givenPath =
    primary?.symbolic?.key?.Local?.given_path ||
    primary?.concrete?.location?.path ||
    primary?.path ||
    "unknown";
  const normalized = normalizeRepoPath(String(givenPath));
  const startRow = primary?.concrete?.location?.start_point?.row;
  if (Number.isInteger(startRow)) {
    return `${normalized}:${startRow + 1}`;
  }
  return normalized;
}

export function parseZizmorReport(rawText, exitCode, stderrText = "") {
  const parsed = safeJsonParse(rawText);
  if (parsed.ok && Array.isArray(parsed.value)) {
    const items = parsed.value.map((entry) => {
      const ident = String(entry?.ident || entry?.id || "unknown-audit");
      const severity = String(entry?.determinations?.severity || entry?.severity || "Medium");
      const confidence = String(entry?.determinations?.confidence || entry?.confidence || "");
      const desc = redactSensitiveText(String(entry?.desc || entry?.description || ""), 160);
      const location = extractZizmorLocation(entry);
      const level = confidence ? `${severity}/${confidence}` : severity;
      return {
        key: `${ident}|${severity}|${location}`,
        summary: `\`${ident}\` (${level}) tại \`${location}\`: ${desc}`,
      };
    });

    if (items.length > 0) {
      return {
        scannerId: "zizmor",
        status: "findings",
        totalCount: items.length,
        items,
      };
    }

    if (exitCode === 0) {
      return { scannerId: "zizmor", status: "clean", totalCount: 0, items: [] };
    }
  }

  return makeExecutionErrorResult(
    "zizmor",
    exitCode,
    stderrText,
    "zizmor thất bại và không đọc được báo cáo JSON",
  );
}

export function parseRuffReport(rawText, exitCode, stderrText = "") {
  const parsed = safeJsonParse(rawText);
  if (parsed.ok && Array.isArray(parsed.value)) {
    const items = parsed.value.map((entry) => {
      const code = String(entry?.code || "RUFF");
      const filename = normalizeRepoPath(entry?.filename || "unknown");
      const row = Number.isInteger(entry?.location?.row) ? entry.location.row : 0;
      const col = Number.isInteger(entry?.location?.column) ? entry.location.column : 0;
      const message = redactSensitiveText(String(entry?.message || ""), 160);
      const pos = row > 0 ? `:${row}${col > 0 ? `:${col}` : ""}` : "";
      return {
        key: `${code}|${filename}|${row}|${col}|${message}`,
        summary: `\`${code}\` tại \`${filename}${pos}\`: ${message}`,
      };
    });

    if (items.length > 0) {
      return {
        scannerId: "ruff",
        status: "findings",
        totalCount: items.length,
        items,
      };
    }

    if (exitCode === 0) {
      return { scannerId: "ruff", status: "clean", totalCount: 0, items: [] };
    }
  }

  return makeExecutionErrorResult(
    "ruff",
    exitCode,
    stderrText,
    "Ruff thất bại và không tạo được báo cáo JSON hợp lệ",
  );
}

export function computeFingerprint(scannerId, items) {
  const sortedKeys = [...items].map((item) => item.key).sort();
  const payload = JSON.stringify({ scannerId, keys: sortedKeys });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function makeBotMarker(scannerId) {
  return `<!-- ${BOT_MARKER_PREFIX}${scannerId} -->`;
}

export function makeFingerprintMarker(fingerprint) {
  return `<!-- ${FINGERPRINT_MARKER_PREFIX}${fingerprint} -->`;
}

export function extractScannerIdFromBody(body) {
  if (!body || typeof body !== "string") {
    return null;
  }
  const match = body.match(/<!--\s*learnstep-scan-bot:([a-z0-9-]+)\s*-->/);
  return match ? match[1] : null;
}

export function extractFingerprintFromBody(body) {
  if (!body || typeof body !== "string") {
    return null;
  }
  const match = body.match(/<!--\s*learnstep-scan-fingerprint:([a-f0-9]+)\s*-->/);
  return match ? match[1] : null;
}

export function buildIssueBody(config, result, context, options = {}) {
  const maxItems = Number.isInteger(options.maxItems) ? options.maxItems : MAX_ITEMS_PER_ISSUE;
  const maxBodyLength = Number.isInteger(options.maxBodyLength) ? options.maxBodyLength : MAX_BODY_LENGTH;

  const sortedItems = [...result.items].sort((a, b) => a.key.localeCompare(b.key));
  const fingerprint = computeFingerprint(config.id, sortedItems);
  const displayed = sortedItems.slice(0, maxItems);
  const remaining = Math.max(0, result.totalCount - displayed.length);

  const runUrl =
    context.serverUrl && context.repository && context.runId
      ? `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}`
      : null;

  const shortSha = context.sha ? String(context.sha).slice(0, 12) : "unknown";
  const branch = context.refName || "main";

  const lines = [
    makeBotMarker(config.id),
    makeFingerprintMarker(fingerprint),
    "",
    `## Tóm tắt kết quả quét (${config.displayName})`,
    "",
    `- **Scanner:** ${config.displayName}`,
    `- **Số phát hiện:** ${result.totalCount}`,
    `- **Nhánh:** \`${branch}\``,
    `- **Commit:** \`${shortSha}\``,
    `- **Fingerprint:** \`${fingerprint}\``,
  ];

  if (runUrl) {
    lines.push(`- **Workflow run:** ${runUrl}`);
  }

  lines.push("", "## Danh sách phát hiện", "");

  for (const item of displayed) {
    lines.push(`- ${redactSensitiveText(item.summary, 280)}`);
  }

  if (remaining > 0) {
    lines.push(`- ... và ${remaining} phát hiện khác (xem đầy đủ trong log của workflow run).`);
  }

  lines.push(
    "",
    "## Hướng xử lý đề xuất",
    "",
    config.remediation,
    "",
    "Issue này được quản lý tự động bởi bot quét định kỳ. Khi lần quét tiếp theo trên nhánh chính đạt yêu cầu, bot sẽ tự động đóng issue này.",
  );

  let body = lines.join("\n");
  if (body.length > maxBodyLength) {
    const suffix = "\n\n...(Nội dung đã được rút gọn để đảm bảo giới hạn kích thước issue. Xem chi tiết tại workflow run.)";
    body = `${body.slice(0, maxBodyLength - suffix.length)}${suffix}`;
  }

  return { body, fingerprint };
}

export function buildResolvedComment(config, context) {
  const shortSha = context.sha ? String(context.sha).slice(0, 12) : "unknown";
  const runUrl =
    context.serverUrl && context.repository && context.runId
      ? `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}`
      : null;

  const lines = [
    `Quét tự động **${config.displayName}** đã đạt yêu cầu tại commit \`${shortSha}\`.`,
    "Không còn phát hiện nào thuộc danh mục này, bot tự động đóng issue.",
  ];
  if (runUrl) {
    lines.push(`Workflow run: ${runUrl}`);
  }
  return lines.join("\n");
}

export async function ensureLabels(api, labels = REQUIRED_LABELS) {
  const existing = await api.listLabels();
  const existingNames = new Set(existing.map((label) => String(label.name).toLowerCase()));
  const created = [];

  for (const label of labels) {
    if (existingNames.has(label.name.toLowerCase())) {
      continue;
    }
    try {
      await api.createLabel(label);
      created.push(label.name);
    } catch (error) {
      if (error && error.status === 422) {
        continue;
      }
      throw error;
    }
  }

  return created;
}

export async function syncScannerResult(api, config, result, openIssues, context, options = {}) {
  const matchingIssues = openIssues
    .filter((issue) => !issue.pull_request && extractScannerIdFromBody(issue.body) === config.id)
    .sort((a, b) => a.number - b.number);

  const primaryIssue = matchingIssues[0] || null;
  const duplicateIssues = matchingIssues.slice(1);

  if (result.status === "missing") {
    return { scannerId: config.id, action: "skipped-missing", issueNumber: primaryIssue?.number ?? null };
  }

  if (result.status === "clean") {
    const closedNumbers = [];
    for (const issue of matchingIssues) {
      await api.createComment(issue.number, buildResolvedComment(config, context));
      await api.closeIssue(issue.number);
      closedNumbers.push(issue.number);
    }
    return {
      scannerId: config.id,
      action: closedNumbers.length > 0 ? "closed" : "noop-clean",
      issueNumber: closedNumbers[0] ?? null,
      closedNumbers,
    };
  }

  const { body, fingerprint } = buildIssueBody(config, result, context, options);

  for (const dup of duplicateIssues) {
    await api.createComment(
      dup.number,
      `Đóng issue trùng lặp vì đã có issue chính #${primaryIssue.number} theo dõi danh mục ${config.displayName}.`,
    );
    await api.closeIssue(dup.number);
  }

  if (!primaryIssue) {
    const created = await api.createIssue({
      title: config.title,
      body,
      labels: config.labels,
    });
    return {
      scannerId: config.id,
      action: "created",
      issueNumber: created.number,
      fingerprint,
    };
  }

  const existingFingerprint = extractFingerprintFromBody(primaryIssue.body);
  if (existingFingerprint === fingerprint) {
    return {
      scannerId: config.id,
      action: "unchanged",
      issueNumber: primaryIssue.number,
      fingerprint,
    };
  }

  await api.updateIssue(primaryIssue.number, {
    title: config.title,
    body,
    labels: config.labels,
  });

  return {
    scannerId: config.id,
    action: "updated",
    issueNumber: primaryIssue.number,
    fingerprint,
  };
}

export async function syncAllScanners(api, scanResults, context, options = {}) {
  await ensureLabels(api, REQUIRED_LABELS);
  const openIssues = await api.listOpenIssues("automated-scan");
  const outcomes = [];

  for (const [scannerId, config] of Object.entries(SCANNER_CONFIGS)) {
    const result = scanResults[scannerId] || {
      scannerId,
      status: "missing",
      totalCount: 0,
      items: [],
    };
    const outcome = await syncScannerResult(api, config, result, openIssues, context, options);
    outcomes.push(outcome);
  }

  return outcomes;
}

function readOptionalFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function loadScanResultsFromDir(reportsDir) {
  const parsers = {
    gitleaks: parseGitleaksReport,
    "npm-audit": parseNpmAuditReport,
    "pip-audit": parsePipAuditReport,
    bandit: parseBanditReport,
    zizmor: parseZizmorReport,
    ruff: parseRuffReport,
  };

  const results = {};

  for (const [scannerId, parser] of Object.entries(parsers)) {
    const exitText = readOptionalFile(path.join(reportsDir, `${scannerId}.exit`));
    if (exitText === null) {
      results[scannerId] = { scannerId, status: "missing", totalCount: 0, items: [] };
      continue;
    }
    const exitCode = Number.parseInt(exitText.trim(), 10);
    const reportText = readOptionalFile(path.join(reportsDir, `${scannerId}.json`)) ?? "";
    const stderrText = readOptionalFile(path.join(reportsDir, `${scannerId}.stderr.txt`)) ?? "";
    results[scannerId] = parser(reportText, Number.isNaN(exitCode) ? 1 : exitCode, stderrText);
  }

  return results;
}

export function createGitHubClient({ token, repository, apiBaseUrl = "https://api.github.com", fetchImpl = fetch }) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!repository || !repository.includes("/")) {
    throw new Error("GITHUB_REPOSITORY must be in owner/repo format");
  }
  const [owner, repo] = repository.split("/");

  async function request(method, apiPath, body) {
    const url = `${apiBaseUrl}${apiPath}`;
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "learnstep-auto-issue-scanner",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const err = new Error(`GitHub API ${method} ${apiPath} failed with ${response.status}: ${errorText.slice(0, 300)}`);
      err.status = response.status;
      throw err;
    }

    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  return {
    async listLabels() {
      const labels = [];
      for (let page = 1; page <= 10; page += 1) {
        const batch = await request("GET", `/repos/${owner}/${repo}/labels?per_page=100&page=${page}`);
        if (!Array.isArray(batch) || batch.length === 0) {
          break;
        }
        labels.push(...batch);
        if (batch.length < 100) {
          break;
        }
      }
      return labels;
    },
    async createLabel(label) {
      return request("POST", `/repos/${owner}/${repo}/labels`, label);
    },
    async listOpenIssues(labelName) {
      const issues = [];
      const encoded = encodeURIComponent(labelName);
      for (let page = 1; page <= 10; page += 1) {
        const batch = await request(
          "GET",
          `/repos/${owner}/${repo}/issues?state=open&labels=${encoded}&per_page=100&page=${page}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) {
          break;
        }
        issues.push(...batch);
        if (batch.length < 100) {
          break;
        }
      }
      return issues;
    },
    async createIssue({ title, body, labels }) {
      return request("POST", `/repos/${owner}/${repo}/issues`, { title, body, labels });
    },
    async updateIssue(issueNumber, { title, body, labels }) {
      return request("PATCH", `/repos/${owner}/${repo}/issues/${issueNumber}`, { title, body, labels });
    },
    async createComment(issueNumber, body) {
      return request("POST", `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
    },
    async closeIssue(issueNumber) {
      return request("PATCH", `/repos/${owner}/${repo}/issues/${issueNumber}`, {
        state: "closed",
        state_reason: "completed",
      });
    },
  };
}

export function formatStepSummary(scanResults, outcomes) {
  const lines = [
    "## Automated Security and Quality Scan Summary",
    "",
    "| Scanner | Status | Findings | Issue Action | Issue |",
    "| --- | --- | ---: | --- | --- |",
  ];

  for (const outcome of outcomes) {
    const result = scanResults[outcome.scannerId];
    const config = SCANNER_CONFIGS[outcome.scannerId];
    const issueCell = outcome.issueNumber ? `#${outcome.issueNumber}` : "-";
    lines.push(
      `| ${config.displayName} | ${result?.status ?? "missing"} | ${result?.totalCount ?? 0} | ${outcome.action} | ${issueCell} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const reportsDir = process.env.SCAN_REPORTS_DIR;
  if (!reportsDir) {
    throw new Error("SCAN_REPORTS_DIR environment variable is required");
  }

  const scanResults = loadScanResultsFromDir(reportsDir);
  const context = {
    repository: process.env.GITHUB_REPOSITORY || "",
    sha: process.env.GITHUB_SHA || "",
    refName: process.env.GITHUB_REF_NAME || "main",
    runId: process.env.GITHUB_RUN_ID || "",
    serverUrl: process.env.GITHUB_SERVER_URL || "https://github.com",
  };

  const api = createGitHubClient({
    token: process.env.GITHUB_TOKEN || "",
    repository: context.repository,
    apiBaseUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });

  const outcomes = await syncAllScanners(api, scanResults, context);
  const summary = formatStepSummary(scanResults, outcomes);
  process.stdout.write(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`Auto-issue sync failed: ${redactSensitiveText(error?.message || String(error), 400)}`);
    process.exit(1);
  });
}
