import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icons";
import type { IconName } from "./Icons";
import type { EditorState, Selection } from "./types";
import { prepareDocument, downloadHtml } from "./document";
import { importFile } from "./importer";
import sampleHtml from "./sample.html?raw";
import { loadDraft, saveDraft } from "./storage";
import type { Draft } from "./storage";
import FontPicker from "./FontPicker";
import { printFonts, fontCss } from "./fonts";

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
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      aria-label={title}
      title={title}
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
  step = 1,
  unit = "px",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  unit?: string;
}) {
  const [text, setText] = useState(String(Math.round(value * 10) / 10));
  useEffect(() => setText(String(Math.round(value * 10) / 10)), [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={() => {
          const number = Number(text);
          if (text.trim() && Number.isFinite(number))
            onChange(min === undefined ? number : Math.max(min, number));
          else setText(String(value));
        }}
      />
      <span className="unit">{unit}</span>
    </label>
  );
}

export default function App() {
  const channel = useRef(crypto.randomUUID());
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);
  const selectedId = useRef<string | undefined>(undefined);
  const documentVersion = useRef(0);
  const workspace = useRef<HTMLDivElement>(null);
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
  const [tab, setTab] = useState<"pages" | "objects">("pages");
  const [batchScope, setBatchScope] = useState("single");
  const [objectFilter, setObjectFilter] = useState("all");
  const [fontLoading, setFontLoading] = useState("");
  useEffect(() => {
    selectedId.current = state.selection?.id;
    setBatchScope("single");
  }, [state.selection?.id]);

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
        <div className="top-actions">
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
            ) : (
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

        <main className="canvas-area">
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
                : "按住 Alt 拖动可关闭网格吸附"}
            </span>
          </footer>
        </main>

        <aside className="inspector">
          <div className="inspector-title">
            <Icon name="settings" size={17} />
            <h2>编辑属性</h2>
            <span>
              {selection
                ? selection.image
                  ? "图片"
                  : selection.tag === "svg"
                    ? "图形"
                    : "文字 / 对象"
                : "未选择"}
            </span>
          </div>
          <div className="inspector-scroll">
            {selection ? (
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
                      <div className="type-extra">
                        <NumberField
                          label="字距"
                          value={selection.letterSpacing}
                          step={0.1}
                          onChange={(spacing) =>
                            patch({ "letter-spacing": `${spacing}px` })
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
                点选后拖动移动，右下角手柄调整尺寸。默认按 4 px 吸附，Alt
                可临时关闭。
              </li>
              <li>
                双击文字直接修改，点击画布外或按 Esc
                结束。大幅加字后请检查周围内容。
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
