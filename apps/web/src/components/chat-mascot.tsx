"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./chat-mascot.module.css";

type Point = { x: number; y: number };
const flightActions = ["glide", "dash", "dive"] as const;
const actions = [...flightActions, "hover", "greet"] as const;
type Action = (typeof actions)[number];

function frame({ x, y }: Point, tilt = 0) {
  return { transform: `translate(${x * 100}%, ${y * 100}%) rotate(${tilt}deg)` };
}

function maneuver(action: Action, current: Point, width: number) {
  if (action === "hover" || action === "greet") {
    const upper = { x: current.x, y: 0.03 + current.y * 0.35 };
    const lower = { x: current.x, y: 0.56 + current.y * 0.40 };
    return {
      next: current,
      frames: action === "hover"
        ? [frame(current), frame(upper, -4), frame(lower, 4), frame(upper, -4), frame(current)]
        : [frame(current), frame(upper, -16), frame(lower, 13), frame(current)],
      duration: action === "hover" ? 1550 : 950,
    };
  }

  const next = {
    x: current.x < 0.5 ? 0.60 + Math.random() * 0.34 : 0.06 + Math.random() * 0.34,
    y: 0.16 + Math.random() * 0.68,
  };
  const direction = Math.sign(next.x - current.x);
  const middleX = (current.x + next.x) / 2;
  const middle = action === "dive" ? frame({ x: middleX, y: 0.93 }, 13 * direction)
    : action === "glide" ? frame({ x: middleX, y: 0.08 }, -9 * direction)
      : frame({ x: middleX, y: (current.y + next.y) / 2 }, 14 * direction);
  const speed = action === "dash" ? 0.46 : 0.23;
  return {
    next,
    frames: [frame(current), middle, frame(next)],
    duration: Math.max(500, Math.abs(next.x - current.x) * width / speed),
  };
}

export function ChatMascot({ docked, sending }: { docked: boolean; sending: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const visible = !docked && !sending;

  useEffect(() => {
    const element = track.current;
    if (!visible || !element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let current = { x: 0.12, y: 0.55 };
    let previous: Action | undefined;
    let remaining: readonly Action[] = actions;
    let animation: Animation | undefined;

    function fly(trackElement: HTMLDivElement) {
      const choices = previous ? remaining.filter((action) => action !== previous) : flightActions;
      const action = choices[Math.floor(Math.random() * choices.length)];
      remaining = remaining.filter((candidate) => candidate !== action);
      if (remaining.length === 0) remaining = actions;
      const { next, frames, duration } = maneuver(action, current, trackElement.offsetWidth);
      previous = action;
      current = next;
      const flight = trackElement.animate(frames, { duration, easing: "ease-in-out", fill: "forwards" });
      animation = flight;
      flight.onfinish = () => {
        trackElement.style.transform = frame(next).transform;
        flight.cancel();
        animation = undefined;
        syncMotion();
      };
    }

    function syncMotion() {
      if (preference.matches) animation?.pause();
      else if (animation) animation.play();
      else if (element) fly(element);
    }

    syncMotion();
    preference.addEventListener("change", syncMotion);
    return () => {
      preference.removeEventListener("change", syncMotion);
      if (animation) {
        animation.onfinish = null;
        animation.cancel();
      }
      element.style.transform = "";
    };
  }, [visible]);

  if (docked) return null;

  return (
    <div className={styles.rail} aria-hidden="true">
      {visible && <div className={styles.track} ref={track}>
        <Image className={styles.robot} src="/illustrations/chat-robot.webp"
          width={48} height={48} alt="" unoptimized />
      </div>}
    </div>
  );
}
