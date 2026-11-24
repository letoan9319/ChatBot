"use client";

import Image from "next/image";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { guideTopicIds, guideTopics, welcomeCards, type GuideTopic } from "@/core/study-guide";
import styles from "./study-guide-dialog.module.css";

export type StudyGuideMode = "welcome" | "guide";

function Illustration({ topic }: { topic: GuideTopic }) {
  return <Image className={styles.illustration} src={`/illustrations/guide/${guideTopics[topic].art}.webp`}
    width={480} height={320} alt="" unoptimized />;
}

export function StudyGuideDialog({ mode, onClose, onOpenFullGuide, onNavigate }: {
  mode: StudyGuideMode;
  onClose: () => void;
  onOpenFullGuide: () => void;
  onNavigate: (topic: GuideTopic) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const article = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState<GuideTopic>("study");
  const titleId = useId();
  const topicSelectId = useId();
  const welcome = mode === "welcome";
  const card = welcomeCards[step];
  const detail = guideTopics[topic];
  const finalStep = step === welcomeCards.length - 1;

  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, []);

  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [mode, step]);

  function chooseTopic(next: GuideTopic) {
    setTopic(next);
    if (article.current) article.current.scrollTop = 0;
  }

  return (
    <dialog ref={dialog} className={styles.dialog} data-mode={mode} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            {welcome && <p className={styles.counter}>Bước {step + 1} / {welcomeCards.length}</p>}
            <h2 id={titleId} ref={heading} tabIndex={-1}>{welcome ? card.title : "Hướng dẫn sử dụng"}</h2>
          </div>
          {!welcome && <button type="button" className={styles.secondary} onClick={onClose}>Đóng</button>}
        </header>

        {welcome ? <>
          <div className={styles.welcomeBody} key={card.topic}>
            <Illustration topic={card.topic} />
            <p>{guideTopics[card.topic].intro}</p>
            <p className={styles.tryNext}>{card.tryNext}</p>
          </div>
          <footer className={styles.footer}>
            <button type="button" className={styles.quiet} onClick={onClose}>Bỏ qua</button>
            <div className={styles.actions}>
              {step > 0 && <button type="button" className={styles.secondary}
                onClick={() => setStep(step - 1)}>Quay lại</button>}
              {finalStep && <button type="button" className={styles.secondary}
                onClick={onOpenFullGuide}>Xem hướng dẫn đầy đủ</button>}
              <button type="button" className={styles.primary}
                onClick={finalStep ? onClose : () => setStep(step + 1)}>{finalStep ? "Bắt đầu học" : "Tiếp theo"}</button>
            </div>
          </footer>
        </> : <div className={styles.guideLayout}>
          <nav className={styles.contents} aria-label="Mục lục hướng dẫn">
            {guideTopicIds.map((id) => <button type="button" key={id} aria-current={topic === id ? "true" : undefined}
              onClick={() => chooseTopic(id)}>{guideTopics[id].title}</button>)}
          </nav>
          <div className={styles.mobileContents}>
            <label htmlFor={topicSelectId}>Chủ đề</label>
            <select id={topicSelectId} value={topic} onChange={(event) => chooseTopic(event.target.value as GuideTopic)}>
              {guideTopicIds.map((id) => <option value={id} key={id}>{guideTopics[id].title}</option>)}
            </select>
          </div>
          <article className={styles.topic} ref={article} aria-label={detail.title} tabIndex={0}>
            <div className={styles.hero}>
              <div><h3>{detail.title}</h3><p>{detail.intro}</p></div>
              <Illustration topic={topic} />
            </div>
            <ol className={styles.steps}>
              {detail.steps.map((instruction) => <li key={instruction}>{instruction}</li>)}
            </ol>
            <button type="button" className={styles.primary} onClick={() => onNavigate(topic)}>{detail.action}</button>
          </article>
        </div>}
      </div>
    </dialog>
  );
}
