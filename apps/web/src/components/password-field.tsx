"use client";

import { useState } from "react";

export function PasswordField({ value, onChange, reset = false, disabled = false, label = "Mật khẩu" }: {
  value: string;
  onChange: (value: string) => void;
  reset?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor="account-password">{label}</label>
      <div className="password-control">
        <input
          id="account-password"
          type={visible ? "text" : "password"}
          required
          minLength={8}
          maxLength={128}
          autoComplete={reset ? "new-password" : "current-password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ít nhất 8 ký tự"
          disabled={disabled}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label="Hiện mật khẩu"
          aria-pressed={visible}
          aria-controls="account-password"
          onClick={() => setVisible((previous) => !previous)}
          disabled={disabled}
        >
          {visible ? "Ẩn" : "Hiện"}
        </button>
      </div>
    </div>
  );
}
