"use client";

import { useEffect, useRef } from "react";
import { observeScrollReveals } from "@/core/scroll-reveal";

export function ScrollReveal({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return observeScrollReveals(root.current);
  }, []);

  return <div ref={root}>{children}</div>;
}
