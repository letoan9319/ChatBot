// Match Markdown code before math so examples retain their literal delimiters.
const mathOrCode = new RegExp([
  /^(?<indent> {0,3})(?<fence>(?<fenceChar>[\x60~])\k<fenceChar>{2,})[^\n]*\n[\s\S]*?(?:^\k<indent>\k<fence>\k<fenceChar>*[ \t]*(?=\r?$)|(?![\s\S]))/,
  /(?<ticks>\x60+)(?!\x60)[\s\S]*?(?<!\x60)\k<ticks>(?!\x60)/,
  /(?<!\\)\$\$(?<dollarBlock>[\s\S]*?)\$\$(?<citations>(?:[ \t]+\[S\d+\])*)/,
  /(?<!\\)\$(?:\\.|[^$\r\n\\])+\$/,
  /(?<!\\)\\\[(?<bracketBlock>[\s\S]*?)\\\]/,
  /(?<!\\)\\\((?<inline>[^\r\n]*?)\\\)/,
  /(?<![\]\\])\((?<bare>(?:[^()\r\n]|\([^()\r\n]*\))+)\)/,
].map((pattern) => pattern.source).join("|"), "gm");

// Some replies omit the backslash on the outer parentheses. Only treat these
// as delimiters when the contents look like an expression with TeX syntax.
function isBareTex(expression: string): boolean {
  const withoutText = expression.replace(/\\text\{[^{}\n]*\}/g, "");
  return /\\[a-zA-Z]+|[A-Za-z0-9})][_^][{\da-zA-Z]/.test(withoutText)
    && !/[–—:;,!?$]/.test(withoutText)
    && !/\b[a-zA-Z]{3,}\b/.test(withoutText.replace(/\\[a-zA-Z]+/g, ""));
}

const explicitMath = /\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|(?<![\\$])(?<dollars>[$]{1,2})(?![$])[^$]+?\k<dollars>(?![$])/;
const mathCommand = /\\(?:frac|dfrac|tfrac|sqrt|lim|sum|prod|int|sin|cos|tan|log|ln|exp|infty|pi|theta|alpha|beta|gamma|Delta|partial|nabla|to|rightarrow|cdot|times|left|right|begin|end|binom|vec|overline|mathbf)\b/;

function isStandaloneMath(text: string): boolean {
  if (!text || explicitMath.test(text) || /[`$<>]/.test(text)) return false;
  const body = text
    .replace(/\\(?:text|operatorname|mathrm|mathsf|mathbb|mathbf|begin|end)\{[^{}]*\}/g, "")
    .replace(/\\[a-zA-Z]+\*?/g, "");
  return (mathCommand.test(text) || /[a-zA-Z0-9})][_^][{a-zA-Z0-9-]/.test(text))
    && /^[a-zA-Z0-9\s{}[\]().,_^+*/=|&!'":;~%#\\-]*$/.test(body)
    && !/\b[a-zA-Z]{3,}\b/.test(body);
}

const displayMath = (text: string) => "$$\n" + text.trim() + "\n$$";

export function pastedChatMath(latex: string, plainText: string): string | null {
  const text = (latex.trim() ? latex : plainText).replace(/\r\n?/g, "\n");
  if (explicitMath.test(text)) return text;
  if (latex.trim() || isStandaloneMath(text.trim())) return "\n\n" + displayMath(text) + "\n\n";
  return null;
}

export function normalizeChatMath(content: string): string {
  if (isStandaloneMath(content.trim())) return displayMath(content);
  return content.replace(
    mathOrCode,
    (match: string, ...captures: unknown[]) => {
      const { dollarBlock, citations, bracketBlock, inline, bare } = captures.at(-1) as
        Record<string, string | undefined>;
      const display = bracketBlock ?? dollarBlock;
      if (display?.trim()) {
        if (dollarBlock?.startsWith("\n") && dollarBlock.endsWith("\n") && !citations) return match;
        return "\n\n$$\n" + display.trim() + "\n$$\n\n" + (citations ?? "").trim();
      }
      const expression = inline ?? (bare && isBareTex(bare) ? bare : undefined);
      return expression?.trim() ? "$" + expression.trim() + "$" : match;
    },
  );
}
