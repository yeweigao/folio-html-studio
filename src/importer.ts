import { unzipSync } from "fflate";

const MAX_FILE = 60 * 1024 * 1024;
const mime: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  css: "text/css",
  js: "text/javascript",
};
const decoder = new TextDecoder();
const external = (url: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url);
function resolvePath(url: string, from: string) {
  const path = decodeURIComponent(url.split(/[?#]/)[0]);
  const parts = (
    path.startsWith("/")
      ? path.slice(1)
      : `${from.slice(0, from.lastIndexOf("/") + 1)}${path}`
  ).split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}
function asData(bytes: Uint8Array, name: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime[name.split(".").pop()!.toLowerCase()] || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function importFile(
  file: File,
): Promise<{ html: string; name: string; notices: string[] }> {
  if (file.size > MAX_FILE)
    throw new Error(
      "文件超过 60 MB，请先减少未使用的图片，或导入单文件 HTML。",
    );
  if (!/\.(html?|zip)$/i.test(file.name))
    throw new Error("请选择 HTML 或 ZIP 文件。");
  if (!/\.zip$/i.test(file.name)) {
    const html = await file.text();
    if (!/<(?:html|body|div|main|section|article|h1|p)\b/i.test(html))
      throw new Error("文件中没有找到可编辑的 HTML 内容。");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const localImages = [...doc.querySelectorAll("img[src],link[href]")].filter(
      (el) =>
        !external(el.getAttribute("src") || el.getAttribute("href") || ""),
    );
    return {
      html,
      name: file.name,
      notices: localImages.length
        ? [
            "这个 HTML 引用了外部文件。如果图片或字体缺失，请导入包含资源的 ZIP。",
          ]
        : [],
    };
  }

  const input = new Uint8Array(await file.arrayBuffer());
  let total = 0,
    count = 0;
  const files = unzipSync(input, {
    filter: (entry) => {
      total += entry.originalSize;
      count++;
      if (total > 180 * 1024 * 1024 || count > 3000)
        throw new Error(
          "ZIP 解压后的资源过多，请只保留需要的 HTML、图片和字体。",
        );
      return !entry.name.startsWith("__MACOSX/") && !entry.name.includes("/.");
    },
  });
  const names = Object.keys(files)
    .filter((name) => /\.html?$/i.test(name))
    .sort((a, b) => {
      const score = (name: string) =>
        (/(^|\/)book\.html$/i.test(name)
          ? -20
          : /(^|\/)index\.html$/i.test(name)
            ? -10
            : 0) + name.split("/").length;
      return score(a) - score(b);
    });
  if (!names.length) throw new Error("ZIP 中没有找到 HTML 文件。");
  const main = names[0],
    doc = new DOMParser().parseFromString(
      decoder.decode(files[main]),
      "text/html",
    );
  const missing = new Set<string>();
  const cache = new Map<string, string>();
  const resource = (url: string, from: string): string => {
    if (!url || external(url)) return url;
    let path: string;
    try {
      path = resolvePath(url, from);
    } catch {
      missing.add(url);
      return url;
    }
    if (!files[path]) {
      missing.add(path);
      return url;
    }
    if (!cache.has(path)) cache.set(path, asData(files[path], path));
    return cache.get(path)!;
  };
  const css = (
    text: string,
    from: string,
    seen = new Set<string>(),
  ): string => {
    const imported = text.replace(
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*([^;]*);/g,
      (match, url, media) => {
        if (external(url)) return match;
        const path = resolvePath(url, from);
        if (!files[path] || seen.has(path)) {
          missing.add(path);
          return "";
        }
        const next = css(
          decoder.decode(files[path]),
          path,
          new Set([...seen, path]),
        );
        return media.trim() ? `@media ${media}{${next}}` : next;
      },
    );
    return imported.replace(
      /url\(\s*(["']?)([^)"']+)\1\s*\)/g,
      (_, _quote, url) => `url("${resource(url.trim(), from)}")`,
    );
  };
  doc
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    .forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (external(href)) return;
      const path = resolvePath(href, main);
      if (!files[path]) {
        missing.add(path);
        return;
      }
      const style = doc.createElement("style");
      style.textContent = css(decoder.decode(files[path]), path);
      if (link.media) style.media = link.media;
      link.replaceWith(style);
    });
  doc.querySelectorAll("style").forEach((style) => {
    style.textContent = css(style.textContent || "", main);
  });
  doc
    .querySelectorAll("[style]")
    .forEach((el) =>
      el.setAttribute("style", css(el.getAttribute("style")!, main)),
    );
  doc
    .querySelectorAll(
      "img[src],source[src],video[poster],script[src],image[href],image[xlink\\:href]",
    )
    .forEach((el) => {
      for (const attr of ["src", "poster", "href", "xlink:href"])
        if (el.hasAttribute(attr))
          el.setAttribute(attr, resource(el.getAttribute(attr)!, main));
    });
  doc.querySelectorAll("img[srcset],source[srcset]").forEach((el) => {
    // Local candidates can be made self-contained; existing data URIs are kept.
    const set = el.getAttribute("srcset")!;
    if (!set.includes("data:"))
      el.setAttribute(
        "srcset",
        set
          .split(",")
          .map((candidate) => {
            const [url, ...descriptor] = candidate.trim().split(/\s+/);
            return `${resource(url, main)} ${descriptor.join(" ")}`.trim();
          })
          .join(", "),
      );
  });
  const notices = missing.size
    ? [
        `有 ${missing.size} 个本地资源未在 ZIP 中找到，预览时请留意缺图或字体变化。`,
      ]
    : [];
  if (names.length > 1)
    notices.push(
      `ZIP 含 ${names.length} 个 HTML，已打开 ${main}。要编辑其他文件，请单独打包后导入。`,
    );
  return {
    html: "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    name: main.split("/").pop()!,
    notices,
  };
}
