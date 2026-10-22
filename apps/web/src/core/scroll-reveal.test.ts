import { afterEach, describe, expect, it, vi } from "vitest";
import { observeScrollReveals } from "./scroll-reveal";

function setup({ reduced = false, supported = true } = {}) {
  const media = Object.assign(new EventTarget(), { matches: reduced });
  const firstScreen = target(100);
  const below = target(1000);
  const targets = [firstScreen, below];
  const root = Object.assign(new EventTarget(), {
    querySelectorAll: () => targets,
  }) as unknown as HTMLElement;
  let notify: IntersectionObserverCallback;
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  const observe = vi.fn();
  const Observer = vi.fn(class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  });
  const browser = Object.assign(new EventTarget(), {
    innerHeight: 800,
    matchMedia: () => media,
    location: { hash: "" },
    ...(supported ? { IntersectionObserver: Observer } : {}),
  });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("IntersectionObserver", Observer);
  return {
    root, media, firstScreen, below, Observer, unobserve, disconnect, observe,
    enter: () => notify!([{
      target: below,
      isIntersecting: true,
      intersectionRatio: 0.2,
      boundingClientRect: { height: 250 },
    } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
  };
}

function target(top: number) {
  const dataset: Record<string, string> = {};
  return {
    dataset,
    getBoundingClientRect: () => ({ top }),
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    removeAttribute: (name: string) => {
      if (name === "data-reveal-state") delete dataset.revealState;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("scroll reveal accessibility and lifecycle", () => {
  it("keeps the initial viewport readable and reveals offscreen content only once", () => {
    const env = setup();
    const cleanup = observeScrollReveals(env.root);
    expect(env.firstScreen.dataset.revealState).toBeUndefined();
    expect(env.below.dataset.revealState).toBe("pending");
    env.enter();
    expect(env.below.dataset.revealState).toBe("visible");
    expect(env.unobserve).toHaveBeenCalledTimes(1);
    env.enter();
    expect(env.unobserve).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("leaves all content visible when IntersectionObserver is unavailable", () => {
    const env = setup({ supported: false });
    observeScrollReveals(env.root)();
    expect(env.below.dataset.revealState).toBeUndefined();
    expect(env.Observer).not.toHaveBeenCalled();
  });

  it("still reveals content when Windows has disabled spatial animation", () => {
    const env = setup({ reduced: true });
    const cleanup = observeScrollReveals(env.root);
    expect(env.below.dataset.revealState).toBe("pending");
    env.enter();
    expect(env.below.dataset.revealState).toBe("visible");
    cleanup();
  });

  it("does not cancel pending reveals when reduced motion changes during the visit", () => {
    const env = setup();
    const cleanup = observeScrollReveals(env.root);
    env.media.matches = true;
    env.media.dispatchEvent(new Event("change"));
    expect(env.below.dataset.revealState).toBe("pending");
    env.enter();
    expect(env.below.dataset.revealState).toBe("visible");
    cleanup();
  });

  it("cleans up hidden content and ignores queued observer callbacks after navigation", () => {
    const env = setup();
    const cleanup = observeScrollReveals(env.root);
    cleanup();
    env.enter();
    expect(env.below.dataset.revealState).toBeUndefined();
    expect(env.disconnect).toHaveBeenCalled();
  });
});
