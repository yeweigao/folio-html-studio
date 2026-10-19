import bridge from "./bridge.js?raw";

export function prepareDocument(html: string, channel: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let charset = doc.querySelector("meta[charset]");
  if (!charset) {
    charset = doc.createElement("meta");
    doc.head.prepend(charset);
  }
  charset.setAttribute("charset", "utf-8");
  doc
    .querySelectorAll(
      '[data-folio-runtime],script[data-folio-bridge],meta[http-equiv="Content-Security-Policy"]',
    )
    .forEach((el) => el.remove());
  // Keep source documents from resolving local paths against the studio origin.
  doc.querySelectorAll("base").forEach((el) => el.remove());
  const base = doc.createElement("base");
  base.href = "https://folio-document.invalid/";
  base.dataset.folioBase = "";
  doc.head.prepend(base);
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.dataset.folioCsp = "";
  policy.content =
    "default-src data: blob: https: http:; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob: https: http:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'";
  doc.head.prepend(policy);
  const script = doc.createElement("script");
  script.dataset.folioBridge = "";
  script.dataset.channel = channel;
  script.dataset.parent = location.origin;
  script.textContent = bridge;
  doc.body.append(script);
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

export function downloadHtml(html: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([html], { type: "text/html;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\.(html?|zip)$/i, "") || "handbook"}_edited.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
