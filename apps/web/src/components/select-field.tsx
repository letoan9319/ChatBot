"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./select-field.module.css";

type Option = { value: string; label: string };
type Position = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

const normalize = (text: string) => text.toLocaleLowerCase("vi-VN").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d");

export function SelectField({ id, label, value, options, onChange, compact = false, disabled = false, className = "" }: {
  id?: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-options`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const inactive = disabled || options.length === 0;
  const expanded = open && !inactive;

  function close() {
    setOpen(false);
    setPosition(null);
    typeahead.current = { text: "", time: 0 };
  }
  function openAt(index = Math.max(0, selectedIndex)) {
    if (inactive) return;
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
    setOpen(true);
  }
  function select(index: number) {
    const option = options[index];
    if (option && !inactive && option.value !== value) onChange(option.value);
    close();
  }

  useLayoutEffect(() => {
    if (!expanded) return;
    function reposition() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12;
      const below = window.innerHeight - rect.bottom - margin - 6;
      const above = rect.top - margin - 6;
      const placeAbove = below < 180 && above > below;
      const height = Math.min(272, Math.max(40, placeAbove ? above : below));
      const width = Math.min(Math.max(rect.width, 210), window.innerWidth - margin * 2);
      setPosition({
        ...(placeAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        width,
        maxHeight: height,
      });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    function dismissOutside(event: Event) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) {
        setOpen(false);
        setPosition(null);
        typeahead.current = { text: "", time: 0 };
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [expanded]);

  useEffect(() => {
    const list = menu.current;
    const option = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [activeIndex, position !== null]);

  useEffect(() => {
    if (inactive) setOpen(false);
  }, [inactive]);

  return (
    <div className={`${styles.root} ${className}`} data-compact={compact}>
      <button ref={trigger} id={triggerId} type="button" role="combobox" aria-label={label}
        aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded ? `${listId}-${activeIndex}` : undefined}
        disabled={inactive} data-select-trigger className={styles.trigger}
        onClick={() => { if (expanded) close(); else openAt(); }}
        onKeyDown={(event) => {
          if (inactive || event.ctrlKey || event.metaKey) return;
          switch (event.key) {
            case "ArrowDown":
            case "ArrowUp":
              event.preventDefault();
              if (!expanded) openAt();
              else setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
              return;
            case "Home":
            case "End":
              event.preventDefault();
              openAt(event.key === "Home" ? 0 : options.length - 1);
              return;
            case "Enter":
            case " ":
              event.preventDefault();
              if (expanded) select(activeIndex); else openAt();
              return;
            case "Escape":
              if (expanded) { event.preventDefault(); event.stopPropagation(); close(); }
              return;
            case "Tab":
              if (expanded) select(activeIndex);
              return;
          }
          if (event.altKey || event.key.length !== 1 || event.nativeEvent.isComposing) return;
          event.preventDefault();
          const now = Date.now();
          const typed = normalize(event.key);
          const text = now - typeahead.current.time > 700 ? typed : typeahead.current.text + typed;
          typeahead.current = { text, time: now };
          const search = [...text].every((character) => character === text[0]) ? text[0] : text;
          const from = expanded ? activeIndex : Math.max(0, selectedIndex);
          const start = search.length === 1 ? from + 1 : from;
          const index = Array.from({ length: options.length }, (_, offset) => (start + offset) % options.length)
            .find((candidate) => normalize(options[candidate].label).startsWith(search));
          if (index !== undefined) openAt(index);
        }}>
        <span className={styles.value}>{options[selectedIndex]?.label ?? "Chọn một mục"}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>
      {expanded && position && createPortal(
        <ul ref={menu} id={listId} role="listbox" aria-label={label} className={styles.menu} style={position}>
          {options.map((option, index) => (
            <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
              data-active={activeIndex === index} className={styles.option}
              onPointerMove={(event) => { if (event.pointerType === "mouse") setActiveIndex(index); }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { select(index); trigger.current?.focus({ preventScroll: true }); }}>
              <span>{option.label}</span>{option.value === value && <small aria-hidden="true">Đã chọn</small>}
            </li>
          ))}
        </ul>, document.body,
      )}
    </div>
  );
}
