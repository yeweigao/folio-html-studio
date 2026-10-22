export type PageInfo = {
  id: string;
  title: string;
  width: number;
  height: number;
  color: string;
};
export type Selection = {
  id: string;
  sourceId: string | null;
  editId: string | null;
  traceable: { text: boolean; style: boolean; image: boolean };
  label: string;
  tag: string;
  text: string;
  image: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  background: string;
  align: string;
  wrap: string;
  wrapSupport: { pretty: boolean; balance: boolean };
  bold: boolean;
  italic: boolean;
  underline: boolean;
  letterSpacing: number;
  kind: "text" | "image" | "graphic" | "shape";
  originalFont: string;
  styleLabel: string;
  scopes: {
    id: string;
    label: string;
    count: number;
    pages: number[];
    examples: string[];
  }[];
  graphic: {
    brand: boolean;
    opacity: number;
    scale: number;
    rotation: number;
    color: string;
  } | null;
};
export type HandbookSource = { build: string; lang: string | null; title: string | null };
export type PageBackground = {
  id: string;
  label: string;
  opacity: number;
  fit: "cover" | "contain";
};
export type LayoutGridInfo = {
  visible: boolean;
  columns: number;
  lines: number;
  source: "css-grid" | "inferred";
  rhythm: number;
};
export type EditorState = {
  source: HandbookSource | null;
  pages: PageInfo[];
  page: number;
  selection: Selection | null;
  objects: { id: string; label: string; tag: string; kind: string }[];
  documentFonts: { family: string; embedded: boolean }[];
  documentColors: string[];
  background: PageBackground | null;
  grid: LayoutGridInfo | null;
  undo: boolean;
  redo: boolean;
  warnings: number;
};
