export type MathFn = (x: number) => number;

export type PlotPoint = {
  x: number;
  y: number;
};

export type PlotCurveSample = {
  segments: PlotPoint[][];
};

export type FunctionPlotSample = {
  curves: PlotCurveSample[];
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
};

const MAX_EXPR_LENGTH = 240;
const MAX_NORMALIZED_LENGTH = 360;
const MAX_TOKENS = 180;
const MAX_DEPTH = 32;
const ABSURD_VALUE = 1e6;

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const FUNCTIONS: Record<string, MathFn> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (v) => Math.cos(v) / Math.sin(v),
  asin: Math.asin,
  arcsin: Math.asin,
  acos: Math.acos,
  arccos: Math.acos,
  atan: Math.atan,
  arctan: Math.atan,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
};

function expandLatexFrac(source: string): string {
  let result = source;
  for (let pass = 0; pass < 8; pass++) {
    const idx = result.indexOf("\\frac");
    if (idx === -1) break;
    let pos = idx + 5;
    while (pos < result.length && /\s/.test(result[pos])) pos++;
    if (result[pos] !== "{") break;
    const readGroup = (start: number): { content: string; end: number } | null => {
      if (result[start] !== "{") return null;
      let depth = 0;
      for (let i = start; i < result.length; i++) {
        if (result[i] === "{") depth++;
        else if (result[i] === "}") {
          depth--;
          if (depth === 0) {
            return { content: result.slice(start + 1, i), end: i + 1 };
          }
        }
      }
      return null;
    };
    const num = readGroup(pos);
    if (!num) break;
    let denStart = num.end;
    while (denStart < result.length && /\s/.test(result[denStart])) denStart++;
    const den = readGroup(denStart);
    if (!den) break;
    result = `${result.slice(0, idx)}((${num.content})/(${den.content}))${result.slice(den.end)}`;
  }
  return result;
}

export function normalizeMathExpr(raw: string): string {
  let normalized = raw.trim();
  if (!normalized || normalized.length > MAX_EXPR_LENGTH) return "";

  normalized = normalized
    .replace(/\\left/g, "")
    .replace(/\\right/g, "");
  normalized = expandLatexFrac(normalized);

  normalized = normalized
    .replace(/\\cdot\b/g, "*")
    .replace(/\\times\b/g, "*")
    .replace(/[\u00d7\u00b7]/g, "*")
    .replace(/\u00f7/g, "/")
    .replace(/[\u2212\u2013]/g, "-")
    .replace(/\u03c0/g, "pi")
    .replace(/\*\*/g, "^")
    .replace(
      /\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sqrt|cbrt|abs|exp|ln|log|pi|floor|ceil|sign)\b/g,
      "$1",
    )
    .replace(/\{/g, "(")
    .replace(/\}/g, ")");

  return normalized;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "var" }
  | { kind: "const"; value: number }
  | { kind: "func"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "^" }
  | { kind: "lparen" }
  | { kind: "rparen" };

function needsImplicitMul(prev: Token, next: Token): boolean {
  const prevEndsValue =
    prev.kind === "number" ||
    prev.kind === "var" ||
    prev.kind === "const" ||
    prev.kind === "rparen";
  if (!prevEndsValue) return false;

  if (
    next.kind === "var" ||
    next.kind === "const" ||
    next.kind === "func" ||
    next.kind === "lparen"
  ) {
    return true;
  }
  if (prev.kind === "rparen" && next.kind === "number") {
    return true;
  }
  return false;
}

function tokenize(source: string): Token[] | null {
  if (!source || source.length > MAX_NORMALIZED_LENGTH) return null;
  const rawTokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch >= "0" && ch <= "9" || (ch === "." && i + 1 < source.length && source[i + 1] >= "0" && source[i + 1] <= "9")) {
      const start = i;
      let sawDot = false;
      while (i < source.length) {
        const c = source[i];
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === "." && !sawDot) {
          sawDot = true;
          i++;
        } else {
          break;
        }
      }
      const num = Number(source.slice(start, i));
      if (!Number.isFinite(num)) return null;
      rawTokens.push({ kind: "number", value: num });
    } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      const start = i;
      while (
        i < source.length &&
        ((source[i] >= "a" && source[i] <= "z") ||
          (source[i] >= "A" && source[i] <= "Z") ||
          (source[i] >= "0" && source[i] <= "9") ||
          source[i] === "_")
      ) {
        i++;
      }
      const ident = source.slice(start, i).toLowerCase();
      if (ident === "x") {
        rawTokens.push({ kind: "var" });
      } else if (Object.prototype.hasOwnProperty.call(CONSTANTS, ident)) {
        rawTokens.push({ kind: "const", value: CONSTANTS[ident] });
      } else if (Object.prototype.hasOwnProperty.call(FUNCTIONS, ident)) {
        rawTokens.push({ kind: "func", name: ident });
      } else {
        return null;
      }
    } else if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      rawTokens.push({ kind: "op", op: ch });
      i++;
    } else if (ch === "(") {
      rawTokens.push({ kind: "lparen" });
      i++;
    } else if (ch === ")") {
      rawTokens.push({ kind: "rparen" });
      i++;
    } else {
      return null;
    }

    if (rawTokens.length > MAX_TOKENS) return null;
  }

  if (rawTokens.length === 0) return null;

  const tokens: Token[] = [];
  for (const token of rawTokens) {
    const prev = tokens[tokens.length - 1];
    if (prev && needsImplicitMul(prev, token)) {
      tokens.push({ kind: "op", op: "*" });
      if (tokens.length > MAX_TOKENS) return null;
    }
    tokens.push(token);
  }
  return tokens;
}

type AstNode =
  | { type: "num"; value: number }
  | { type: "var" }
  | { type: "neg"; expr: AstNode }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: AstNode; right: AstNode }
  | { type: "call"; fn: MathFn; arg: AstNode };

function parseTokens(tokens: Token[]): AstNode | null {
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const parseAdd = (depth: number): AstNode | null => {
    if (depth > MAX_DEPTH) return null;
    let left = parseMul(depth + 1);
    if (!left) return null;
    while (true) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.op === "+" || tok.op === "-")) {
        consume();
        const right = parseMul(depth + 1);
        if (!right) return null;
        left = { type: "bin", op: tok.op, left, right };
      } else {
        break;
      }
    }
    return left;
  };

  const parseMul = (depth: number): AstNode | null => {
    if (depth > MAX_DEPTH) return null;
    let left = parseUnary(depth + 1);
    if (!left) return null;
    while (true) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.op === "*" || tok.op === "/")) {
        consume();
        const right = parseUnary(depth + 1);
        if (!right) return null;
        left = { type: "bin", op: tok.op, left, right };
      } else {
        break;
      }
    }
    return left;
  };

  const parseUnary = (depth: number): AstNode | null => {
    if (depth > MAX_DEPTH) return null;
    const tok = peek();
    if (tok && tok.kind === "op" && tok.op === "+") {
      consume();
      return parseUnary(depth + 1);
    }
    if (tok && tok.kind === "op" && tok.op === "-") {
      consume();
      const expr = parseUnary(depth + 1);
      return expr ? { type: "neg", expr } : null;
    }
    return parsePower(depth + 1);
  };

  const parsePower = (depth: number): AstNode | null => {
    if (depth > MAX_DEPTH) return null;
    const base = parsePrimary(depth + 1);
    if (!base) return null;
    const tok = peek();
    if (tok && tok.kind === "op" && tok.op === "^") {
      consume();
      const exponent = parseUnary(depth + 1);
      if (!exponent) return null;
      return { type: "bin", op: "^", left: base, right: exponent };
    }
    return base;
  };

  const parsePrimary = (depth: number): AstNode | null => {
    if (depth > MAX_DEPTH) return null;
    const tok = peek();
    if (!tok) return null;

    if (tok.kind === "number" || tok.kind === "const") {
      consume();
      return { type: "num", value: tok.value };
    }
    if (tok.kind === "var") {
      consume();
      return { type: "var" };
    }
    if (tok.kind === "func") {
      consume();
      const open = peek();
      if (!open || open.kind !== "lparen") return null;
      consume();
      const arg = parseAdd(depth + 1);
      if (!arg) return null;
      const close = peek();
      if (!close || close.kind !== "rparen") return null;
      consume();
      return { type: "call", fn: FUNCTIONS[tok.name], arg };
    }
    if (tok.kind === "lparen") {
      consume();
      const inner = parseAdd(depth + 1);
      if (!inner) return null;
      const close = peek();
      if (!close || close.kind !== "rparen") return null;
      consume();
      return inner;
    }
    return null;
  };

  const root = parseAdd(0);
  if (!root || pos !== tokens.length) return null;
  return root;
}

function evalAst(node: AstNode, x: number): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var":
      return x;
    case "neg":
      return -evalAst(node.expr, x);
    case "call":
      return node.fn(evalAst(node.arg, x));
    case "bin": {
      const l = evalAst(node.left, x);
      const r = evalAst(node.right, x);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "^":
          return Math.pow(l, r);
      }
    }
  }
}

export function compileMathExpr(raw: string): MathFn | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_EXPR_LENGTH) {
    return null;
  }
  const normalized = normalizeMathExpr(raw);
  if (!normalized) return null;
  const tokens = tokenize(normalized);
  if (!tokens) return null;
  const ast = parseTokens(tokens);
  if (!ast) return null;

  return (x: number) => {
    if (!Number.isFinite(x)) return Number.NaN;
    const value = evalAst(ast, x);
    return Number.isFinite(value) ? value : Number.NaN;
  };
}

export function numericDerivative(fn: MathFn, x: number, h?: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const step = h && h > 0 && Number.isFinite(h) ? h : Math.max(1e-5, Math.abs(x) * 1e-5);
  const yPlus = fn(x + step);
  const yMinus = fn(x - step);
  if (Number.isFinite(yPlus) && Number.isFinite(yMinus)) {
    const slope = (yPlus - yMinus) / (2 * step);
    return Number.isFinite(slope) ? slope : Number.NaN;
  }
  const yCenter = fn(x);
  if (Number.isFinite(yPlus) && Number.isFinite(yCenter)) {
    const slope = (yPlus - yCenter) / step;
    return Number.isFinite(slope) ? slope : Number.NaN;
  }
  if (Number.isFinite(yMinus) && Number.isFinite(yCenter)) {
    const slope = (yCenter - yMinus) / step;
    return Number.isFinite(slope) ? slope : Number.NaN;
  }
  return Number.NaN;
}

export function niceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  const roughStep = span / Math.max(2, targetCount - 1);
  if (!Number.isFinite(roughStep) || roughStep <= 0) return [];
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const niceNorm =
    normalized <= 1.2 ? 1 : normalized <= 2.5 ? 2 : normalized <= 6 ? 5 : 10;
  const step = niceNorm * magnitude;
  if (!Number.isFinite(step) || step <= 0) return [];

  const eps = step * 1e-7;
  const first = Math.ceil((min - eps) / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i < 40; i++) {
    const raw = first + i * step;
    if (raw > max + eps) break;
    const cleaned = Math.abs(raw) < eps ? 0 : Number(raw.toPrecision(12));
    if (cleaned >= min - eps && cleaned <= max + eps) {
      ticks.push(cleaned);
    }
  }
  return ticks;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeRobustYDomain(values: number[]): [number, number] {
  const finite = values
    .filter((v) => Number.isFinite(v) && Math.abs(v) <= ABSURD_VALUE)
    .sort((a, b) => a - b);

  if (finite.length === 0) return [-5, 5];

  const q05 = quantile(finite, 0.05);
  const q10 = quantile(finite, 0.1);
  const q90 = quantile(finite, 0.9);
  const q95 = quantile(finite, 0.95);
  const coreSpan = Math.max(q90 - q10, 1e-4);

  const lowerFence = q05 - 2.5 * coreSpan;
  const upperFence = q95 + 2.5 * coreSpan;
  const kept = finite.filter((v) => v >= lowerFence && v <= upperFence);
  const target = kept.length >= 2 ? kept : finite;

  let yMin = target[0];
  let yMax = target[target.length - 1];

  if (Math.abs(yMax - yMin) < 1e-6) {
    const center = yMin;
    const pad = Math.max(1, Math.abs(center) * 0.25);
    yMin = center - pad;
    yMax = center + pad;
  } else {
    const pad = (yMax - yMin) * 0.1;
    yMin -= pad;
    yMax += pad;
  }

  return [yMin, yMax];
}

export function sampleFunctionPlot(
  fns: MathFn[],
  xDomain: [number, number],
  explicitYDomain?: [number, number],
  sampleCount = 240,
): FunctionPlotSample {
  const [xMin, xMax] = xDomain;
  const steps = Math.max(24, Math.min(600, Math.floor(sampleCount)));
  const dx = (xMax - xMin) / steps;

  const rawSamples: Array<Array<{ x: number; y: number }>> = fns.map((fn) => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const x = i === steps ? xMax : xMin + i * dx;
      pts.push({ x, y: fn(x) });
    }
    return pts;
  });

  let yDomain: [number, number];
  if (
    explicitYDomain &&
    Number.isFinite(explicitYDomain[0]) &&
    Number.isFinite(explicitYDomain[1]) &&
    explicitYDomain[1] > explicitYDomain[0]
  ) {
    yDomain = [explicitYDomain[0], explicitYDomain[1]];
  } else {
    const allY: number[] = [];
    for (const curve of rawSamples) {
      for (const pt of curve) {
        if (Number.isFinite(pt.y)) allY.push(pt.y);
      }
    }
    yDomain = computeRobustYDomain(allY);
  }

  const [yMin, yMax] = yDomain;
  const ySpan = Math.max(yMax - yMin, 1e-6);
  const clipLow = yMin - ySpan * 2.5;
  const clipHigh = yMax + ySpan * 2.5;

  const curves: PlotCurveSample[] = rawSamples.map((pts, fnIdx) => {
    const fn = fns[fnIdx];
    const segments: PlotPoint[][] = [];
    let current: PlotPoint[] = [];

    for (let i = 0; i < pts.length; i++) {
      const { x, y } = pts[i];
      const valid = Number.isFinite(y) && y >= clipLow && y <= clipHigh;
      if (!valid) {
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }

      if (current.length > 0) {
        const prev = current[current.length - 1];
        const jump = Math.abs(y - prev.y);
        const signFlip = prev.y * y < 0;
        let shouldSplit = false;

        if (jump > ySpan * 1.2) {
          shouldSplit = true;
        } else if (signFlip && jump > ySpan * 0.55) {
          const midY = fn((prev.x + x) * 0.5);
          const lo = Math.min(prev.y, y);
          const hi = Math.max(prev.y, y);
          if (!Number.isFinite(midY) || midY < lo - ySpan * 0.2 || midY > hi + ySpan * 0.2) {
            shouldSplit = true;
          }
        }

        if (shouldSplit) {
          if (current.length >= 2) segments.push(current);
          current = [];
        }
      }

      current.push({ x, y });
    }

    if (current.length >= 2) segments.push(current);
    return { segments };
  });

  return {
    curves,
    xDomain: [xMin, xMax],
    yDomain,
    xTicks: niceTicks(xMin, xMax, 6),
    yTicks: niceTicks(yMin, yMax, 5),
  };
}
