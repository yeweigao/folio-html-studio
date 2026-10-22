import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = `${root}.qa`;
const port = 4178;
const url = `http://127.0.0.1:${port}`;
const fixture = `<!doctype html><html><head><style>
body{margin:0;font-family:Arial}
.page{position:relative;width:600px;height:800px;background:#fff;padding:40px;box-sizing:border-box;overflow:hidden}
.layout{position:absolute;left:40px;top:40px;right:40px;bottom:40px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px;align-content:start}
.layout > div{height:120px;background:#edf2ff}
.box{position:absolute;left:40px;top:300px;width:115px;height:70px;background:#ffd9e1}
.marker{position:absolute;left:210px;top:500px;width:80px;height:60px;background:#e7f0d9}
</style></head><body><section class="page">
<div class="layout"><div></div><div></div><div></div><div></div></div>
<p class="copy" style="position:absolute;left:40px;top:250px;width:300px;font-size:18px;line-height:24px;margin:0">Column copy for the grid.</p>
<div class="box"></div><div class="marker"></div>
</section></body></html>`;
const typographicFixture = `<!doctype html><html><head><style>
body{margin:0;font-family:Arial}
.page{position:relative;width:600px;height:800px;background:#fff;overflow:hidden}
.copy{position:absolute;left:48px;top:60px;width:504px;font-size:12.5px;line-height:20px;margin:0}
.panel{position:absolute;left:48px;top:180px;width:504px;height:220px;background:#f7f8fb}
.table{display:grid;grid-template-columns:200px 288px;gap:16px;height:180px}
.even{position:absolute;left:0;top:220px;right:0;display:grid;grid-template-columns:repeat(8,1fr);gap:8px;height:200px}
.even > div{background:#e7f0d9}
.box{position:absolute;left:48px;top:600px;width:100px;height:60px;background:#ffd9e1}
</style></head><body><section class="page">
<p class="copy">The typographic grid follows the page margins and the six-column measure.</p>
<div class="panel"><div class="table"><div>Contents</div><div>Details</div></div>
<div class="even"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div>
<div class="box"></div>
</section></body></html>`;

async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const executablePath =
      process.env.FOLIO_CHROME ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(executablePath);
    } catch {
      throw error;
    }
    return chromium.launch({ executablePath });
  }
}
async function loaded(page, count) {
  await page
    .locator('.paper-wrap[aria-busy="false"]')
    .waitFor({ timeout: 20000 });
  if (count !== undefined)
    await page.waitForFunction(
      (n) =>
        document.querySelector(".page-total").textContent.replace(/\s/g, "") ===
        `/${n}`,
      count,
    );
  return page.frames().find((frame) => frame.parentFrame());
}
const boxInfo = (frame, selector) =>
  frame.evaluate((name) => {
    const page = document.querySelector(".page").getBoundingClientRect();
    const rect = document.querySelector(name).getBoundingClientRect();
    return {
      left: rect.left - page.left,
      top: rect.top - page.top,
      width: rect.width,
      height: rect.height,
    };
  }, selector);
const guideInfo = (frame) =>
  frame.evaluate(() =>
    [...document.querySelectorAll("#folio-guides [data-folio-guide]")].map(
      (line) => ({
        d: line.getAttribute("d"),
        stroke: line.getAttribute("stroke"),
        dash: line.getAttribute("stroke-dasharray"),
      }),
    ),
  );

test(
  "layout grid extraction, grid snapping and element alignment guides",
  { timeout: 120000 },
  async () => {
    await mkdir(artifacts, { recursive: true });
    const server = spawn(
      "npm",
      ["run", "dev", "--", "--port", String(port), "--strictPort"],
      { cwd: root, stdio: "pipe", detached: true },
    );
    let serverOutput = "";
    server.stdout.on("data", (data) => (serverOutput += data));
    server.stderr.on("data", (data) => (serverOutput += data));
    let browser;
    try {
      for (let i = 0; i < 150; i++) {
        try {
          if ((await fetch(url)).ok) break;
        } catch {
          /* wait for the dev server */
        }
        if (server.exitCode !== null) throw new Error(serverOutput);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      browser = await launch();
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await loaded(page);
      await page
        .getByLabel("选择 HTML 或 ZIP", { exact: true })
        .setInputFiles({
          name: "grid.html",
          mimeType: "text/html",
          buffer: Buffer.from(fixture),
        });
      let frame = await loaded(page, 1);
      await page.waitForTimeout(300);

      assert.deepEqual(errors, []);
      assert.match(
        await page.locator(".statusbar").innerText(),
        /4 栏网格/,
      );
      const gridButton = page.locator(
        ".canvas-tools .icon-button[aria-pressed]",
      );
      assert.match(await gridButton.getAttribute("title"), /20px 栏间/);
      assert.match(await gridButton.getAttribute("title"), /24px 基线/);
      assert.equal(
        await frame.evaluate(
          () =>
            !document.querySelector("#folio-grid").hidden &&
            document.querySelectorAll(
              "#folio-grid [data-folio-grid-column]",
            ).length,
        ),
        4,
      );
      assert.equal(
        await page
          .locator(".canvas-tools .icon-button[aria-pressed]")
          .getAttribute("aria-pressed"),
        "true",
      );

      const frameScreen = await page.locator(".document-frame").boundingBox();
      const scale = frameScreen.width / 600;
      let box = await frame.locator(".box").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 130 * scale,
        box.y + box.height / 2,
        { steps: 10 },
      );
      await page.waitForTimeout(100);
      assert.deepEqual(
        await boxInfo(frame, ".box").then(({ left, top }) => ({
          left,
          top,
        })),
        { left: 175, top: 300 },
      );
      let guides = await guideInfo(frame);
      assert.ok(guides.length >= 1, "a grid snap should draw a guide");
      assert.ok(
        guides.some((guide) => guide.d.startsWith("M175 ")),
        "the guide should sit on the extracted column line",
      );
      await page.mouse.up();
      await page.waitForTimeout(200);

      box = await frame.locator(".box").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 35 * scale,
        box.y + box.height / 2 + 200 * scale,
        { steps: 12 },
      );
      await page.waitForTimeout(100);
      assert.deepEqual(
        await boxInfo(frame, ".box").then(({ left, top }) => ({
          left,
          top,
        })),
        { left: 210, top: 500 },
      );
      guides = await guideInfo(frame);
      assert.ok(
        guides.filter(
          (guide) => guide.stroke === "#ff3b6b" && guide.dash === null,
        ).length >= 2,
        "left and top should show solid element alignment guides",
      );
      assert.ok(
        guides.some((guide) => guide.d.startsWith("M210 ")),
        "an x guide should follow the marker's left edge",
      );
      assert.ok(
        guides.some((guide) => guide.d.includes(" 500H")),
        "a y guide should follow the marker's top edge",
      );
      await page.screenshot({ path: `${artifacts}/grid-guides.png` });
      await page.mouse.up();
      await page.waitForTimeout(200);

      await page
        .getByRole("button", { name: /隐藏 4 栏网格/ })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".statusbar")
            .textContent.includes("对象对齐吸附开启"),
      );
      assert.equal(
        await frame.evaluate(
          () => document.querySelector("#folio-grid").hidden,
        ),
        true,
      );
      assert.equal(
        await page
          .locator(".canvas-tools .icon-button[aria-pressed]")
          .getAttribute("aria-pressed"),
        "false",
      );

      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "下载 HTML", exact: true })
        .click();
      const file = await pending;
      const path = `${artifacts}/grid-edited.html`;
      await file.saveAs(path);
      const html = await readFile(path, "utf8");
      assert.ok(html.includes('class="layout"'));
      assert.ok(html.includes('class="box"'));
      assert.ok(!html.includes("data-folio-runtime"));
      assert.ok(!html.includes("data-folio-guide"));
      assert.ok(!html.includes("data-folio-grid-column"));
    } finally {
      if (browser) await browser.close();
      try {
        process.kill(-server.pid);
      } catch {
        /* server already exited */
      }
    }
  },
);

test(
  "typographic grid ignores content tables and derives margins and baseline",
  { timeout: 120000 },
  async () => {
    await mkdir(artifacts, { recursive: true });
    const port = 4179;
    const server = spawn(
      "npm",
      ["run", "dev", "--", "--port", String(port), "--strictPort"],
      { cwd: root, stdio: "pipe", detached: true },
    );
    let serverOutput = "";
    server.stdout.on("data", (data) => (serverOutput += data));
    server.stderr.on("data", (data) => (serverOutput += data));
    let browser;
    try {
      for (let i = 0; i < 150; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
        } catch {
          /* wait for the dev server */
        }
        if (server.exitCode !== null) throw new Error(serverOutput);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      browser = await launch();
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}`);
      await loaded(page);
      await page
        .getByLabel("选择 HTML 或 ZIP", { exact: true })
        .setInputFiles({
          name: "typographic.html",
          mimeType: "text/html",
          buffer: Buffer.from(typographicFixture),
        });
      const frame = await loaded(page, 1);
      await page.waitForTimeout(300);

      assert.deepEqual(errors, []);
      assert.match(
        await page.locator(".statusbar").innerText(),
        /6 栏网格/,
      );
      const gridButton = page.locator(
        ".canvas-tools .icon-button[aria-pressed]",
      );
      assert.match(await gridButton.getAttribute("title"), /24px 栏间/);
      assert.match(await gridButton.getAttribute("title"), /20px 基线/);

      const overlay = await frame.evaluate(() => {
        const columns = [
          ...document.querySelectorAll("#folio-grid [data-folio-grid-column]"),
        ].map((rect) => ({
          x: Number(rect.getAttribute("x")),
          width: Number(rect.getAttribute("width")),
        }));
        const baselines = [
          ...document.querySelectorAll('#folio-grid path[stroke="#164be8"]'),
        ].map((path) => path.getAttribute("d"));
        return { columns, baselines };
      });
      assert.equal(overlay.columns.length, 6);
      assert.ok(
        Math.abs(overlay.columns[0].x - 48) < 0.5,
        "the first column should start at the detected left margin",
      );
      const last = overlay.columns[overlay.columns.length - 1];
      assert.ok(
        Math.abs(last.x + last.width - 552) < 0.5,
        "the last column should end at the detected right margin",
      );
      assert.ok(
        Math.abs(
          overlay.columns[1].x -
            (overlay.columns[0].x + overlay.columns[0].width) -
            24,
        ) < 1,
        "gutters should follow the typographic grid",
      );
      assert.ok(
        overlay.baselines.length > 30 &&
          overlay.baselines[0].startsWith("M0 20H600"),
        "baselines should repeat on the detected rhythm",
      );

      const frameScreen = await page.locator(".document-frame").boundingBox();
      const scale = frameScreen.width / 600;
      const box = await frame.locator(".box").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 64 * scale,
        box.y + box.height / 2,
        { steps: 10 },
      );
      await page.waitForTimeout(100);
      const moved = await boxInfo(frame, ".box");
      assert.ok(
        Math.abs(moved.left - 111.85) < 0.5,
        `the block should snap to the first column edge, got ${moved.left}`,
      );
      const guides = await guideInfo(frame);
      const snappedX = guides
        .filter((guide) => /^M[\d.]+ [\d.]+V/.test(guide.d))
        .map((guide) => Number.parseFloat(guide.d.slice(1)));
      assert.ok(
        snappedX.some((x) => Math.abs(x - moved.left) < 0.5),
        `a vertical guide should mark the snapped column edge: ${JSON.stringify(
          guides,
        )}`,
      );
      await page.screenshot({ path: `${artifacts}/typographic-grid.png` });
      await page.mouse.up();
      await page.waitForTimeout(200);
    } finally {
      if (browser) await browser.close();
      try {
        process.kill(-server.pid);
      } catch {
        /* server already exited */
      }
    }
  },
);
