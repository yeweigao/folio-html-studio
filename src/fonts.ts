import catalog from "./font-catalog.json";

export const printFonts = catalog;
export type PrintFont = (typeof catalog)[number];
const loaded = new Map<string, Promise<string>>();
function asData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function resource(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("字体资源加载失败，请检查网络后再试。");
  return response;
}
export function fontCss(font: PrintFont): Promise<string> {
  if (!loaded.has(font.id))
    loaded.set(
      font.id,
      (async () => {
        const license = await (await resource(font.licensePath)).text();
        const faces = await Promise.all(
          font.files.map(async (file) => {
            const data = await asData(await (await resource(file.path)).blob());
            return `@font-face{font-family:"${font.family}";src:url("${data}") format("woff2");font-style:normal;font-weight:${file.weight};font-display:block;}`;
          }),
        );
        return `/* Folio static print build derived from ${font.name}. ${font.sourceUrl}\n${license.replace(/\*\//g, "* /")}\n*/\n${faces.join("\n")}`;
      })().catch((error) => {
        loaded.delete(font.id);
        throw error;
      }),
    );
  return loaded.get(font.id)!;
}
