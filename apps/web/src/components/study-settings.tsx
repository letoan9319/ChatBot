"use client";

import { DEFAULT_STUDY_PREFERENCES, type StudyPreferences } from "@/core/study-preferences";
import type { ThemePreference } from "@/core/theme";
import { SelectField } from "./select-field";
import { useTheme } from "./theme-provider";
import styles from "./study-settings.module.css";

export function StudySettings({ preferences, onChange, storageAvailable }: {
  preferences: StudyPreferences;
  onChange: (patch: Partial<StudyPreferences>) => void;
  storageAvailable: boolean;
}) {
  const { preference, setPreference } = useTheme();
  return (
    <section className={styles.settingsPanel} aria-label="Cài đặt học tập">
      <div className={styles.inner}>
        <section className={styles.group} aria-labelledby="settings-appearance">
          <h2 id="settings-appearance">Giao diện & đọc</h2>
          <div className={styles.settingRow}>
            <div><label htmlFor="setting-theme">Chế độ hiển thị</label><p>Chọn sáng, tối hoặc theo cài đặt thiết bị.</p></div>
            <SelectField id="setting-theme" label="Chế độ hiển thị" value={preference}
              className={styles.select} onChange={(value) => setPreference(value as ThemePreference)}
              options={[{ value: "system", label: "Theo thiết bị" }, { value: "light", label: "Sáng" }, { value: "dark", label: "Tối" }]} />
          </div>
          <div className={styles.settingRow}>
            <div><label htmlFor="setting-font">Cỡ chữ lời giải</label><p>Áp dụng cho nội dung hội thoại và đoạn nguồn.</p></div>
            <SelectField id="setting-font" label="Cỡ chữ lời giải" value={preferences.answerFontSize}
              className={styles.select} onChange={(value) => onChange({ answerFontSize: value as StudyPreferences["answerFontSize"] })}
              options={[{ value: "normal", label: "Tiêu chuẩn" }, { value: "large", label: "Lớn hơn" }]} />
          </div>
        </section>
        <section className={styles.group} aria-labelledby="settings-chat">
          <h2 id="settings-chat">Hội thoại</h2>
          <div className={styles.settingRow}>
            <div><label htmlFor="setting-enter">Nhấn Enter để gửi</label><p id="setting-enter-description">{preferences.sendWithEnter
              ? "Enter gửi câu hỏi; Shift + Enter xuống dòng."
              : "Enter xuống dòng; Ctrl + Enter hoặc Command + Enter để gửi."}</p></div>
            <input id="setting-enter" className={styles.switch} type="checkbox" role="switch"
              checked={preferences.sendWithEnter} aria-describedby="setting-enter-description"
              onChange={(event) => onChange({ sendWithEnter: event.target.checked })} />
          </div>
          <div className={styles.settingRow}>
            <div><label htmlFor="setting-scroll">Tự cuộn theo câu trả lời</label><p id="setting-scroll-description">Theo dõi phần trả lời mới khi bạn đang ở cuối hội thoại. Cuộn lên để đọc mà không bị kéo xuống.</p></div>
            <input id="setting-scroll" className={styles.switch} type="checkbox" role="switch"
              checked={preferences.autoScroll} aria-describedby="setting-scroll-description"
              onChange={(event) => onChange({ autoScroll: event.target.checked })} />
          </div>
        </section>
        <div className={styles.settingsFooter}>
          <p role="status">{storageAvailable ? "Thay đổi được lưu tự động trên trình duyệt này."
            : "Thay đổi đang áp dụng ở tab này. Trình duyệt chưa cho phép lưu cài đặt."}</p>
          <button onClick={() => { onChange({ ...DEFAULT_STUDY_PREFERENCES }); setPreference("system"); }}>Khôi phục mặc định</button>
        </div>
      </div>
    </section>
  );
}
