import { describe, expect, it } from "vitest";
import {
  compileMathExpr,
  niceTicks,
  numericDerivative,
  sampleFunctionPlot,
} from "./math-eval";

describe("compileMathExpr", () => {
  it("evaluates operator precedence and right-associative powers", () => {
    const negSquare = compileMathExpr("-x^2");
    expect(negSquare).not.toBeNull();
    expect(negSquare!(3)).toBe(-9);
    expect(negSquare!(-3)).toBe(-9);

    const groupedSquare = compileMathExpr("(-x)^2");
    expect(groupedSquare!(3)).toBe(9);

    const rightAssoc = compileMathExpr("2^3^2");
    expect(rightAssoc!(0)).toBe(512);

    const negExp = compileMathExpr("2^-3");
    expect(negExp!(0)).toBeCloseTo(0.125, 10);

    const gaussian = compileMathExpr("e^-x^2");
    expect(gaussian!(2)).toBeCloseTo(Math.exp(-4), 10);
  });

  it("supports implicit multiplication and constants", () => {
    expect(compileMathExpr("2x + 1")!(4)).toBe(9);
    expect(compileMathExpr("3sin(x)")!(Math.PI / 2)).toBeCloseTo(3, 10);
    expect(compileMathExpr("(x-1)(x+1)")!(4)).toBe(15);
    expect(compileMathExpr("2pi")!(0)).toBeCloseTo(2 * Math.PI, 10);
    expect(compileMathExpr("x(x+1)")!(3)).toBe(12);
    expect(compileMathExpr("(x+1)2")!(3)).toBe(8);
  });

  it("normalizes common LLM LaTeX and Python math tokens", () => {
    const expr = compileMathExpr(String.raw`\sin(x) + \cos(x) + \pi - x**2 + 2\cdot x`);
    expect(expr).not.toBeNull();
    expect(expr!(0)).toBeCloseTo(1 + Math.PI, 10);

    const sqrtLog = compileMathExpr(String.raw`\sqrt{x} + \ln{e} + \log{100}`);
    expect(sqrtLog).not.toBeNull();
    expect(sqrtLog!(9)).toBeCloseTo(6, 10);

    const frac = compileMathExpr(String.raw`\frac{x^2 - 1}{x + 1}`);
    expect(frac).not.toBeNull();
    expect(frac!(3)).toBeCloseTo(2, 10);
  });

  it("supports calculus and physics elementary functions", () => {
    expect(compileMathExpr("tan(x)")!(Math.PI / 4)).toBeCloseTo(1, 10);
    expect(compileMathExpr("cot(x)")!(Math.PI / 4)).toBeCloseTo(1, 10);
    expect(compileMathExpr("asin(x)")!(0.5)).toBeCloseTo(Math.PI / 6, 10);
    expect(compileMathExpr("acos(x)")!(0.5)).toBeCloseTo(Math.PI / 3, 10);
    expect(compileMathExpr("atan(x)")!(1)).toBeCloseTo(Math.PI / 4, 10);
    expect(compileMathExpr("cbrt(x)")!(-8)).toBeCloseTo(-2, 10);
    expect(compileMathExpr("abs(x)")!(-7)).toBe(7);
    expect(compileMathExpr("exp(x)")!(1)).toBeCloseTo(Math.E, 10);
    expect(compileMathExpr("sinh(x)")!(0)).toBe(0);
    expect(compileMathExpr("cosh(x)")!(0)).toBe(1);
    expect(compileMathExpr("tanh(x)")!(0)).toBe(0);
    expect(compileMathExpr("floor(x)")!(2.9)).toBe(2);
    expect(compileMathExpr("ceil(x)")!(2.1)).toBe(3);
    expect(compileMathExpr("sign(x)")!(-4)).toBe(-1);
  });

  it("rejects unsafe, malformed, or oversized inputs", () => {
    expect(compileMathExpr("")).toBeNull();
    expect(compileMathExpr("   ")).toBeNull();
    expect(compileMathExpr("alert(1)")).toBeNull();
    expect(compileMathExpr("window.location")).toBeNull();
    expect(compileMathExpr("constructor")).toBeNull();
    expect(compileMathExpr("x; process.exit(1)")).toBeNull();
    expect(compileMathExpr("sin(x")).toBeNull();
    expect(compileMathExpr("2 3")).toBeNull();
    expect(compileMathExpr("x + ".repeat(80) + "1")).toBeNull();
    expect(compileMathExpr("(".repeat(40) + "x" + ")".repeat(40))).toBeNull();
  });
});

describe("numericDerivative and sampleFunctionPlot", () => {
  it("computes accurate central derivatives", () => {
    const fn = compileMathExpr("x^3 - 3x")!;
    expect(numericDerivative(fn, 1)).toBeCloseTo(0, 6);
    expect(numericDerivative(fn, 2)).toBeCloseTo(9, 6);
    expect(numericDerivative(compileMathExpr("sin(x)")!, 0)).toBeCloseTo(1, 6);
  });

  it("splits discontinuous asymptotes like 1/x and tan(x) into separate segments", () => {
    const inv = compileMathExpr("1/x")!;
    const sample = sampleFunctionPlot([inv], [-5, 5]);
    expect(sample.curves[0].segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of sample.curves[0].segments) {
      const hasNeg = seg.some((p) => p.x < 0);
      const hasPos = seg.some((p) => p.x > 0);
      expect(hasNeg && hasPos).toBe(false);
    }
    expect(sample.yDomain[0]).toBeGreaterThan(-50);
    expect(sample.yDomain[1]).toBeLessThan(50);

    const asymDomain = sampleFunctionPlot([inv], [-5, 4]);
    expect(asymDomain.curves[0].segments.length).toBeGreaterThanOrEqual(2);

    const tanSample = sampleFunctionPlot([compileMathExpr("tan(x)")!], [-4, 4]);
    expect(tanSample.curves[0].segments.length).toBeGreaterThanOrEqual(3);
  });

  it("generates clean ticks on 1, 2, 5 * 10^k intervals", () => {
    expect(niceTicks(-4, 4, 6)).toEqual([-4, -2, 0, 2, 4]);
    expect(niceTicks(0, 15, 5)).toEqual([0, 5, 10, 15]);
  });
});
