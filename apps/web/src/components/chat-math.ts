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

export function normalizeChatMath(content: string): string {
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
