"use client";

import { useState, type FormEvent } from "react";
import { avatarIds, avatarLabels, type AvatarId } from "@/core/pixel-packs";
import { DEFAULT_STUDY_PREFERENCES, type StudyPreferences } from "@/core/study-preferences";
import type { ThemePreference } from "@/core/theme";
import { SelectField } from "./select-field";
import { useTheme } from "./theme-provider";
import { PixelAvatar } from "./pixel-avatar";
import styles from "./study-settings.module.css";

export function StudySettings({ preferences, onChange, storageAvailable, avatar, username, onAvatarChange }: {
  preferences: StudyPreferences;
  onChange: (patch: Partial<StudyPreferences>) => void;
  storageAvailable: boolean;
  avatar: AvatarId | null;
  username: string;
  onAvatarChange: (avatar: AvatarId | null) => void;
}) {
  const { preference, setPreference } = useTheme();
  const [selectedAvatar, setSelectedAvatar] = useState(avatar);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [avatarError, setAvatarError] = useState("");

  async function saveAvatar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || selectedAvatar === avatar) return;
    setSaving(true);
    setStatus("");
    setAvatarError("");
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: selectedAvatar }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new Error(result?.error ?? "Chưa lưu được ảnh đại diện.");
      onAvatarChange(result.avatar);
      setStatus("Đã lưu ảnh đại diện.");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Chưa lưu được ảnh đại diện.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.settingsPanel} aria-label="Cài đặt học tập">
      <div className={styles.inner}>
        <section className={styles.group} aria-labelledby="settings-profile">
          <h2 id="settings-profile">Hồ sơ cá nhân</h2>
          <form onSubmit={saveAvatar}>
            <fieldset className={styles.avatarPicker} disabled={saving}>
              <legend>Ảnh đại diện</legend>
              <div className={styles.avatarOptions}>
                {[null, ...avatarIds].map((id) => <label key={id ?? "default"} className={styles.avatarOption}>
                  <input type="radio" name="avatar" className="sr-only" checked={selectedAvatar === id}
                    onChange={() => { setSelectedAvatar(id); setStatus(""); setAvatarError(""); }} />
                  <PixelAvatar className={styles.avatarPreview} avatar={id} username={username} />
                  <span>{id ? avatarLabels[id] : "Chữ cái mặc định"}</span>
                </label>)}
              </div>
            </fieldset>
            <div className={styles.settingsFooter}>
              <button type="submit" disabled={saving || selectedAvatar === avatar}>{saving ? "Đang lưu…" : "Lưu ảnh đại diện"}</button>
              {status && <p role="status">{status}</p>}
              {avatarError && <p role="alert">{avatarError}</p>}
            </div>
          </form>
        </section>
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
