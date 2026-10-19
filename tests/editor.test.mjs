import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, access, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { strToU8, zipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = `${root}.qa`;
const port = 4174;
const url = `http://127.0.0.1:${port}`;

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
async function importHtml(page, html, name = "fixture.html") {
  await page
    .getByLabel("选择 HTML 或 ZIP", { exact: true })
    .setInputFiles({ name, mimeType: "text/html", buffer: Buffer.from(html) });
  return loaded(page);
}
async function download(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 HTML", exact: true }).click();
  const file = await pending;
  const path = `${artifacts}/${name}`;
  await file.saveAs(path);
  return { html: await readFile(path, "utf8"), path };
}

test(
  "HTML editor: actual edit, drag, resize, history, save/reopen, ZIP and isolation",
  { timeout: 240000 },
  async (t) => {
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
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(url)).ok) break;
        } catch {
          /* wait for server */
        }
        if (server.exitCode !== null) throw new Error(serverOutput);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      browser = await launch();
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
        acceptDownloads: true,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      let frame = await loaded(page, 3);
      await page.screenshot({
        path: `${artifacts}/studio-desktop.png`,
        fullPage: true,
      });
      assert.equal(
        await frame.locator(".page:not([data-folio-hidden])").count(),
        1,
      );
      assert.equal(await frame.locator("h1").innerText(), "Field\nNotes.");

      await t.test(
        "real pointer drag, resize, and property editing",
        async () => {
          const title = frame.locator("h1");
          const before = await title.evaluate((el) => ({
            x: el.getBoundingClientRect().x,
            width: el.getBoundingClientRect().width,
          }));
          const box = await title.boundingBox();
          await page.mouse.move(box.x + 30, box.y + 35);
          await page.mouse.down();
          await page.mouse.move(box.x + 68, box.y + 64, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(250);
          const after = await title.evaluate((el) => ({
            x: el.getBoundingClientRect().x,
            width: el.getBoundingClientRect().width,
          }));
          assert.ok(
            after.x > before.x + 20,
            `drag should move the title: ${JSON.stringify({ before, after })}`,
          );
          const handle = await frame.locator("#folio-handle").boundingBox();
          await page.mouse.move(
            handle.x + handle.width / 2,
            handle.y + handle.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            handle.x + handle.width / 2 + 35,
            handle.y + handle.height / 2 + 10,
            { steps: 6 },
          );
          await page.mouse.up();
          assert.ok(
            (await title.evaluate((el) => el.getBoundingClientRect().width)) >
              after.width + 20,
          );
          const size = page
            .locator(".number-field")
            .filter({ has: page.locator("span", { hasText: /^字号$/ }) })
            .locator("input");
          await size.fill("100");
          await size.press("Enter");
          await page.waitForTimeout(200);
          assert.equal(
            await title.evaluate((el) => getComputedStyle(el).fontSize),
            "100px",
          );
          await page.screenshot({
            path: `${artifacts}/studio-selected.png`,
            fullPage: true,
          });
        },
      );

      await t.test(
        "inline text, undo/redo and clean downloadable HTML",
        async () => {
          await page
            .getByRole("button", { name: "编辑文字", exact: true })
            .click();
          await frame.locator('h1[contenteditable="true"]').waitFor();
          await frame.locator("h1").fill("A better journey.");
          await page.getByRole("heading", { name: "编辑属性" }).click();
          await page.waitForTimeout(250);
          assert.equal(
            await frame.locator("h1").innerText(),
            "A better journey.",
          );
          let navigation = page.waitForEvent("framenavigated", {
            predicate: (f) => !!f.parentFrame(),
          });
          await page
            .getByRole("button", { name: "撤销 ⌘Z", exact: true })
            .click();
          await navigation;
          frame = await loaded(page, 3);
          assert.equal(await frame.locator("h1").innerText(), "Field\nNotes.");
          navigation = page.waitForEvent("framenavigated", {
            predicate: (f) => !!f.parentFrame(),
          });
          await page
            .getByRole("button", { name: "重做 ⇧⌘Z", exact: true })
            .click();
          await navigation;
          frame = await loaded(page, 3);
          assert.equal(
            await frame.locator("h1").innerText(),
            "A better journey.",
          );
          const output = await download(page, "edited-sample.html");
          assert.ok(!output.html.includes("data-folio-runtime"));
          assert.ok(!output.html.includes("data-folio-bridge"));
          assert.ok(!output.html.includes("data-folio-hidden"));
          assert.ok(!output.html.includes('contenteditable="true"'));
          assert.ok(!output.html.includes("folio-document.invalid"));
          assert.ok(output.html.includes("folio-persistent-styles"));
          frame = await importHtml(page, output.html, "edited-sample.html");
          await loaded(page, 3);
          assert.equal(
            await frame.locator("h1").innerText(),
            "A better journey.",
          );
          assert.equal(
            await frame
              .locator("h1")
              .evaluate((el) => getComputedStyle(el).fontSize),
            "100px",
          );
          assert.ok(
            await frame
              .locator("h1")
              .evaluate((el) => getComputedStyle(el).transform !== "none"),
          );
          await page.getByRole("button", { name: /^第 2 页/ }).click();
          await page.waitForFunction(() =>
            document
              .querySelector(".current-page")
              .textContent.includes("第 2 页"),
          );
          assert.equal(
            await frame
              .locator(".page:not([data-folio-hidden])")
              .getAttribute("id"),
            "story",
          );
          assert.ok((await frame.locator("#story").boundingBox()).width > 100);
          // Verify the exported file actually prints all physical pages, not just the selected page.
          const printPage = await context.newPage();
          await printPage.goto(`file://${output.path}`);
          await printPage.evaluate(() => document.fonts.ready);
          await printPage.pdf({
            path: `${artifacts}/edited-sample.pdf`,
            preferCSSPageSize: true,
            printBackground: true,
          });
          assert.equal(await printPage.locator(".page").count(), 3);
          await printPage.close();
        },
      );

      await t.test("refresh restores the local draft on request", async () => {
        await page.waitForFunction(() =>
          document.querySelector(".save-state").textContent.includes("已保存"),
        );
        await page.reload();
        await loaded(page, 3);
        await page.getByRole("button", { name: /继续编辑/ }).click();
        frame = await loaded(page, 3);
        assert.equal(
          await frame.locator("h1").innerText(),
          "A better journey.",
        );
      });

      await t.test(
        "ZIP with relative CSS, images and fonts becomes self contained",
        async () => {
          const fixture = zipSync({
            "document/index.html": strToU8(
              '<html><head><link rel="stylesheet" href="css/main.css"></head><body><section class="page"><h1>ZIP project</h1><img alt="zip image" src="images/example.svg"></section></body></html>',
            ),
            "document/css/main.css": strToU8(
              ".page{width:600px;height:800px;background:white}h1{font:32px Georgia;color:rgb(22,75,232)}img{width:200px;height:160px}",
            ),
            "document/images/example.svg": strToU8(
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="blue"/></svg>',
            ),
          });
          await page
            .getByLabel("选择 HTML 或 ZIP", { exact: true })
            .setInputFiles({
              name: "project.zip",
              mimeType: "application/zip",
              buffer: Buffer.from(fixture),
            });
          frame = await loaded(page, 1);
          assert.equal(
            await frame
              .locator("h1")
              .evaluate((el) => getComputedStyle(el).color),
            "rgb(22, 75, 232)",
          );
          assert.ok(
            await frame
              .locator("img")
              .evaluate(
                (el) =>
                  el.complete &&
                  el.naturalWidth === 200 &&
                  el.src.startsWith("data:image/svg+xml"),
              ),
          );
          await frame.locator("img").click();
          await page.getByLabel("图片右下", { exact: true }).click();
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("img")).objectPosition ===
              "100% 100%",
          );
          assert.equal(
            await frame
              .locator("img")
              .evaluate((el) => getComputedStyle(el).objectPosition),
            "100% 100%",
          );
          const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="red"/></svg>';
          await page.getByLabel("选择替换图片", { exact: true }).setInputFiles({
            name: "new.svg",
            mimeType: "image/svg+xml",
            buffer: Buffer.from(svg),
          });
          await frame.waitForFunction(
            () => document.querySelector("img").naturalWidth === 90,
          );
          const { html } = await download(page, "zip-edited.html");
          assert.ok(!html.includes("images/example.svg"));
          assert.ok(!html.includes('href="css/main.css"'));
        },
      );

      await t.test(
        "ordinary HTML works and document scripts are isolated",
        async () => {
          const html =
            '<html><head><style>body{font-family:Arial}h1{font-size:40px}</style></head><body><h1>Plain document</h1><p>Editable content.</p><script>window.executedInDocument=true;try{parent.document.body.dataset.escaped="yes"}catch(e){window.isolated=true}</script></body></html>';
          frame = await importHtml(page, html, "plain.html");
          await loaded(page, 1);
          assert.equal(
            await frame.evaluate(
              () => window.executedInDocument && window.isolated,
            ),
            true,
          );
          assert.equal(
            await page.evaluate(() => document.body.dataset.escaped),
            undefined,
          );
          await frame.locator("p").dblclick();
          await frame.locator("p").fill("Changed plain content.");
          await page.getByRole("heading", { name: "编辑属性" }).click();
          assert.equal(
            await frame.locator("p").innerText(),
            "Changed plain content.",
          );
          await page
            .getByLabel("选择 HTML 或 ZIP", { exact: true })
            .setInputFiles({
              name: "bad.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("not html"),
            });
          await page
            .getByRole("alert")
            .filter({ hasText: "请选择 HTML 或 ZIP 文件" })
            .waitFor();
        },
      );

      await t.test(
        "embedded document fonts survive switching; batch styles use one shared rule and persist",
        async () => {
          const font = (
            await readFile(`${root}public/fonts/inter-400.woff2`)
          ).toString("base64");
          const fixture = `<!doctype html><html><head><style>
          @font-face{font-family:OriginalHeadline;src:url(data:font/woff2;base64,${font})}
          @font-face{font-family:OriginalBody;src:url(data:font/woff2;base64,${font})}
          body{margin:0}.page{position:relative;width:600px;height:800px;overflow:hidden;page-break-after:always;background:white;font-family:OriginalBody,sans-serif}.page:last-child{page-break-after:auto}
          h2{margin:30px;font-size:24px;line-height:36px;font-family:OriginalHeadline,serif}
          p{margin:30px;font-size:17px;line-height:28px} @page{size:600px 800px;margin:0}
          </style></head><body><section class="page" id="fpage1"><h2 class="shared-heading">A thoughtful page</h2><p>中文印刷正文 A thoughtful page.</p></section>
          <section class="page" id="fpage2"><h2 class="shared-heading">Another shared heading</h2><p>A different paragraph.</p></section>
          <section class="page" id="fpage3"><h2 class="unique-heading">An independent heading</h2><p>Keep this text unchanged.</p></section></body></html>`;
          frame = await importHtml(page, fixture, "font-styles.html");
          await loaded(page, 3);
          await frame.locator("#fpage1 h2").click();
          const picker = page.getByLabel("字体", { exact: true });
          assert.ok(
            await picker
              .locator("option")
              .filter({ hasText: "OriginalHeadline" })
              .count(),
          );
          assert.ok(
            await picker
              .locator("option")
              .filter({ hasText: "OriginalBody" })
              .count(),
          );
          await picker.selectOption("system:Georgia, serif");
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage1 h2"),
            ).fontFamily.includes("Georgia"),
          );
          assert.ok(
            await picker
              .locator("option")
              .filter({ hasText: "OriginalHeadline" })
              .count(),
            "Original font must remain available after switching",
          );
          await page
            .getByRole("button", { name: "恢复原字体", exact: true })
            .click();
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage1 h2"),
            ).fontFamily.includes("OriginalHeadline"),
          );
          await picker.selectOption("library:garamond");
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage1 h2"),
            ).fontFamily.includes("Folio Classic Book"),
          );
          assert.equal(
            await frame.evaluate(() =>
              document.fonts.check('16px "Folio Classic Book"'),
            ),
            true,
          );
          const scope = page.getByLabel("样式应用范围", { exact: true });
          await scope.selectOption("book-style");
          assert.match(
            await page.locator(".scope-detail").innerText(),
            /2 个对象 · 2 页/,
          );
          const size = page
            .locator(".number-field")
            .filter({ has: page.locator("span", { hasText: /^字号$/ }) })
            .locator("input");
          await size.fill("30");
          await size.press("Enter");
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#fpage2 h2"))
                .fontSize === "30px",
          );
          assert.equal(
            await frame
              .locator("#fpage3 h2")
              .evaluate((el) => getComputedStyle(el).fontSize),
            "24px",
          );
          assert.equal(
            await frame
              .locator("#fpage1 p")
              .evaluate((el) => getComputedStyle(el).fontSize),
            "17px",
          );
          assert.equal(
            await frame.evaluate(
              () =>
                JSON.parse(
                  document.querySelector("#folio-shared-styles").dataset.rules,
                ).length,
            ),
            1,
          );
          assert.equal(
            await frame.locator("#fpage2 h2").getAttribute("style"),
            null,
            "Batch changes must not create inline style patches",
          );
          await picker.selectOption("library:source-serif");
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage2 h2"),
            ).fontFamily.includes("Folio Editorial Text"),
          );
          assert.ok(
            !(
              await frame
                .locator("#fpage3 h2")
                .evaluate((el) => getComputedStyle(el).fontFamily)
            ).includes("Folio Editorial Text"),
          );
          await page
            .getByRole("button", { name: "恢复原字体", exact: true })
            .click();
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage2 h2"),
            ).fontFamily.includes("OriginalHeadline"),
          );
          await scope.selectOption("book-font");
          assert.match(
            await page.locator(".scope-detail").innerText(),
            /3 个对象 · 3 页/,
          );
          await picker.selectOption("library:source-sans");
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage3 h2"),
            ).fontFamily.includes("Folio Humanist Sans"),
          );
          assert.ok(
            (
              await frame
                .locator("#fpage1 p")
                .evaluate((el) => getComputedStyle(el).fontFamily)
            ).includes("OriginalBody"),
          );
          await scope.selectOption("book-size");
          const spacing = page
            .locator(".number-field")
            .filter({ has: page.locator("span", { hasText: /^字距$/ }) })
            .locator("input");
          await spacing.fill("1");
          await spacing.press("Enter");
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#fpage2 h2"))
                .letterSpacing === "1px",
          );
          assert.equal(
            await frame
              .locator("#fpage3 h2")
              .evaluate((el) => getComputedStyle(el).letterSpacing),
            "normal",
          );
          await frame.locator("#fpage1 p").click();
          await picker.selectOption("library:noto-serif-sc");
          await frame.waitForFunction(
            () =>
              getComputedStyle(
                document.querySelector("#fpage1 p"),
              ).fontFamily.includes("Folio CJK Serif"),
            {},
            { timeout: 30000 },
          );
          assert.equal(
            await frame.evaluate(() =>
              document.fonts.check('16px "Folio CJK Serif"', "中文印刷正文"),
            ),
            true,
          );
          await page.locator(".font-picker").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `${artifacts}/font-library.png`,
            fullPage: true,
          });
          const output = await download(page, "typography-edited.html");
          assert.ok(output.html.includes("SIL OPEN FONT LICENSE"));
          assert.ok(
            output.html.includes('charset="utf-8"'),
            "Downloads must declare UTF-8 even if the imported HTML had no charset",
          );
          assert.ok(output.html.includes("data:font/woff2;base64,"));
          frame = await importHtml(page, output.html, "typography-edited.html");
          await loaded(page, 3);
          assert.equal(
            await frame
              .locator("#fpage2 h2")
              .evaluate((el) => getComputedStyle(el).fontSize),
            "30px",
          );
          assert.ok(
            (
              await frame
                .locator("#fpage1 p")
                .evaluate((el) => getComputedStyle(el).fontFamily)
            ).includes("Folio CJK Serif"),
          );
          await frame.locator("#fpage1 p").click();
          assert.ok(
            await page
              .getByLabel("字体", { exact: true })
              .locator("option")
              .filter({ hasText: "OriginalBody" })
              .count(),
          );
          await page
            .getByRole("button", { name: "恢复原字体", exact: true })
            .click();
          await frame.waitForFunction(() =>
            getComputedStyle(
              document.querySelector("#fpage1 p"),
            ).fontFamily.includes("OriginalBody"),
          );
          const proof = await context.newPage();
          await proof.goto(`file://${output.path}`);
          await proof.evaluate(() => document.fonts.ready);
          await proof.pdf({
            path: `${artifacts}/typography-proof.pdf`,
            preferCSSPageSize: true,
            printBackground: true,
          });
          await proof.close();
        },
      );

      await t.test(
        "justification and wrapping are independent, batchable and survive export",
        async () => {
          const copy =
            "A good reading rhythm depends on the relationship between the words, the width of the column and the space between lines. Thoughtful typography helps the reader follow a paragraph without losing their place.";
          frame = await importHtml(
            page,
            `<!doctype html><html><head><style>
            body{margin:0}.page{position:relative;width:600px;height:800px;background:white}
            p{width:290px;margin:30px;font:20px/30px Arial;text-align:left}
            .shared-copy{text-wrap:pretty;text-align-last:justify}
            </style></head><body>
            <section class="page" id="wrap1"><p class="shared-copy">${copy}</p><p class="other-copy">Leave this paragraph alone.</p></section>
            <section class="page" id="wrap2"><p class="shared-copy">${copy}</p></section>
            </body></html>`,
            "wrapping.html",
          );
          await loaded(page, 2);
          await frame.locator("#wrap1 .shared-copy").click();
          const wrapping = page.getByLabel("断行优化", { exact: true });
          await page.waitForFunction(
            () =>
              document.querySelector('[aria-label="断行优化"]')?.value ===
              "pretty",
          );
          await page
            .getByRole("button", { name: "两端对齐", exact: true })
            .click();
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#wrap1 .shared-copy"))
                .textAlign === "justify",
          );
          assert.equal(
            await frame
              .locator("#wrap1 .shared-copy")
              .evaluate((el) => getComputedStyle(el).textAlignLast),
            "auto",
          );
          assert.equal(await wrapping.inputValue(), "pretty");
          await wrapping.selectOption("balance");
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#wrap1 .shared-copy"))
                .textWrapStyle === "balance",
          );
          assert.equal(
            await frame
              .locator("#wrap1 .shared-copy")
              .evaluate((el) => getComputedStyle(el).textAlign),
            "justify",
          );
          await page
            .getByRole("button", { name: "左对齐", exact: true })
            .click();
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#wrap1 .shared-copy"))
                .textAlign === "left",
          );
          assert.equal(await wrapping.inputValue(), "balance");
          await wrapping.selectOption("auto");
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#wrap1 .shared-copy"))
                .textWrapStyle === "auto",
          );
          await page
            .getByLabel("样式应用范围", { exact: true })
            .selectOption("book-style");
          await page
            .getByRole("button", { name: "两端对齐", exact: true })
            .click();
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#wrap2 .shared-copy"))
                .textAlign === "justify",
          );
          await wrapping.selectOption("pretty");
          await frame.waitForFunction(
            () =>
              getComputedStyle(document.querySelector("#wrap2 .shared-copy"))
                .textWrapStyle === "pretty",
          );
          for (const selector of [
            "#wrap1 .shared-copy",
            "#wrap2 .shared-copy",
          ]) {
            assert.equal(
              await frame.locator(selector).getAttribute("style"),
              null,
            );
            assert.equal(await frame.locator(selector).textContent(), copy);
          }
          assert.deepEqual(
            await frame
              .locator(".other-copy")
              .evaluate((el) => ({
                align: getComputedStyle(el).textAlign,
                wrap: getComputedStyle(el).textWrapStyle,
              })),
            { align: "left", wrap: "auto" },
          );
          await page.screenshot({
            path: `${artifacts}/alignment-wrapping.png`,
            fullPage: true,
          });
          const output = await download(page, "wrapping-edited.html");
          assert.match(output.html, /text-wrap:\s*pretty\s*!important/);
          frame = await importHtml(page, output.html, "wrapping-edited.html");
          await loaded(page, 2);
          for (const selector of [
            "#wrap1 .shared-copy",
            "#wrap2 .shared-copy",
          ]) {
            assert.deepEqual(
              await frame
                .locator(selector)
                .evaluate((el) => ({
                  align: getComputedStyle(el).textAlign,
                  wrap: getComputedStyle(el).textWrapStyle,
                  last: getComputedStyle(el).textAlignLast,
                })),
              { align: "justify", wrap: "pretty", last: "auto" },
            );
          }
          await frame.locator("#wrap1 .shared-copy").click();
          await page.waitForFunction(
            () =>
              document.querySelector('[aria-label="断行优化"]')?.value ===
              "pretty",
          );
          assert.equal(
            await page
              .getByRole("button", { name: "两端对齐", exact: true })
              .getAttribute("aria-pressed"),
            "true",
          );
        },
      );

      await t.test(
        "brand SVG can be hit directly, filtered, adjusted, replaced, batched and reopened",
        async () => {
          const graphic = (index) =>
            `<svg class="cn-brand-graphic deco" data-spread="${index === 1 ? "left" : "right"}" style="position:absolute;inset:0;width:400px;height:600px;pointer-events:none;color:rgb(22,75,232)" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg"><defs><mask id="proof-mask-${index}"><rect width="400" height="600" fill="white"/></mask></defs><g mask="url(#proof-mask-${index})"><g class="cn-brand-ink" opacity=".05" transform="matrix(2 0 0 2 ${index === 1 ? 50 : -350} 200)"><path fill="currentColor" d="M0 0H100V100H0Z"/></g></g></svg>`;
          frame = await importHtml(
            page,
            `<html><head><style>body{margin:0}.page{position:relative;width:400px;height:600px;background:white}h2{margin:30px}</style></head><body><section class="page" id="graphic1"><h2>Graphic one</h2>${graphic(1)}</section><section class="page" id="graphic2"><h2>Graphic two</h2>${graphic(2)}</section></body></html>`,
            "graphics.html",
          );
          await loaded(page, 2);
          await frame
            .locator("#graphic1 path")
            .click({ position: { x: 30, y: 30 } });
          await page
            .getByRole("heading", { name: "品牌暗纹", exact: true })
            .waitFor();
          const opacity = page.getByLabel("图形透明度", { exact: true });
          assert.equal(await opacity.inputValue(), "5");
          await opacity.fill("8");
          await frame.waitForFunction(
            () =>
              getComputedStyle(
                document.querySelector("#graphic1 .cn-brand-ink"),
              ).opacity === ".08" ||
              getComputedStyle(
                document.querySelector("#graphic1 .cn-brand-ink"),
              ).opacity === "0.08",
          );
          const scale = page
            .locator(".number-field")
            .filter({ has: page.locator("span", { hasText: /^缩放$/ }) })
            .locator("input");
          await scale.fill("150");
          await scale.press("Enter");
          const rotation = page
            .locator(".number-field")
            .filter({ has: page.locator("span", { hasText: /^旋转$/ }) })
            .locator("input");
          await rotation.fill("20");
          await rotation.press("Enter");
          await frame.waitForFunction(
            () =>
              JSON.parse(
                document.querySelector("#graphic1 svg").dataset.folioGraphic ||
                  "{}",
              ).rotation === 20,
          );
          assert.equal(
            await frame.locator("#graphic1 svg").getAttribute("viewBox"),
            "0 0 400 600",
          );
          assert.equal(
            await frame.locator("#graphic1 [mask]").getAttribute("mask"),
            "url(#proof-mask-1)",
          );
          await page
            .getByLabel("样式应用范围", { exact: true })
            .selectOption("book-style");
          await opacity.fill("12");
          await frame.waitForFunction(
            () =>
              getComputedStyle(
                document.querySelector("#graphic2 .cn-brand-ink"),
              ).opacity === "0.12",
          );
          await page.getByLabel("图形颜色", { exact: true }).evaluate((el) => {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set.call(el, "#2244aa");
            el.dispatchEvent(new Event("input", { bubbles: true }));
          });
          await frame.waitForFunction(
            () =>
              getComputedStyle(
                document.querySelector("#graphic2 .cn-brand-ink"),
              ).color === "rgb(34, 68, 170)",
          );
          await page
            .getByLabel("样式应用范围", { exact: true })
            .selectOption("spread-graphic");
          await scale.fill("120");
          await scale.press("Enter");
          await rotation.fill("30");
          await rotation.press("Enter");
          await frame.waitForFunction(
            () =>
              JSON.parse(
                document.querySelector("#graphic2 svg").dataset.folioGraphic ||
                  "{}",
              ).rotation === 30,
          );
          const matrices = await frame
            .locator(".cn-brand-ink")
            .evaluateAll((elements) =>
              elements.map((el) => {
                const m = el.transform.baseVal.consolidate().matrix;
                return [m.a, m.b, m.c, m.d, m.e, m.f];
              }),
            );
          assert.deepEqual(matrices[0].slice(0, 4), matrices[1].slice(0, 4));
          assert.ok(
            Math.abs(matrices[0][4] - matrices[1][4] - 400) < 0.001,
            "Paired graphics must keep their common spread coordinate system",
          );
          const replacement =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z" fill="blue"/><script>parent.document.body.dataset.bad="yes"</script></svg>';
          await page.getByLabel("选择替换 SVG", { exact: true }).setInputFiles({
            name: "replacement.svg",
            mimeType: "image/svg+xml",
            buffer: Buffer.from(replacement),
          });
          await frame.waitForFunction(
            () => !!document.querySelector("#graphic1 .cn-brand-ink g"),
          );
          assert.equal(await frame.locator("#graphic1 svg script").count(), 0);
          assert.equal(
            await page.evaluate(() => document.body.dataset.bad),
            undefined,
          );
          assert.equal(
            await frame.locator("#graphic1 [mask]").getAttribute("mask"),
            "url(#proof-mask-1)",
          );
          await page
            .getByRole("tab", { name: "本页对象", exact: true })
            .click();
          await page
            .getByLabel("筛选本页对象", { exact: true })
            .selectOption("graphic");
          await page
            .getByRole("button", { name: "品牌暗纹（SVG）", exact: true })
            .click();
          await page.locator(".graphic-panel").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `${artifacts}/graphic-controls.png`,
            fullPage: true,
          });
          const output = await download(page, "graphics-edited.html");
          frame = await importHtml(page, output.html, "graphics-edited.html");
          await loaded(page, 2);
          assert.equal(
            await frame
              .locator("#graphic1 .cn-brand-ink")
              .evaluate((el) => getComputedStyle(el).opacity),
            "0.12",
          );
          assert.equal(
            await frame
              .locator("#graphic2 .cn-brand-ink")
              .evaluate((el) => getComputedStyle(el).opacity),
            "0.12",
          );
          assert.equal(
            await frame.locator("#graphic1 [mask]").getAttribute("mask"),
            "url(#proof-mask-1)",
          );
          assert.equal(
            await frame
              .locator("#graphic1 svg")
              .evaluate((el) => JSON.parse(el.dataset.folioGraphic).rotation),
            30,
          );
          await page
            .getByRole("button", { name: "品牌暗纹（SVG）", exact: true })
            .click();
          await page
            .getByRole("button", { name: "清除此对象的局部调整", exact: true })
            .click();
          await frame.waitForFunction(
            () => !document.querySelector("#graphic1 svg").dataset.folioGraphic,
          );
          assert.equal(
            await frame
              .locator("#graphic1 .cn-brand-ink")
              .getAttribute("transform"),
            "matrix(2 0 0 2 50 200)",
          );
          assert.equal(
            await frame
              .locator("#graphic1 .cn-brand-ink")
              .evaluate((el) => getComputedStyle(el).opacity),
            "0.12",
            "Clearing local geometry must preserve the shared opacity rule",
          );
          await page.getByRole("tab", { name: /页面/ }).click();
        },
      );

      if (process.env.FOLIO_TEST_HTML)
        await t.test(
          "actual handbook import, edit, download and reopen",
          async () => {
            await page
              .getByLabel("选择 HTML 或 ZIP", { exact: true })
              .setInputFiles(process.env.FOLIO_TEST_HTML);
            frame = await loaded(page, 28);
            await page.getByRole("tab", { name: /页面/ }).click();
            await page.getByRole("button", { name: /^第 5 页/ }).click();
            await page.waitForFunction(() =>
              document
                .querySelector(".current-page")
                .textContent.includes("第 5 页"),
            );
            const title = frame.locator("#p5 .cn-h").first();
            const text = await title.innerText();
            await title.click();
            const size = page
              .locator(".number-field")
              .filter({ has: page.locator("span", { hasText: /^字号$/ }) })
              .locator("input");
            await size.fill("35");
            await size.press("Enter");
            await page.waitForTimeout(250);
            assert.equal(
              await title.evaluate((el) => getComputedStyle(el).fontSize),
              "35px",
            );
            const originalFamily = await title.evaluate(
              (el) => getComputedStyle(el).fontFamily,
            );
            const fonts = page.getByLabel("字体", { exact: true });
            assert.ok(
              await fonts
                .locator("option")
                .filter({ hasText: "HB-playfair" })
                .count(),
            );
            assert.ok(
              await fonts
                .locator("option")
                .filter({ hasText: "HB-inter" })
                .count(),
            );
            await fonts.selectOption("system:Georgia, serif");
            await frame.waitForFunction(() =>
              getComputedStyle(
                document.querySelector("#p5 .cn-h"),
              ).fontFamily.includes("Georgia"),
            );
            await page
              .getByRole("button", { name: "恢复原字体", exact: true })
              .click();
            await frame.waitForFunction(
              (original) =>
                getComputedStyle(document.querySelector("#p5 .cn-h"))
                  .fontFamily === original,
              originalFamily,
            );
            await page
              .getByRole("tab", { name: "本页对象", exact: true })
              .click();
            await page
              .getByLabel("筛选本页对象", { exact: true })
              .selectOption("graphic");
            await page
              .getByRole("button", { name: "品牌暗纹（SVG）", exact: true })
              .click();
            await page.getByLabel("图形透明度", { exact: true }).fill("7");
            await frame.waitForFunction(
              () =>
                getComputedStyle(document.querySelector("#p5 .cn-brand-ink"))
                  .opacity === "0.07",
            );
            await page.locator(".graphic-panel").scrollIntoViewIfNeeded();
            await page.screenshot({
              path: `${artifacts}/actual-handbook.png`,
              fullPage: true,
            });
            const output = await download(page, "actual-handbook-edited.html");
            frame = await importHtml(
              page,
              output.html,
              "actual-handbook-edited.html",
            );
            await loaded(page, 28);
            await page.getByRole("tab", { name: /页面/ }).click();
            await page.getByRole("button", { name: /^第 5 页/ }).click();
            assert.equal(
              await frame.locator("#p5 .cn-h").first().innerText(),
              text,
            );
            assert.equal(
              await frame
                .locator("#p5 .cn-h")
                .first()
                .evaluate((el) => getComputedStyle(el).fontSize),
              "35px",
            );
            assert.equal(
              await frame
                .locator("#p5 .cn-brand-ink")
                .evaluate((el) => getComputedStyle(el).opacity),
              "0.07",
            );
          },
        );

      await t.test(
        "mobile viewport keeps import, canvas and download reachable",
        async () => {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.screenshot({
            path: `${artifacts}/studio-mobile.png`,
            fullPage: true,
          });
          assert.ok(
            (
              await page
                .getByRole("button", { name: "导入文件", exact: true })
                .boundingBox()
            ).x >= 0,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
        },
      );
      assert.deepEqual(
        errors,
        [],
        `Unexpected runtime errors: ${errors.join("\n")}`,
      );
      await writeFile(
        `${artifacts}/verification.json`,
        JSON.stringify(
          {
            verifiedAt: new Date().toISOString(),
            browser: await browser.version(),
            actualHandbook: !!process.env.FOLIO_TEST_HTML,
            runtimeErrors: errors,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser?.close();
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill();
      }
    }
  },
);
