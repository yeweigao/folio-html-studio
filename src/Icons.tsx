import type { ReactNode } from "react";
export type IconName =
  | "upload"
  | "download"
  | "undo"
  | "redo"
  | "plus"
  | "minus"
  | "chevron"
  | "cursor"
  | "type"
  | "image"
  | "settings"
  | "print"
  | "check"
  | "close"
  | "help"
  | "arrow"
  | "reset"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-justify";
const paths: Record<IconName, ReactNode> = {
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v13m-5-5 5 5 5-5" />
      <path d="M4 17v4h16v-4" />
    </>
  ),
  undo: (
    <>
      <path d="m8 4-5 5 5 5" />
      <path d="M3 9h10a7 7 0 0 1 7 7v3" />
    </>
  ),
  redo: (
    <>
      <path d="m16 4 5 5-5 5" />
      <path d="M21 9H11a7 7 0 0 0-7 7v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  cursor: <path d="m5 3 14 10-7 1-3 7Z" />,
  type: (
    <>
      <path d="M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 5-5 4 4 4-6 5 7" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="M8 3v6m8 0v6m-6 0v6" />
    </>
  ),
  print: (
    <>
      <path d="M6 8V3h12v5M6 17H3V8h18v9h-3" />
      <path d="M6 13h12v8H6Z" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3m0 3h.01" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </>
  ),
  reset: (
    <>
      <path d="M4 4v6h6" />
      <path d="M4 10a8 8 0 1 1 0 6" />
    </>
  ),
  "align-left": <path d="M4 5h16M4 10h11M4 15h16M4 20h11" />,
  "align-center": <path d="M4 5h16M7 10h10M4 15h16M7 20h10" />,
  "align-right": <path d="M4 5h16M9 10h11M4 15h16M9 20h11" />,
  "align-justify": <path d="M4 5h16M4 10h16M4 15h16M4 20h16" />,
};
export default function Icon({
  name,
  size = 18,
}: {
  name: IconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
