import { printFonts } from "./fonts";
import type { Selection, EditorState } from "./types";

const primary = (family: string) =>
  family
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
export default function FontPicker({
  selection,
  fonts,
  loading,
  onDocument,
  onLibrary,
  onRestore,
  compact = false,
}: {
  selection: Selection;
  fonts: EditorState["documentFonts"];
  loading: string;
  onDocument: (family: string) => void;
  onLibrary: (id: string) => void;
  onRestore: () => void;
  compact?: boolean;
}) {
  const current = primary(selection.fontFamily);
  const library = printFonts.find((font) => primary(font.family) === current);
  const own = fonts.find((font) => primary(font.family) === current);
  const value = library
    ? `library:${library.id}`
    : own
      ? `document:${own.family}`
      : `current:${selection.fontFamily}`;
  const select = (
    <select
      aria-label="字体"
      value={value}
      disabled={!!loading}
      onChange={(event) => {
        const [type, ...rest] = event.target.value.split(":");
        if (type === "library") onLibrary(rest.join(":"));
        else onDocument(rest.join(":"));
      }}
    >
      {!library && !own && (
        <option value={value}>{selection.fontFamily.split(",")[0]}</option>
      )}
      <optgroup label="文档自带字体">
        {fonts
          .filter(
            (font) =>
              !printFonts.some(
                (known) => primary(known.family) === primary(font.family),
              ),
          )
          .map((font) => (
            <option key={font.family} value={`document:${font.family}`}>
              {font.family.split(",")[0].replace(/["']/g, "")}
              {font.embedded ? " · 已嵌入" : ""}
            </option>
          ))}
      </optgroup>
      {["英文 · 无衬线", "英文 · 衬线", "中文"].map((category) => (
        <optgroup key={category} label={`印刷字体库 / ${category}`}>
          {printFonts
            .filter((font) => font.category === category)
            .map((font) => (
              <option key={font.id} value={`library:${font.id}`}>
                {font.name}
              </option>
            ))}
        </optgroup>
      ))}
      <optgroup label="系统字体（依赖接收方电脑）">
        <option value="system:Arial, Helvetica, sans-serif">Arial</option>
        <option value="system:Georgia, serif">Georgia</option>
        <option value="system:'Times New Roman', serif">
          Times New Roman
        </option>
        <option value="system:system-ui, sans-serif">系统无衬线</option>
        <option value="system:'Songti SC', SimSun, serif">宋体</option>
        <option value="system:'PingFang SC', 'Microsoft YaHei', sans-serif">
          苹方 / 微软雅黑
        </option>
      </optgroup>
    </select>
  );

  if (compact)
    return (
      <div className="font-picker-compact" title={loading ? `正在加载 ${loading}` : "字体"}>
        {select}
      </div>
    );

  return (
    <div className="font-picker">
      <label className="select-field">
        字体
        {select}
      </label>
      <div className="font-original">
        <span title={selection.originalFont}>
          原字体：{selection.originalFont.split(",")[0].replace(/["']/g, "")}
        </span>
        <button
          className="text-button"
          onClick={onRestore}
          disabled={!!loading}
        >
          恢复原字体
        </button>
      </div>
      {loading ? (
        <p className="font-note" role="status">
          正在加载 {loading}…
        </p>
      ) : library ? (
        <p className="font-note">
          {library.use}
          <br />
          <span>免费商用 · 随 HTML 嵌入 · </span>
          <a href={library.licensePath} target="_blank" rel="noreferrer">
            查看开源授权
          </a>
        </p>
      ) : (
        <p className="font-note">
          文档自带字体始终保留在菜单中。选择印刷字体库可随文件嵌入完整字库。
        </p>
      )}
    </div>
  );
}
