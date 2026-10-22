import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// handbook-designer 编辑包：显示所基于的构建；不能按 ID 写回的对象给出提示；下载后保留 ID 与构建标记。
const root = fileURLToPath(new URL("../", import.meta.url));
const port = 4176;
const url = `http://127.0.0.1:${port}`;
const pkg = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="hb-contract" content="1"><meta name="hb-build" content="0123456789ab"><meta name="hb-lang" content="zh-CN"><meta name="hb-title" content="测试手册">
<style>body{margin:0}.page{position:relative;width:600px;height:800px;overflow:hidden;background:#fff;font:16px/1.6 sans-serif}
.band{position:absolute;left:0;right:0;bottom:0;height:120px;background:#1d3557}
img{position:absolute;left:40px;top:300px;width:300px;height:200px}</style></head><body>
<section class="page" data-page-id="p-one">
<h1 data-source-id="title" style="margin:40px">原来的标题</h1>
<p data-source-id="lead" style="margin:40px">原来的导语。</p>
<p class="loose" style="margin:40px">没有内容 ID 的说明文字</p>
<img src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#ddd"/></svg>').toString("base64")}" alt="示意图" data-edit-id="img-a" data-asset="a">
<div class="band"></div>
</section></body></html>`;

test("handbook-designer 编辑包", { timeout: 120000 }, async () => {
  await mkdir(`${root}.qa`, { recursive: true });
  const server = spawn("npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], { cwd: root, stdio: "pipe", detached: true });
  let browser;
  try {
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(url)).ok) break; } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch(process.env.FOLIO_CHROME ? { executablePath: process.env.FOLIO_CHROME } : {});
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })).newPage();
    await page.goto(url);
    await page.locator('.paper-wrap[aria-busy="false"]').waitFor({ timeout: 20000 });
    await page.getByLabel("选择 HTML 或 ZIP", { exact: true }).setInputFiles({ name: "pkg.folio.html", mimeType: "text/html", buffer: Buffer.from(pkg) });
    await page.waitForFunction(() => document.querySelector(".page-total")?.textContent.replace(/\s/g, "") === "/1");
    const frame = page.frames().find((f) => f.parentFrame());
    assert.match(await page.locator(".hb-source").innerText(), /0123456789ab · zh-CN/);

    await frame.locator('[data-source-id="lead"]').click();
    await page.locator(".selected-summary p", { hasText: "原来的导语" }).first().waitFor();
    assert.equal(await page.locator(".hb-untraceable").count(), 0, "有内容 ID 的段落不应提示");

    await frame.locator("p.loose").click();
    await page.locator(".hb-untraceable", { hasText: "改字不会写回" }).waitFor();

    await frame.locator(".band").click({ position: { x: 200, y: 20 } });
    await page.locator(".hb-untraceable", { hasText: "位置、尺寸与样式调整不会写回" }).waitFor();

    await frame.locator('[data-source-id="title"]').click();
    await page.getByRole("button", { name: "编辑文字", exact: true }).click();
    await frame.locator('[data-source-id="title"][contenteditable="true"]').waitFor();
    await frame.locator('[data-source-id="title"]').fill("新的标题");
    await page.getByRole("heading", { name: "编辑属性" }).click();

    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 HTML", exact: true }).click();
    const file = await pending;
    const path = `${root}.qa/hb-package-edited.html`;
    await file.saveAs(path);
    const html = await (await import("node:fs/promises")).readFile(path, "utf8");
    assert.match(html, /<meta name="hb-build" content="0123456789ab">/);
    assert.match(html, /data-source-id="title"[^>]*>新的标题<\/h1>/);
    assert.match(html, /data-edit-id="img-a"/);
    assert.match(html, /data-page-id="p-one"/);
  } finally {
    if (browser) await browser.close();
    try { process.kill(-server.pid); } catch { /* exited */ }
  }
});
