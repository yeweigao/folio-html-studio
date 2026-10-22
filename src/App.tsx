import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icons";
import type { IconName } from "./Icons";
import type { EditorState, PageBackground, Selection } from "./types";
import { prepareDocument, downloadHtml } from "./document";
import { importFile } from "./importer";
import sampleHtml from "./sample.html?raw";
import { loadDraft, saveDraft } from "./storage";
import type { Draft } from "./storage";
import FontPicker from "./FontPicker";
import { printFonts, fontCss } from "./fonts";
import {
  backgroundPresets,
  classicPalettes,
  completeDocumentPalette,
  createRandomBackground,
  paletteColorCount,
  recolorBackgroundSource,
  selectPaletteColors,
} from "./backgrounds";

const emptyState: EditorState = {
  source: null,
  pages: [],
  page: 0,
  selection: null,
  objects: [],
  undo: false,
  redo: false,
  warnings: 0,
  documentFonts: [],
  documentColors: [],
  background: null,
  grid: null,
};
// 编辑包里不能按 ID 写回手册源文件的修改类型
function untraceable(selection: Selection): string[] {
  const out: string[] = [];
  if (selection.kind === "text" && !selection.traceable.text)
    out.push("这段文字没有内容 ID，改字不会写回");
  if (selection.image && !selection.traceable.image)
    out.push("这张图片没有编辑 ID，换图不会写回");
  if (!selection.traceable.style)
    out.push("这个对象没有 ID，位置、尺寸与样式调整不会写回");
  return out;
}
function ToolButton({
  icon,
  title,
  onClick,
  disabled = false,
  active,
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button${active ? " active" : ""}`}
      aria-label={title}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "px",
  className = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(Math.round(value * 10) / 10));
  useEffect(() => setText(String(Math.round(value * 10) / 10)), [value]);
  return (
    <label className={`number-field ${className}`.trim()}>
      <span>{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={() => {
          const number = Number(text);
          if (text.trim() && Number.isFinite(number))
            onChange(
              Math.max(min ?? Number.NEGATIVE_INFINITY, Math.min(max ?? Number.POSITIVE_INFINITY, number)),
            );
          else setText(String(value));
        }}
      />
      <span className="unit">{unit}</span>
    </label>
  );
}

function BackgroundControls({
  background,
  onUpdate,
  onBegin,
  onEnd,
}: {
  background: PageBackground | null;
  onUpdate: (
    mode: "opacity" | "fit" | "remove",
    value?: number | "cover" | "contain",
  ) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  if (!background)
    return (
      <>
        <div className="background-empty">
          <div className="background-empty-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h3>为页面铺一层底色</h3>
          <p>
            从左侧挑选一款底纹，或用随机生成探索新的渐变、线条与几何构图。
          </p>
        </div>
        <section className="inspector-section background-note">
          <h3>轻一点，更耐看</h3>
          <p>
            底纹位于文字和图片之后。应用后可随时调节透明度，下载的 HTML 会保留这些效果。
          </p>
        </section>
      </>
    );

  return (
    <>
      <section className="inspector-section background-current">
        <div className="background-current-preview" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="background-current-label">
          <span>当前页面底纹</span>
          <strong title={background.label}>{background.label}</strong>
        </div>
      </section>
      <section className="inspector-section">
        <h3>细节调整</h3>
        <label className="range-field">
          <span>
            透明度 <strong>{background.opacity}%</strong>
          </span>
          <input
            aria-label="底纹透明度"
            type="range"
            min="0"
            max="100"
            step="1"
            value={background.opacity}
            onPointerDown={onBegin}
            onPointerUp={onEnd}
            onPointerCancel={onEnd}
            onChange={(event) =>
              onUpdate("opacity", Number(event.target.value))
            }
          />
        </label>
        <label className="select-field background-fit">
          图片铺放
          <select
            aria-label="底纹图片铺放"
            value={background.fit}
            onChange={(event) =>
              onUpdate("fit", event.target.value as "cover" | "contain")
            }
          >
            <option value="cover">铺满页面 · 允许裁切</option>
            <option value="contain">完整显示 · 保留留白</option>
          </select>
        </label>
        <button
          className="button secondary full-width background-remove"
          onClick={() => onUpdate("remove")}
        >
          <Icon name="close" size={15} />
          移除页面底纹
        </button>
      </section>
      <section className="inspector-section background-note">
        <h3>应用范围</h3>
        <p>在左侧切换“当前页”或“全部页”，即可把选中的底纹与调整同步到相应页面。</p>
      </section>
    </>
  );
}

export default function App() {
  const channel = useRef(crypto.randomUUID());
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const selectedId = useRef<string | undefined>(undefined);
  const documentVersion = useRef(0);
  const workspace = useRef<HTMLDivElement>(null);
  const canvasArea = useRef<HTMLElement>(null);
  const paperWrap = useRef<HTMLDivElement>(null);
  const floatingToolbar = useRef<HTMLDivElement>(null);
  const source = useRef(sampleHtml);
  const fileName = useRef("Field_Notes.html");
  const pendingHistory = useRef<{
    undo: string[];
    redo: string[];
    page: number;
  } | null>(null);
  const hasOpened = useRef(false);
  const [frameHtml, setFrameHtml] = useState(() =>
    prepareDocument(sampleHtml, channel.current),
  );
  const [frameRevision, setFrameRevision] = useState(0);
  const [state, setState] = useState<EditorState>(emptyState);
  const [name, setName] = useState("Field Notes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("示例文档");
  const [draft, setDraft] = useState<Draft>();
  const [help, setHelp] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState(800);
  const [draggingFile, setDraggingFile] = useState(false);
  const [tab, setTab] = useState<"pages" | "objects" | "background">("pages");
  const [backgroundScope, setBackgroundScope] = useState<"page" | "all">("page");
  const [paletteMode, setPaletteMode] = useState<"document" | "classic" | "custom">("document");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [selectedDocumentColors, setSelectedDocumentColors] = useState<string[]>([]);
  const [customPalette, setCustomPalette] = useState<string[]>(classicPalettes[0].colors);
  const [activeSwatch, setActiveSwatch] = useState(0);
  const [batchScope, setBatchScope] = useState("single");
  const [quickApplyScope, setQuickApplyScope] = useState("book-style");
  const [floatingPosition, setFloatingPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [objectFilter, setObjectFilter] = useState("all");
  const [fontLoading, setFontLoading] = useState("");
  const fallbackColors = classicPalettes[0].colors;
  const documentColorSignature = state.documentColors.join("|");
  const documentPaletteColors = selectedDocumentColors.length
    ? selectedDocumentColors
    : selectPaletteColors(state.documentColors);
  const activePaletteColors = paletteMode === "document"
    ? completeDocumentPalette(documentPaletteColors, fallbackColors)
    : paletteMode === "custom"
      ? Array.from({ length: 4 }, (_, index) => customPalette[index] || fallbackColors[index])
      : classicPalettes[paletteIndex]?.colors || fallbackColors;
  useEffect(() => {
    selectedId.current = state.selection?.id;
    setBatchScope("single");
    if (state.selection) {
      const scopes = state.selection.scopes.filter((scope) => scope.count > 1);
      const preferred =
        scopes.find((scope) => scope.id === "book-heading") ||
        scopes.find((scope) => scope.id === "book-style") ||
        scopes.find((scope) => scope.id === "page-style") ||
        scopes[0];
      if (preferred) setQuickApplyScope(preferred.id);
    }
  }, [state.selection?.id]);
  useEffect(() => {
    setSelectedDocumentColors(selectPaletteColors(state.documentColors));
  }, [documentColorSignature]);

  const command = useCallback((action: string, value?: unknown) => {
    frame.current?.contentWindow?.postMessage(
      { folio: channel.current, action, value },
      "*",
    );
  }, []);
  const openDocument = useCallback(
    (html: string, nextName: string, imported = true) => {
      source.current = html;
      documentVersion.current++;
      setFontLoading("");
      fileName.current = nextName;
      hasOpened.current = imported;
      setName(nextName.replace(/\.(html?|zip)$/i, ""));
      setLoading(true);
      setState(emptyState);
      setFrameHtml(prepareDocument(html, channel.current));
      setFrameRevision((v) => v + 1);
      setZoom(null);
      setDraft(undefined);
      setSaveStatus(imported ? "正在保存到本机…" : "示例文档");
    },
    [],
  );

  useEffect(() => {
    loadDraft()
      .then((value) => {
        if (value && !hasOpened.current) setDraft(value);
      })
      .catch(() => {
        /* Import/edit still works if storage is disabled. */
      });
  }, []);
  useEffect(() => {
    const node = workspace.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setAvailableWidth(entries[0].contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.folio !== channel.current
      )
        return;
      const data = event.data;
      if (data.type === "state") {
        selectedId.current = data.state.selection?.id;
        setState(data.state);
      }
      if (data.type === "fontReady") setFontLoading("");
      if (data.type === "error") {
        setError(data.message);
        setFontLoading("");
      }
      if (data.type === "ready") {
        setLoading(false);
        if (pendingHistory.current) {
          command("setHistory", pendingHistory.current);
          pendingHistory.current = null;
        }
      }
      if (data.type === "snapshot") {
        source.current = data.html;
        if (hasOpened.current || !data.initial) {
          hasOpened.current = true;
          setSaveStatus("正在保存到本机…");
          saveDraft({
            html: data.html,
            name: fileName.current,
            savedAt: Date.now(),
          })
            .then(() => setSaveStatus("已保存到此浏览器"))
            .catch(() => setSaveStatus("本机保存失败，请下载 HTML"));
        }
      }
      if (data.type === "export") {
        source.current = data.html;
        downloadHtml(data.html, fileName.current);
        setNotice("已下载可继续编辑的 HTML。重新导入即可接着修改。");
      }
      if (data.type === "restore") {
        documentVersion.current++;
        setFontLoading("");
        pendingHistory.current = {
          undo: data.undo,
          redo: data.redo,
          page: data.page,
        };
        setLoading(true);
        setFrameHtml(prepareDocument(data.html, channel.current));
        setFrameRevision((v) => v + 1);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [command]);
  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => {
      setError(
        "文档加载时间较长，可能有未能加载的字体或资源。可以尝试导入单文件 HTML 或完整 ZIP。",
      );
      setLoading(false);
    }, 15000);
    return () => clearTimeout(timeout);
  }, [loading]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        command("export");
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      ) {
        event.preventDefault();
        command("history", event.shiftKey ? "redo" : "undo");
      }
      if (event.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [command]);

  const handleImport = async (file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const result = await importFile(file);
      openDocument(result.html, result.name);
      setNotice(result.notices.join(" "));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "无法读取文件，请检查后重新导入。",
      );
      setLoading(false);
    }
  };
  const patch = (styles: Record<string, string>) =>
    command("patch", { styles, scope: batchScope });
  const applyTypographyToScope = (selection: Selection, scopeId: string) => {
    const scope = selection.scopes.find((item) => item.id === scopeId);
    if (!scope || scope.count < 2) return;
    command("patch", {
      scope: scopeId,
      styles: {
        "font-family": selection.fontFamily,
        "font-size": `${selection.fontSize}px`,
        "font-weight": String(
          Math.max(100, Math.min(900, Math.round(selection.fontWeight))),
        ),
        "font-style": selection.italic ? "italic" : "normal",
        "text-decoration-line": selection.underline ? "underline" : "none",
        "line-height": `${selection.lineHeight}px`,
        "letter-spacing": `${selection.letterSpacing}px`,
        color: selection.color,
        "text-align": selection.align,
        "text-align-last": "auto",
      },
    });
    setNotice(`已将当前排版应用到 ${scope.count} 个对象。`);
  };
  const applyBackground = (background: {
    id: string;
    label: string;
    src: string;
    opacity: number;
  }) => {
    setError("");
    command("background", {
      mode: "apply",
      scope: backgroundScope,
      background: { ...background, fit: "cover" },
    });
  };
  const changePaletteColor = (index: number, color: string) => {
    setCustomPalette(activePaletteColors.map((current, i) => i === index ? color : current));
    setActiveSwatch(index);
    setPaletteMode("custom");
  };
  const toggleDocumentColor = (color: string) => {
    if (documentPaletteColors.includes(color)) {
      if (documentPaletteColors.length <= 1) {
        setNotice("至少保留一种 HTML 主色，才能继续使用文档配色。");
        return;
      }
      setSelectedDocumentColors(documentPaletteColors.filter((candidate) => candidate !== color));
      return;
    }
    if (documentPaletteColors.length >= 4) {
      setNotice("色板最多选 4 种颜色；先取消一色，再加入新的候选色。");
      return;
    }
    setSelectedDocumentColors([...documentPaletteColors, color]);
  };
  const autoSelectDocumentColors = () =>
    setSelectedDocumentColors(selectPaletteColors(state.documentColors));
  const pickScreenColor = async () => {
    type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };
    const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!EyeDropper) {
      setNotice("此浏览器暂不支持屏幕取色；点击色块仍可使用系统取色器。");
      return;
    }
    try {
      const result = await new EyeDropper().open();
      changePaletteColor(activeSwatch, result.sRGBHex);
      setNotice(`已将 ${result.sRGBHex.toUpperCase()} 加入当前色板。`);
    } catch {
      // The browser rejects the picker promise when the user presses Escape.
    }
  };
  const updateBackground = (
    mode: "opacity" | "fit" | "remove",
    value?: number | "cover" | "contain",
  ) => {
    if (mode === "remove")
      command("background", { mode, scope: backgroundScope });
    else if (mode === "opacity")
      command("background", {
        mode,
        opacity: Number(value),
        scope: backgroundScope,
      });
    else
      command("background", {
        mode,
        fit: value,
        scope: backgroundScope,
      });
  };
  const handleBackgroundImport = (file?: File) => {
    if (!file) return;
    if (file.size > 14 * 1024 * 1024) {
      setError("这张图片超过 14 MB，请先压缩后再添加为页面底纹。");
      return;
    }
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      setError("页面底纹支持 PNG、JPG、WebP 或 GIF 图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError("无法读取这张图片，请重试。");
        return;
      }
      applyBackground({
        id: `upload-${Date.now()}`,
        label: file.name.replace(/\.[^.]+$/, "") || "自定义图片",
        src: reader.result,
        opacity: 32,
      });
    };
    reader.onerror = () => setError("无法读取这张图片，请重试。");
    reader.readAsDataURL(file);
  };
  const chooseFont = async (id: string) => {
    const font = printFonts.find((font) => font.id === id);
    if (!font || !state.selection) return;
    const targetId = state.selection.id,
      version = documentVersion.current,
      scope = batchScope;
    setError("");
    setFontLoading(font.name);
    try {
      const css = await fontCss(font);
      if (
        selectedId.current !== targetId ||
        documentVersion.current !== version
      ) {
        setFontLoading("");
        setNotice("字体已准备好。请在需要的对象上重新选择该字体。");
        return;
      }
      command("installFont", {
        id: font.id,
        family: font.family,
        css,
        targetId,
        scope,
        fallback:
          font.category === "中文"
            ? "serif"
            : font.category.includes("无衬线")
              ? "sans-serif"
              : "serif",
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "字体加载失败。");
      setFontLoading("");
    }
  };
  const selection: Selection | null = state.selection;
  const page = state.pages[state.page];
  const scale =
    zoom ??
    Math.max(
      0.2,
      Math.min(0.82, (availableWidth - 100) / (page?.width || 794)),
    );
  const currentW = page?.width || 794,
    currentH = page?.height || 1123;
  const grid = state.grid;
  const gridLabel = grid
    ? grid.columns
      ? `${grid.columns} 栏网格`
      : `${grid.lines} 条参考线`
    : "布局网格";
  const gridTitle = grid
    ? `${grid.visible ? "隐藏" : "显示"} ${gridLabel}${
        grid.gutter ? ` · ${grid.gutter}px 栏间` : ""
      }${grid.rhythm ? ` · ${grid.rhythm}px 基线` : ""}`
    : "布局网格";
  const showFloatingToolbar =
    !!selection && selection.kind === "text" && !loading && tab !== "background";
  const typographyScopes = selection?.scopes.filter(
    (scope) =>
      ["page-style", "book-style", "page-heading", "book-heading"].includes(
        scope.id,
      ) && scope.count > 1,
  ) || [];
  const activeTypographyScope =
    typographyScopes.find((scope) => scope.id === quickApplyScope) ||
    typographyScopes[0];

  useLayoutEffect(() => {
    if (!showFloatingToolbar || !selection) {
      setFloatingPosition(null);
      return;
    }

    let scheduled = 0;
    const placeToolbar = () => {
      const area = canvasArea.current;
      const scrollArea = workspace.current;
      const paper = paperWrap.current;
      const toolbar = floatingToolbar.current;
      if (!area || !scrollArea || !paper || !toolbar) return;

      const areaRect = area.getBoundingClientRect();
      const scrollRect = scrollArea.getBoundingClientRect();
      const paperRect = paper.getBoundingClientRect();
      const toolbarWidth = toolbar.offsetWidth;
      const toolbarHeight = toolbar.offsetHeight;
      const targetLeft = paperRect.left - areaRect.left + selection.x * scale;
      const targetTop = paperRect.top - areaRect.top + selection.y * scale;
      const targetRight = targetLeft + selection.width * scale;
      const targetBottom = targetTop + selection.height * scale;
      const visibleTop = scrollRect.top - areaRect.top + 6;
      const visibleBottom = scrollRect.bottom - areaRect.top - 6;

      if (targetBottom < visibleTop || targetTop > visibleBottom) {
        setFloatingPosition(null);
        return;
      }

      const minLeft = 8;
      const maxLeft = Math.max(minLeft, area.clientWidth - toolbarWidth - 8);
      const center = (targetLeft + targetRight) / 2;
      const left = Math.max(minLeft, Math.min(maxLeft, center - toolbarWidth / 2));
      const minTop = Math.max(8, visibleTop);
      const maxTop = Math.max(minTop, Math.min(area.clientHeight, visibleBottom) - toolbarHeight - 4);
      let top = targetTop - toolbarHeight - 8;
      if (top < minTop) top = targetBottom + 8;
      top = Math.max(minTop, Math.min(maxTop, top));

      setFloatingPosition((current) =>
        current && Math.abs(current.left - left) < 1 && Math.abs(current.top - top) < 1
          ? current
          : { left, top },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(placeToolbar);
    };

    schedule();
    const scrollArea = workspace.current;
    const area = canvasArea.current;
    const paper = paperWrap.current;
    const toolbar = floatingToolbar.current;
    scrollArea?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    [area, scrollArea, paper, toolbar].forEach((node) => {
      if (node) observer.observe(node);
    });
    return () => {
      cancelAnimationFrame(scheduled);
      scrollArea?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [
    showFloatingToolbar,
    selection?.id,
    selection?.x,
    selection?.y,
    selection?.width,
    selection?.height,
    scale,
    currentW,
    currentH,
    state.page,
  ]);

  return (
    <div
      className="studio"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDraggingFile(false);
        void handleImport(e.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Folio HTML Studio 首页">
          <span className="brand-symbol">
            <span />
            <span />
          </span>
          <span>
            Folio<span className="brand-caption">HTML Studio</span>
          </span>
        </a>
        <div className="topbar-middle">
          <div className="file-heading">
            <span className="document-name" title={name}>
              {name}
            </span>
            {state.source && (
              <span
                className="hb-source"
                title="这是 handbook-designer 导出的编辑包。下载修改后的 HTML 交回，即可写回手册源文件。"
              >
                基于构建 {state.source.build}
                {state.source.lang ? ` · ${state.source.lang}` : ""}
              </span>
            )}
            <span className="save-state">
              <span
                className={
                  saveStatus.includes("失败")
                    ? "status-dot failure"
                    : "status-dot"
                }
              />
              {saveStatus}
            </span>
          </div>
          <div className="history-tools">
            <ToolButton
              icon="undo"
              title="撤销 ⌘Z"
              onClick={() => command("history", "undo")}
              disabled={!state.undo || loading}
            />
            <ToolButton
              icon="redo"
              title="重做 ⇧⌘Z"
              onClick={() => command("history", "redo")}
              disabled={!state.redo || loading}
            />
          </div>
        </div>
        <div className="top-actions">
          <button
            className="button secondary"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" />
            导入文件
          </button>
          <button
            className="button primary"
            onClick={() => command("export")}
            disabled={loading}
          >
            <Icon name="download" />
            下载 HTML
          </button>
        </div>
      </header>

      <div className="workbench">
        <aside className="navigator">
          <div className="nav-tabs" role="tablist" aria-label="文档导航">
            <button
              role="tab"
              aria-selected={tab === "pages"}
              onClick={() => setTab("pages")}
              className={tab === "pages" ? "active" : ""}
            >
              页面 <span>{state.pages.length || "—"}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === "objects"}
              onClick={() => setTab("objects")}
              className={tab === "objects" ? "active" : ""}
            >
              本页对象
            </button>
            <button
              role="tab"
              aria-selected={tab === "background"}
              onClick={() => {
                setTab("background");
                command("select", null);
              }}
              className={tab === "background" ? "active" : ""}
            >
              底纹
            </button>
          </div>
          <div className="nav-scroll">
            {tab === "pages" ? (
              <ol className="page-list">
                {state.pages.map((p, i) => (
                  <li key={p.id}>
                    <button
                      className={`page-card ${i === state.page ? "selected" : ""}`}
                      onClick={() => command("page", i)}
                      aria-label={`第 ${i + 1} 页 ${p.title}`}
                      aria-current={i === state.page ? "page" : undefined}
                    >
                      <span
                        className="page-preview"
                        style={{
                          background:
                            p.color === "#ffffff" ? "#f7f9fc" : p.color,
                        }}
                      >
                        <span className="preview-corner" />
                        <span
                          className="preview-number"
                          style={{
                            color:
                              p.color !== "#ffffff" ? "#ffffff" : undefined,
                          }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      </span>
                      <span className="page-card-text">
                        <strong>{p.title}</strong>
                        <span>
                          {p.width} × {p.height}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : tab === "objects" ? (
              <div className="object-list">
                <label className="object-filter">
                  <span className="visually-hidden">筛选本页对象</span>
                  <select
                    aria-label="筛选本页对象"
                    value={objectFilter}
                    onChange={(event) => setObjectFilter(event.target.value)}
                  >
                    <option value="all">全部对象</option>
                    <option value="text">文字</option>
                    <option value="image">照片 / 图片</option>
                    <option value="graphic">暗纹 / SVG 图形</option>
                    <option value="shape">色块</option>
                  </select>
                </label>
                {state.objects
                  .filter(
                    (object) =>
                      objectFilter === "all" || object.kind === objectFilter,
                  )
                  .map((object) => (
                    <button
                      key={object.id}
                      className={selection?.id === object.id ? "active" : ""}
                      onClick={() => command("select", object.id)}
                    >
                      <Icon
                        name={
                          object.kind === "image" || object.kind === "graphic"
                            ? "image"
                            : "type"
                        }
                        size={15}
                      />
                      <span>{object.label}</span>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="background-library">
                <div className="background-intro">
                  <span className="background-kicker">PAGE BACKGROUNDS</span>
                  <h3>让留白有层次</h3>
                  <p>弥散渐变、几何与线纹，配色可跟随 HTML，也可以自由调整。</p>
                </div>
                <button
                  className="random-background-button"
                  onClick={() => applyBackground(createRandomBackground(activePaletteColors))}
                >
                  <span className="random-background-icon">
                    <Icon name="sparkles" size={18} />
                  </span>
                  <span className="random-background-copy">
                    <strong>随机生成</strong>
                    <small>每次都有新的渐变与构图</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
                <section className="palette-panel" aria-label="底纹配色">
                  <div className="palette-heading">
                    <div>
                      <strong>底纹配色</strong>
                      <small>随机生成与素材预览使用当前色板</small>
                    </div>
                    <button
                      className="palette-eyedropper"
                      type="button"
                      onClick={pickScreenColor}
                      aria-label="从屏幕取色"
                      title={`取色后替换第 ${activeSwatch + 1} 个颜色`}
                    >
                      <Icon name="eyedropper" size={15} />
                      取色
                    </button>
                  </div>
                  <label className="palette-select">
                    <span>配色来源</span>
                    <select
                      value={paletteMode === "document" ? "document" : paletteMode === "custom" ? "custom" : `classic-${paletteIndex}`}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "document") setPaletteMode("document");
                        else if (value === "custom") {
                          setCustomPalette(activePaletteColors);
                          setPaletteMode("custom");
                        } else {
                          setPaletteIndex(Number(value.slice("classic-".length)) || 0);
                          setPaletteMode("classic");
                        }
                      }}
                    >
                      <option value="document">
                        当前 HTML · {state.documentColors.length ? `${state.documentColors.length} 个候选色` : "使用默认色板"}
                      </option>
                      {classicPalettes.map((palette, index) => (
                        <option key={palette.id} value={`classic-${index}`}>{palette.label}</option>
                      ))}
                      <option value="custom">自定义色板</option>
                    </select>
                  </label>
                  {paletteMode === "document" && state.documentColors.length > 0 && (
                    <div className="palette-candidate-panel">
                      <div className="palette-candidate-heading">
                        <span>HTML 提取色 · 已选 {documentPaletteColors.length}/4</span>
                        <button type="button" onClick={autoSelectDocumentColors}>自动搭配</button>
                      </div>
                      <div className="palette-candidates" role="group" aria-label="从 HTML 提取的候选颜色中选择">
                        {state.documentColors.map((color) => {
                          const selected = documentPaletteColors.includes(color);
                          return (
                            <button
                              className={selected ? "palette-candidate selected" : "palette-candidate"}
                              key={color}
                              type="button"
                              style={{ backgroundColor: color }}
                              aria-label={`HTML 候选颜色 ${color}${selected ? "，已选" : ""}`}
                              aria-pressed={selected}
                              title={`${color.toUpperCase()}${selected ? " · 已选" : " · 点击选择"}`}
                              onClick={() => toggleDocumentColor(color)}
                            >
                              {selected && <Icon name="check" size={12} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="palette-swatches" role="group" aria-label="编辑色板颜色">
                    {activePaletteColors.map((color, index) => (
                      <label
                        className={activeSwatch === index ? "palette-swatch active" : "palette-swatch"}
                        key={`${index}-${color}`}
                        style={{ backgroundColor: color }}
                        title={`编辑颜色 ${index + 1}：${color}`}
                      >
                        <input
                          type="color"
                          aria-label={`编辑颜色 ${index + 1}`}
                          value={color}
                          onFocus={() => setActiveSwatch(index)}
                          onChange={(event) => changePaletteColor(index, event.target.value)}
                        />
                        <span>{color.toUpperCase()}</span>
                      </label>
                    ))}
                  </div>
                  <p className="palette-hint">
                    {paletteMode === "document" && state.documentColors.length
                      ? "自动搭配兼顾常用度与色差；换色时先取消一种已选色。"
                      : paletteMode === "document"
                        ? "尚未找到明显的彩色样式，当前用蒙德里安色板补足。"
                        : "点击任意色块编辑；取色按钮可拾取屏幕上的颜色。"}
                  </p>
                  <p className="palette-hint">
                    弥散渐变 {paletteColorCount("弥散")} 色 · 线纹/流线 {paletteColorCount("线纹")} 色 · 几何 {paletteColorCount("几何")} 色
                  </p>
                </section>
                <div className="background-scope">
                  <span>应用范围</span>
                  <div role="group" aria-label="底纹应用范围">
                    <button
                      className={backgroundScope === "page" ? "active" : ""}
                      aria-pressed={backgroundScope === "page"}
                      onClick={() => setBackgroundScope("page")}
                    >
                      当前页
                    </button>
                    <button
                      className={backgroundScope === "all" ? "active" : ""}
                      aria-pressed={backgroundScope === "all"}
                      onClick={() => setBackgroundScope("all")}
                    >
                      全部页
                    </button>
                  </div>
                </div>
                <div className="background-library-title">
                  <span>灵感素材</span>
                  <span>{backgroundPresets.length} 款</span>
                </div>
                <div className="background-grid">
                  {backgroundPresets.map((background) => (
                    <button
                      key={background.id}
                      className={
                        state.background?.id === background.id
                          ? "background-card active"
                          : "background-card"
                      }
                      onClick={() => applyBackground({
                        ...background,
                        src: recolorBackgroundSource(background.src, activePaletteColors, paletteColorCount(background.family)),
                      })}
                      aria-label={`应用底纹：${background.label}`}
                      aria-pressed={state.background?.id === background.id}
                    >
                      <span
                        className="background-card-art"
                        style={{
                          backgroundImage: `url("${recolorBackgroundSource(background.src, activePaletteColors, paletteColorCount(background.family))}")`,
                        }}
                      />
                      <span className="background-card-name">
                        <strong>{background.label}</strong>
                        <small>{background.family}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="button secondary full-width background-upload"
                  onClick={() => backgroundInput.current?.click()}
                >
                  <Icon name="upload" size={15} />
                  添加本地图片
                </button>
                <p className="background-footnote">
                  PNG、JPG、WebP 或 GIF · 最大 14 MB
                </p>
              </div>
            )}
          </div>
          <div className="nav-bottom">
            <div className="local-note">
              <Icon name="check" size={15} />
              <span>文件只在你的浏览器中处理</span>
            </div>
            <button className="text-button" onClick={() => setHelp(true)}>
              <Icon name="help" size={16} />
              使用说明
            </button>
          </div>
        </aside>

        <main className="canvas-area" ref={canvasArea}>
          <div className="canvas-toolbar">
            <div className="current-page">
              <span className="blue-square" />第 {state.page + 1} 页{" "}
              <span className="page-total">/ {state.pages.length || "—"}</span>
            </div>
            <div className="canvas-tools">
              <ToolButton
                icon="minus"
                title="缩小"
                onClick={() => setZoom(Math.max(0.2, scale - 0.1))}
              />
              <button
                className="zoom-button"
                onClick={() => setZoom(null)}
                title="点击适合宽度"
              >
                {Math.round(scale * 100)}%
              </button>
              <ToolButton
                icon="plus"
                title="放大"
                onClick={() => setZoom(Math.min(1.5, scale + 0.1))}
              />
              <span className="toolbar-divider" />
              <ToolButton
                icon="grid"
                title={gridTitle}
                active={grid?.visible}
                disabled={loading || !grid}
                onClick={() => command("grid", !(grid?.visible ?? true))}
              />
              <ToolButton
                icon="print"
                title="打印 / 另存为 PDF"
                onClick={() => {
                  setNotice(
                    "打印窗口中选择“另存为 PDF”，开启背景图形并关闭浏览器页眉页脚。",
                  );
                  command("print");
                }}
              />
            </div>
          </div>
          {draft && (
            <div className="resume-banner">
              <span>
                此浏览器有上次保存的文档：<strong>{draft.name}</strong>
              </span>
              <button onClick={() => openDocument(draft.html, draft.name)}>
                继续编辑 <Icon name="arrow" size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="关闭恢复提示"
                onClick={() => setDraft(undefined)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {(notice || error) && (
            <div
              role={error ? "alert" : "status"}
              className={`notice ${error ? "error" : ""}`}
            >
              <span>{error || notice}</span>
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          <div className="workspace" ref={workspace}>
            <div className="canvas-caption">
              <span>
                {loading
                  ? "正在准备文档…"
                  : "点选对象，拖动调整；双击文字直接编辑"}
              </span>
              <span>
                {page
                  ? `${Math.round((page.width / 96) * 25.4)} × ${Math.round((page.height / 96) * 25.4)} mm`
                  : "A4"}
              </span>
            </div>
            <div
              className="paper-wrap"
              ref={paperWrap}
              style={{ width: currentW * scale, height: currentH * scale }}
              aria-busy={loading}
            >
              <iframe
                key={frameRevision}
                ref={frame}
                title="手册编辑画布"
                className="document-frame"
                sandbox="allow-scripts allow-modals"
                referrerPolicy="no-referrer"
                srcDoc={frameHtml}
                style={{
                  width: currentW,
                  height: currentH,
                  transform: `scale(${scale})`,
                }}
              />
              {loading && (
                <div className="loading-cover">
                  <span className="spinner" />
                  正在载入页面与字体
                </div>
              )}
            </div>
            <div className="canvas-footer">
              <button
                disabled={state.page === 0 || loading}
                onClick={() => command("page", state.page - 1)}
              >
                <span className="previous">
                  <Icon name="chevron" size={14} />
                </span>
                上一页
              </button>
              <span>
                {state.page + 1} / {state.pages.length || "—"}
              </span>
              <button
                disabled={state.page >= state.pages.length - 1 || loading}
                onClick={() => command("page", state.page + 1)}
              >
                下一页
                <Icon name="chevron" size={14} />
              </button>
            </div>
          </div>
          {showFloatingToolbar && selection && (
            <div
              ref={floatingToolbar}
              className="floating-typebar"
              role="toolbar"
              aria-label="快速文字排版"
              style={{
                left: floatingPosition?.left ?? 8,
                top: floatingPosition?.top ?? 8,
                visibility: floatingPosition ? "visible" : "hidden",
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <FontPicker
                compact
                selection={selection}
                fonts={state.documentFonts}
                loading={fontLoading}
                onDocument={(family) => patch({ "font-family": family })}
                onLibrary={(id) => void chooseFont(id)}
                onRestore={() => command("restoreFont", { scope: batchScope })}
              />
              <NumberField
                className="quick-number quick-size"
                label="字号"
                value={selection.fontSize}
                min={6}
                onChange={(size) => patch({ "font-size": `${size}px` })}
              />
              <NumberField
                className="quick-number quick-weight"
                label="字重"
                value={selection.fontWeight}
                min={100}
                max={900}
                step={100}
                unit=""
                onChange={(weight) =>
                  patch({
                    "font-weight": String(
                      Math.max(100, Math.min(900, Math.round(weight / 100) * 100)),
                    ),
                  })
                }
              />
              <label className="quick-color" title="文字颜色">
                <input
                  type="color"
                  aria-label="文字颜色"
                  value={selection.color}
                  onChange={(event) => patch({ color: event.target.value })}
                />
                <span style={{ backgroundColor: selection.color }} />
              </label>
              <span className="quick-divider" />
              <button
                className={`quick-format-button${selection.bold ? " active" : ""}`}
                aria-label="加粗"
                aria-pressed={selection.bold}
                title="加粗"
                onClick={() => patch({ "font-weight": selection.bold ? "400" : "700" })}
              >
                B
              </button>
              <button
                className={`quick-format-button italic${selection.italic ? " active" : ""}`}
                aria-label="斜体"
                aria-pressed={selection.italic}
                title="斜体"
                onClick={() => patch({ "font-style": selection.italic ? "normal" : "italic" })}
              >
                I
              </button>
              <button
                className={`quick-format-button underline${selection.underline ? " active" : ""}`}
                aria-label="下划线"
                aria-pressed={selection.underline}
                title="下划线"
                onClick={() => patch({ "text-decoration-line": selection.underline ? "none" : "underline" })}
              >
                U
              </button>
              <span className="quick-divider" />
              <div className="quick-align" aria-label="文字对齐">
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    className={selection.align === align || (selection.align === "start" && align === "left") ? "active" : ""}
                    aria-label={align === "left" ? "左对齐" : align === "center" ? "居中对齐" : "右对齐"}
                    aria-pressed={selection.align === align || (selection.align === "start" && align === "left")}
                    title={align === "left" ? "左对齐" : align === "center" ? "居中对齐" : "右对齐"}
                    onClick={() => patch({ "text-align": align, "text-align-last": "auto" })}
                  >
                    <Icon name={`align-${align}`} size={14} />
                  </button>
                ))}
              </div>
              <span className="quick-divider" />
              <select
                className="quick-apply-scope"
                aria-label="套用排版范围"
                value={activeTypographyScope?.id || ""}
                disabled={!typographyScopes.length}
                onChange={(event) => setQuickApplyScope(event.target.value)}
              >
                {typographyScopes.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scope.label} · {scope.count}
                  </option>
                ))}
                {!typographyScopes.length && <option value="">无其他同类</option>}
              </select>
              <button
                className="quick-apply-button"
                disabled={!activeTypographyScope}
                title={activeTypographyScope ? `将当前排版套用到 ${activeTypographyScope.count} 个对象` : "没有其他匹配对象"}
                onClick={() =>
                  activeTypographyScope &&
                  applyTypographyToScope(selection, activeTypographyScope.id)
                }
              >
                套用
              </button>
            </div>
          )}
          <footer className="statusbar">
            <span>
              <Icon name="cursor" size={13} />{" "}
              {selection
                ? `已选中：${selection.label.slice(0, 22)}`
                : "选择一个对象开始编辑"}
            </span>
            <span className={state.warnings ? "warning-status" : ""}>
              {state.warnings
                ? `${state.warnings} 个对象可能超出页面，请检查`
                : grid
                  ? grid.visible
                    ? grid.columns
                      ? `拖动吸附到 ${gridLabel} 与对象边缘 · Alt 自由移动`
                      : `拖动吸附到${gridLabel}与对象边缘 · Alt 自由移动`
                    : "对象对齐吸附开启 · Alt 自由移动"
                  : "按住 Alt 拖动可关闭网格吸附"}
            </span>
          </footer>
        </main>

        <aside className="inspector">
          <div className="inspector-title">
            <Icon name="settings" size={17} />
            <h2>{tab === "background" ? "页面底纹" : "编辑属性"}</h2>
            <span>
              {tab === "background"
                ? `第 ${state.page + 1} 页`
                : selection
                ? selection.image
                  ? "图片"
                  : selection.tag === "svg"
                    ? "图形"
                    : "文字 / 对象"
                : "未选择"}
            </span>
          </div>
          <div className="inspector-scroll">
            {tab === "background" ? (
              <BackgroundControls
                background={state.background}
                onUpdate={updateBackground}
                onBegin={() => command("beginBackground")}
                onEnd={() => command("endBackground")}
              />
            ) : selection ? (
              <>
                <section className="inspector-section selected-summary">
                  <span className="object-kind">
                    <Icon name={selection.image ? "image" : "type"} size={17} />
                    {selection.image ? "所选图片" : "所选对象"}
                  </span>
                  <p>{selection.label}</p>
                  {state.source && untraceable(selection).length > 0 && (
                    <p className="hb-untraceable" role="note">
                      {untraceable(selection).join("；")}
                      ：这些修改只保存在当前 HTML 里，写回手册源文件时会被列为“未写回”。
                    </p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => command("reset")}
                  >
                    <Icon name="reset" size={14} />
                    清除此对象的局部调整
                  </button>
                </section>
                <section className="inspector-section batch-section">
                  <h3>应用范围</h3>
                  <label className="select-field">
                    <span className="visually-hidden">样式应用范围</span>
                    <select
                      aria-label="样式应用范围"
                      value={batchScope}
                      onChange={(event) => setBatchScope(event.target.value)}
                    >
                      {selection.scopes.map((scope) => (
                        <option key={scope.id} value={scope.id}>
                          {scope.label}（{scope.count} 处）
                        </option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const scope = selection.scopes.find(
                      (item) => item.id === batchScope,
                    );
                    return (
                      scope && (
                        <div className="scope-detail">
                          <strong>
                            {scope.count} 个对象 · {scope.pages.length} 页
                          </strong>
                          <span>页码：{scope.pages.join("、")}</span>
                          {batchScope !== "single" && (
                            <>
                              <span>
                                {selection.kind === "graphic"
                                  ? "颜色、透明度、母形缩放和旋转会统一应用；页面框的位置和尺寸仍只改当前对象。"
                                  : "接下来的字体、字号、颜色等样式修改会统一应用；位置与尺寸仍只改当前对象。"}
                              </span>
                              <details>
                                <summary>查看匹配样式与示例</summary>
                                <code>{selection.styleLabel}</code>
                                {scope.examples.map((example, i) => (
                                  <span key={i}>{example}</span>
                                ))}
                              </details>
                            </>
                          )}
                        </div>
                      )
                    );
                  })()}
                </section>
                <section className="inspector-section">
                  <h3>位置与尺寸</h3>
                  <div className="field-grid">
                    <NumberField
                      label="X"
                      value={selection.x}
                      onChange={(x) => command("patch", { x })}
                    />
                    <NumberField
                      label="Y"
                      value={selection.y}
                      onChange={(y) => command("patch", { y })}
                    />
                    <NumberField
                      label="宽"
                      value={selection.width}
                      min={20}
                      onChange={(width) =>
                        patch({
                          width: `${width}px`,
                          "max-width": "none",
                          "box-sizing": "border-box",
                        })
                      }
                    />
                    <NumberField
                      label="高"
                      value={selection.height}
                      min={16}
                      onChange={(height) =>
                        patch({
                          height: `${height}px`,
                          "box-sizing": "border-box",
                        })
                      }
                    />
                  </div>
                  <p className="field-hint">
                    拖动对象移动，右下角手柄调整大小。
                  </p>
                </section>
                {selection.kind === "graphic" && selection.graphic ? (
                  <section className="inspector-section graphic-panel">
                    <h3>{selection.graphic.brand ? "品牌暗纹" : "矢量图形"}</h3>
                    <label className="range-field">
                      <span>
                        透明度 <strong>{selection.graphic.opacity}%</strong>
                      </span>
                      <input
                        aria-label="图形透明度"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={selection.graphic.opacity}
                        onPointerDown={() => command("beginGraphic")}
                        onPointerUp={() => command("endGraphic")}
                        onPointerCancel={() => command("endGraphic")}
                        onChange={(event) =>
                          command("graphic", {
                            styles: {
                              opacity: String(Number(event.target.value) / 100),
                            },
                            scope: batchScope,
                          })
                        }
                      />
                    </label>
                    <div className="field-grid">
                      <NumberField
                        label="缩放"
                        unit="%"
                        value={selection.graphic.scale}
                        min={5}
                        onChange={(scale) =>
                          command("graphic", { scale, scope: batchScope })
                        }
                      />
                      <NumberField
                        label="旋转"
                        unit="°"
                        value={selection.graphic.rotation}
                        onChange={(rotation) =>
                          command("graphic", { rotation, scope: batchScope })
                        }
                      />
                    </div>
                    <label className="color-row">
                      <span>
                        {selection.graphic.brand ? "暗纹颜色" : "图形颜色"}
                      </span>
                      <input
                        type="color"
                        aria-label="图形颜色"
                        value={selection.graphic.color}
                        onChange={(event) =>
                          command("graphic", {
                            styles: { color: event.target.value },
                            scope: batchScope,
                          })
                        }
                      />
                    </label>
                    <button
                      className="button secondary full-width"
                      onClick={() => svgInput.current?.click()}
                    >
                      <Icon name="image" />
                      {selection.graphic.brand
                        ? "替换暗纹 SVG 母形"
                        : "替换 SVG 图形"}
                    </button>
                    <p className="field-hint">
                      {selection.graphic.brand
                        ? "调整的是暗纹母形，保留原有纸面框、遮罩与裁切。替换母形仅作用于当前对象。"
                        : "支持整体位置、大小、旋转和颜色。替换图形仅作用于当前对象。"}
                    </p>
                  </section>
                ) : selection.image ? (
                  <section className="inspector-section">
                    <h3>图片</h3>
                    <button
                      className="button secondary full-width"
                      onClick={() => imageInput.current?.click()}
                    >
                      <Icon name="image" />
                      替换图片
                    </button>
                    <label className="select-field">
                      填充方式
                      <select
                        defaultValue="cover"
                        key={selection.id}
                        onChange={(e) =>
                          patch({
                            "object-fit": e.target.value,
                            "background-size": e.target.value,
                          })
                        }
                      >
                        <option value="cover">铺满并裁切</option>
                        <option value="contain">完整显示</option>
                      </select>
                    </label>
                    <div className="image-position">
                      <span>裁切位置</span>
                      <div>
                        {[
                          ["左上", "left top"],
                          ["上", "center top"],
                          ["右上", "right top"],
                          ["左", "left center"],
                          ["居中", "center center"],
                          ["右", "right center"],
                          ["左下", "left bottom"],
                          ["下", "center bottom"],
                          ["右下", "right bottom"],
                        ].map(([label, position]) => (
                          <button
                            key={position}
                            title={label}
                            aria-label={`图片${label}`}
                            onClick={() =>
                              patch({
                                "object-position": position,
                                "background-position": position,
                              })
                            }
                          >
                            <span />
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                ) : (
                  selection.kind === "text" && (
                    <section className="inspector-section">
                      <h3>文字排版</h3>
                      <button
                        className="button secondary full-width"
                        onClick={() => command("editText")}
                      >
                        <Icon name="type" />
                        编辑文字
                      </button>
                      <FontPicker
                        selection={selection}
                        fonts={state.documentFonts}
                        loading={fontLoading}
                        onDocument={(family) =>
                          patch({ "font-family": family })
                        }
                        onLibrary={(id) => void chooseFont(id)}
                        onRestore={() =>
                          command("restoreFont", { scope: batchScope })
                        }
                      />
                      <div className="field-grid">
                        <NumberField
                          label="字号"
                          value={selection.fontSize}
                          min={6}
                          onChange={(size) =>
                            patch({ "font-size": `${size}px` })
                          }
                        />
                        <NumberField
                          label="行距"
                          value={selection.lineHeight}
                          min={6}
                          onChange={(height) =>
                            patch({ "line-height": `${height}px` })
                          }
                        />
                      </div>
                      <div className="type-extra field-grid">
                        <NumberField
                          label="字距"
                          value={selection.letterSpacing}
                          step={0.1}
                          onChange={(spacing) =>
                            patch({ "letter-spacing": `${spacing}px` })
                          }
                        />
                        <NumberField
                          label="字重"
                          value={selection.fontWeight}
                          min={100}
                          max={900}
                          step={100}
                          unit=""
                          onChange={(weight) =>
                            patch({
                              "font-weight": String(
                                Math.max(100, Math.min(900, Math.round(weight / 100) * 100)),
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="type-controls">
                        <button
                          className={
                            selection.bold
                              ? "bold-button active"
                              : "bold-button"
                          }
                          title="加粗"
                          aria-label="加粗"
                          aria-pressed={selection.bold}
                          onClick={() =>
                            patch({
                              "font-weight": selection.bold ? "400" : "700",
                            })
                          }
                        >
                          B
                        </button>
                        <div className="alignment-tools">
                          {(
                            ["left", "center", "right", "justify"] as const
                          ).map((align) => (
                            <button
                              className={
                                selection.align === align ||
                                (selection.align === "start" &&
                                  align === "left")
                                  ? "active"
                                  : ""
                              }
                              key={align}
                              aria-label={
                                align === "left"
                                  ? "左对齐"
                                  : align === "center"
                                    ? "居中对齐"
                                    : align === "right"
                                      ? "右对齐"
                                      : "两端对齐"
                              }
                              aria-pressed={
                                selection.align === align ||
                                (selection.align === "start" &&
                                  align === "left")
                              }
                              title={
                                align === "justify"
                                  ? "两端对齐 · 末行自然对齐"
                                  : undefined
                              }
                              onClick={() =>
                                patch({
                                  "text-align": align,
                                  "text-align-last": "auto",
                                })
                              }
                            >
                              <Icon name={`align-${align}`} />
                            </button>
                          ))}
                        </div>
                        <label className="color-field" title="文字颜色">
                          <input
                            type="color"
                            aria-label="文字颜色"
                            value={selection.color}
                            onChange={(e) => patch({ color: e.target.value })}
                          />
                          <span>{selection.color.toUpperCase()}</span>
                        </label>
                      </div>
                      <div className="typography-batch">
                        <div className="typography-batch-heading">
                          <strong>排版调好后，套用到同类文字</strong>
                          <span>仅同步文字样式</span>
                        </div>
                        <div className="typography-batch-actions">
                          {[
                            ["page-style", "本页同类"],
                            ["book-style", "全册同类"],
                            ...( /^H[1-6]$/.test(selection.tag.toUpperCase())
                              ? [["book-heading", "全册同级标题"]]
                              : []),
                          ].map(([scopeId, label]) => {
                            const scope = selection.scopes.find(
                              (item) => item.id === scopeId,
                            );
                            if (!scope) return null;
                            return (
                              <button
                                className="button secondary"
                                key={scopeId}
                                disabled={scope.count < 2}
                                title={
                                  scope.count < 2
                                    ? "没有其他匹配对象"
                                    : `应用到 ${scope.count} 个对象`
                                }
                                onClick={() =>
                                  applyTypographyToScope(selection, scopeId)
                                }
                              >
                                {label} · {scope.count}
                              </button>
                            );
                          })}
                        </div>
                        <p>同步字体、字号、字重、斜体、下划线、行距、字距、颜色和对齐。</p>
                      </div>
                      <label className="select-field">
                        <span>断行优化</span>
                        <select
                          aria-label="断行优化"
                          value={selection.wrap}
                          onChange={(e) =>
                            patch({ "text-wrap": e.target.value })
                          }
                        >
                          <option value="auto">自动断行 · auto</option>
                          <option
                            value="pretty"
                            disabled={!selection.wrapSupport.pretty}
                          >
                            优化段落断行 · pretty
                          </option>
                          <option
                            value="balance"
                            disabled={!selection.wrapSupport.balance}
                          >
                            平衡各行长度 · balance
                          </option>
                          {!["auto", "pretty", "balance"].includes(
                            selection.wrap,
                          ) && (
                            <option value={selection.wrap}>
                              原稿设置 · {selection.wrap}
                            </option>
                          )}
                        </select>
                      </label>
                      <p className="field-hint">
                        pretty 改善段落断行；balance
                        适合短标题。可与对齐方式搭配，效果依浏览器而异。
                        {!selection.wrapSupport.pretty &&
                          "当前浏览器不支持 pretty。"}
                      </p>
                    </section>
                  )
                )}
                <section className="inspector-section">
                  <h3>纸面与色块</h3>
                  <label className="color-row">
                    <span>对象背景</span>
                    <input
                      type="color"
                      aria-label="对象背景"
                      value={selection.background}
                      onChange={(e) =>
                        patch({ "background-color": e.target.value })
                      }
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => patch({ "background-color": "transparent" })}
                  >
                    清除背景色
                  </button>
                </section>
              </>
            ) : (
              <>
                <div className="empty-selection">
                  <div className="selection-illustration">
                    <span className="mini-text">Aa</span>
                    <span className="selection-cursor">
                      <Icon name="cursor" size={23} />
                    </span>
                  </div>
                  <h3>让每一页更合心意</h3>
                  <p>
                    点选画布中的文字或图片，
                    <br />
                    在这里调整位置、大小与样式。
                  </p>
                </div>
                <section className="inspector-section quick-guide">
                  <h3>从这里开始</h3>
                  <div>
                    <span>
                      <Icon name="cursor" size={16} />
                    </span>
                    <p>
                      <strong>点一下，拖动调整</strong>
                      选中文字块或图片，自由移动。
                    </p>
                  </div>
                  <div>
                    <span>
                      <Icon name="type" size={16} />
                    </span>
                    <p>
                      <strong>双击，直接改字</strong>保留文档自己的字体和风格。
                    </p>
                  </div>
                  <div>
                    <span>
                      <Icon name="download" size={16} />
                    </span>
                    <p>
                      <strong>下载，继续使用</strong>保存为 HTML，或打印成 PDF。
                    </p>
                  </div>
                </section>
                <section className="import-box">
                  <h3>打开你的手册</h3>
                  <p>拖入 HTML，或带图片和字体的 ZIP。</p>
                  <button
                    className="button secondary full-width"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" size={16} />
                    选择文件
                  </button>
                </section>
              </>
            )}
          </div>
          <div className="inspector-bottom">
            <span>Folio HTML Studio</span>
            <span>早期版本 0.2</span>
          </div>
        </aside>
      </div>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".html,.htm,.zip"
        aria-label="选择 HTML 或 ZIP"
        onChange={(e) => {
          void handleImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={svgInput}
        className="visually-hidden"
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="选择替换 SVG"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void file
              .text()
              .then((text) => command("replaceSvg", text))
              .catch(() => setError("无法读取这个 SVG 文件。"));
          event.target.value = "";
        }}
      />
      <input
        ref={imageInput}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        aria-label="选择替换图片"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => command("image", reader.result);
            reader.readAsDataURL(file);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={backgroundInput}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="选择页面底纹图片"
        onChange={(event) => {
          handleBackgroundImport(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {draggingFile && (
        <div className="file-drop">
          <div>
            <Icon name="upload" size={40} />
            <h2>放开，打开你的文档</h2>
            <p>支持 HTML 和包含资源的 ZIP</p>
          </div>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="关闭说明"
              onClick={() => setHelp(false)}
              autoFocus
            >
              <Icon name="close" />
            </button>
            <span className="help-wordmark">Folio</span>
            <h2 id="help-title">在浏览器里，完成最后一轮排版。</h2>
            <p>
              导入单文件 HTML，或把 HTML、图片和字体一起打包为 ZIP。优先支持带有{" "}
              <code>.page</code> 分页的手册；普通网页会作为一个长画布打开。
            </p>
            <ul>
              <li>
                编辑时会从文档提取布局网格，并显示列线与页边距。拖动、缩放会吸附到网格和附近对象的边缘、中线，出现对齐线；按住 Alt 可临时自由移动。
              </li>
              <li>
                双击文字直接修改，点击画布外或按 Esc
                结束。大幅加字后请检查周围内容。
              </li>
              <li>
                在“底纹”中选择渐变、波纹或几何素材，也可以随机生成或添加自己的图片；透明度和应用范围都可调整。
              </li>
              <li>
                ⌘ / Ctrl + Z 撤销，Shift + ⌘ / Ctrl + Z 重做，⌘ / Ctrl + S 下载
                HTML。
              </li>
              <li>
                修改会自动保存在此浏览器。下载 HTML 是可移交、可重新导入的文件。
              </li>
              <li>
                PDF 使用浏览器打印：选择另存为 PDF，开启背景图形，关闭页眉页脚。
              </li>
            </ul>
            <p className="help-footnote">
              文件在本机处理；文档引用的远程图片和字体仍可能联网加载。当前保存的是
              HTML，不会自动同步回 book.yaml。
            </p>
            <button className="button primary" onClick={() => setHelp(false)}>
              开始编辑
              <Icon name="arrow" size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
