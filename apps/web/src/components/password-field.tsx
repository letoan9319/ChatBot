"use client";

import { useState } from "react";

export function PasswordField({
  id = "account-password",
  value,
  onChange,
  reset = false,
  disabled = false,
  label = "Mật khẩu",
  placeholder = "Ít nhất 8 ký tự",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  reset?: boolean;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required
          minLength={8}
          maxLength={128}
          autoComplete={reset ? "new-password" : "current-password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={`${visible ? "Ẩn" : "Hiện"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((previous) => !previous)}
          disabled={disabled}
        >
          {visible ? "Ẩn" : "Hiện"}
        </button>
      </div>
    </div>
  );
}
