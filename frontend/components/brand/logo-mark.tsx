// Fork: Wearly's drawer logo — cream strokes on a rounded espresso square, in both themes.
interface LogoMarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 32, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="40" height="40" rx="9" fill="#3b2a20" />
      <g fill="none" stroke="#f3e8da" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="9" width="26" height="22" rx="3" />
        <path d="M7 20 H33" />
        <path d="M17 14.5 H23" />
        <path d="M17 25.5 H23" />
      </g>
    </svg>
  );
}
