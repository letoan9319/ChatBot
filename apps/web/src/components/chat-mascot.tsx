"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./chat-mascot.module.css";

type Point = { x: number; y: number };

function position({ x, y }: Point) {
  return `translate(${x * 100}%, ${y * 100}%)`;
}

export function ChatMascot({ docked, sending }: { docked: boolean; sending: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const activeFlight = useRef<Animation | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [motionChoice, setMotionChoice] = useState<boolean | null>(null);
  const moving = motionChoice ?? !reducedMotion;
  const visible = !docked && !sending;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!visible || !element) return;
    let current: Point = { x: 0.12, y: 0.55 };

    function fly(element: HTMLDivElement) {
      const x = current.x < 0.5 ? 0.55 + Math.random() * 0.43 : 0.02 + Math.random() * 0.43;
      const y = 0.04 + Math.random() * 0.92;
      const next = { x, y };
      const distance = Math.hypot((x - current.x) * element.offsetWidth, (y - current.y) * element.offsetHeight);
      const flight = element.animate([{ transform: position(current) }, { transform: position(next) }], {
        duration: Math.max(500, distance / 0.18),
        easing: "ease-in-out",
        fill: "forwards",
      });
      activeFlight.current = flight;
      current = next;
      flight.onfinish = () => {
        // Keep the endpoint as the base position before replacing the finished animation.
        element.style.transform = position(next);
        flight.cancel();
        fly(element);
      };
    }

    fly(element);
    return () => {
      const flight = activeFlight.current;
      if (flight) {
        flight.onfinish = null;
        flight.cancel();
        activeFlight.current = null;
      }
    };
  }, [visible]);

  useEffect(() => {
    if (moving) activeFlight.current?.play();
    else activeFlight.current?.pause();
  }, [visible, moving]);

  if (docked) return null;

  return (
    <div className={styles.rail}>
      {visible && <>
        <div className={styles.airspace} aria-hidden="true">
          <div className={styles.track} ref={track}>
            <Image className={styles.robot} src="/illustrations/chat-robot.webp"
              width={48} height={48} alt="" unoptimized />
          </div>
        </div>
        <button type="button" className={styles.motionButton}
          onClick={() => setMotionChoice(!moving)}>
          {moving ? "Dừng robot" : "Cho robot bay"}
        </button>
      </>}
    </div>
  );
}
