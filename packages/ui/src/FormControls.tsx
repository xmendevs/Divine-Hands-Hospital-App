import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { theme } from "./theme";

function controlBase(error?: boolean): CSSProperties {
  return {
    padding: "0.5rem 0.75rem",
    borderRadius: theme.radius.md,
    border: `1px solid ${error ? theme.action.danger : theme.surface.borderStrong}`,
    fontSize: theme.fontSize.base,
    background: theme.surface.card,
    color: theme.text.primary,
    outline: "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, style, ...props }: InputProps) {
  return <input style={{ ...controlBase(error), ...style }} {...props} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ error, style, children, ...props }: SelectProps) {
  return (
    <select style={{ ...controlBase(error), ...style }} {...props}>
      {children}
    </select>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, style, ...props }: TextareaProps) {
  return <textarea style={{ ...controlBase(error), minHeight: "80px", resize: "vertical", ...style }} {...props} />;
}

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  error?: boolean;
}

export function Checkbox({ label, error, style, ...props }: CheckboxProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: theme.spacing["2"],
        fontSize: theme.fontSize.base,
        color: error ? theme.action.danger : theme.text.secondary,
        cursor: "pointer",
        ...style,
      }}
    >
      <input type="checkbox" style={{ accentColor: theme.action.primary, width: "16px", height: "16px" }} {...props} />
      {label}
    </label>
  );
}

export interface FormFieldProps {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

export function FormField({ label, htmlFor, required, error, hint, children, style }: FormFieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["1"], ...style }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}
      >
        {label}
        {required ? <span style={{ color: theme.action.danger }}> *</span> : null}
      </label>
      {children}
      {hint ? <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.text.muted }}>{hint}</p> : null}
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.action.danger }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
