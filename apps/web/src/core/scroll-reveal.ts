/** Enhance offscreen content only; server-rendered content stays readable without JS. */
export function observeScrollReveals(root: HTMLElement): () => void {
  // Reduced motion keeps an opacity-only reveal; CSS removes spatial movement.
  if (!("IntersectionObserver" in window)) return () => {};

  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  const pending = new Set<HTMLElement>();
  let stopped = false;

  function reveal(target: HTMLElement, immediate = false) {
    if (!pending.delete(target) && !immediate) return;
    observer.unobserve(target);
    if (immediate) target.removeAttribute("data-reveal-state");
    else target.dataset.revealState = "visible";
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (stopped) return;
      for (const entry of entries) {
        const tall = entry.boundingClientRect.height > window.innerHeight * 0.85;
        if (entry.isIntersecting && (entry.intersectionRatio >= 0.15 || tall)) {
          reveal(entry.target as HTMLElement);
        }
      }
    },
    { threshold: [0, 0.15] },
  );

  // Read all geometry before changing styles. Restored scroll positions remain visible.
  const belowViewport = targets.filter(
    (target) => target.getBoundingClientRect().top >= window.innerHeight,
  );
  for (const target of belowViewport) {
    pending.add(target);
    target.dataset.revealState = "pending";
    target.style.setProperty("--reveal-delay", `${target.dataset.revealDelay || 0}ms`);
    observer.observe(target);
  }

  function focusIn(event: FocusEvent) {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>("[data-reveal]");
    if (target) reveal(target, true);
  }

  function hashChanged() {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!id) return;
    const section = document.getElementById(id);
    if (!section || !root.contains(section)) return;
    for (const target of pending) {
      if (section.contains(target) || target.contains(section)) reveal(target, true);
    }
  }

  function stop() {
    stopped = true;
    observer.disconnect();
    for (const target of targets) {
      target.removeAttribute("data-reveal-state");
      target.style.removeProperty("--reveal-delay");
    }
    pending.clear();
  }

  hashChanged();
  root.addEventListener("focusin", focusIn);
  window.addEventListener("hashchange", hashChanged);
  return () => {
    stop();
    root.removeEventListener("focusin", focusIn);
    window.removeEventListener("hashchange", hashChanged);
  };
}
