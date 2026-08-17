import type { CSSProperties } from "react";
import { theme } from "./theme";

export interface SpinnerProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
}

/** Dependency-free spinner (SMIL rotation, no keyframes/CSS needed). */
export function Spinner({ size = 20, color = theme.action.primary, style }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
      style={style}
    >
      <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
