export type PageInfo = {
  id: string;
  title: string;
  width: number;
  height: number;
  color: string;
};
export type Selection = {
  id: string;
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
  color: string;
  background: string;
  align: string;
  wrap: string;
  wrapSupport: { pretty: boolean; balance: boolean };
  bold: boolean;
  italic: boolean;
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
export type EditorState = {
  pages: PageInfo[];
  page: number;
  selection: Selection | null;
  objects: { id: string; label: string; tag: string; kind: string }[];
  documentFonts: { family: string; embedded: boolean }[];
  undo: boolean;
  redo: boolean;
  warnings: number;
};
