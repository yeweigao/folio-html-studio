/* Runs inside an opaque-origin sandbox. Communication is through the parent
   window only; imported document scripts never get access to the studio DOM. */
(() => {
  const script = document.currentScript;
  const channel = script.dataset.channel;
  const parentOrigin = script.dataset.parent;
  script.remove();
  const send = (type, payload = {}) =>
    parent.postMessage({ folio: channel, type, ...payload }, parentOrigin);
  let pages = [],
    candidates = [],
    selected = null,
    pageIndex = 0;
  let undo = [],
    redo = [],
    editing = null,
    drag = null,
    overlay,
    outline,
    handle,
    label,
    style;
  let nodeSequence = 0,
    savedTimer;
  const pageSizes = new Map();
  const documentFonts = new Map();
  let sharedRules = [];
  let graphicTransaction = false;
  try {
    sharedRules = JSON.parse(
      document.getElementById("folio-shared-styles")?.dataset.rules || "[]",
    );
  } catch {
    /* old documents have no shared rules */
  }
  const kindOf = (el) =>
    el instanceof SVGSVGElement
      ? "graphic"
      : el.tagName === "IMG" || getComputedStyle(el).backgroundImage !== "none"
        ? "image"
        : el.textContent.trim()
          ? "text"
          : "shape";
  const firstFont = (family) =>
    family
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase();
  const originalData = (el) => {
    try {
      return JSON.parse(el.dataset.folioOriginal || "{}");
    } catch {
      return {};
    }
  };
  const rememberFont = (family, embedded = false) => {
    if (!family) return;
    const key = firstFont(family);
    const previous = documentFonts.get(key);
    documentFonts.set(key, {
      family: previous?.family || family,
      embedded: embedded || previous?.embedded || false,
    });
  };
  const readDocumentFonts = () => {
    document.fonts.forEach((face) =>
      rememberFont(face.family.replace(/^["']|["']$/g, ""), true),
    );
    candidates
      .filter((el) => kindOf(el) === "text")
      .forEach((el) => {
        rememberFont(
          originalData(el).fontFamily || getComputedStyle(el).fontFamily,
        );
        rememberFont(getComputedStyle(el).fontFamily);
      });
  };
  const originalBodyStyle = document.body.getAttribute("style");
  const runtimeId = "data-folio-runtime";
  const skip = (el) => el.closest(`[${runtimeId}],script,style,noscript,head`);
  const clip = (n, a, b) => Math.max(a, Math.min(b, n));
  const rgbaToHex = (value) => {
    const m = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
    return m
      ? "#" +
          m
            .slice(1, 4)
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("")
      : "#ffffff";
  };
  const pageFor = (el) => pages.find((p) => p === el || p.contains(el));
  const ruleData = (el) => {
    try {
      return JSON.parse(el.dataset.folioOverrides || "{}");
    } catch {
      return {};
    }
  };
  const serialize = () => {
    const doc = document.documentElement.cloneNode(true);
    let charset = doc.querySelector("meta[charset]");
    if (!charset) {
      charset = document.createElement("meta");
      doc.querySelector("head").prepend(charset);
    }
    charset.setAttribute("charset", "utf-8");
    doc.querySelectorAll(`[${runtimeId}]`).forEach((el) => el.remove());
    doc.querySelectorAll("[contenteditable]").forEach((el) => {
      if (el.hasAttribute("data-folio-editing")) {
        const old = el.getAttribute("data-folio-editing");
        if (old === "") el.removeAttribute("contenteditable");
        else el.setAttribute("contenteditable", old);
        el.removeAttribute("data-folio-editing");
      }
    });
    doc
      .querySelectorAll("[data-folio-hidden]")
      .forEach((el) => el.removeAttribute("data-folio-hidden"));
    const body = doc.querySelector("body");
    if (originalBodyStyle === null) body.removeAttribute("style");
    else body.setAttribute("style", originalBodyStyle);
    doc
      .querySelectorAll("meta[data-folio-csp],base[data-folio-base]")
      .forEach((el) => el.remove());
    return "<!DOCTYPE html>\n" + doc.outerHTML;
  };
  const checkpoint = () => {
    const snapshot = serialize();
    if (undo.at(-1) !== snapshot) undo.push(snapshot);
    if (undo.length > 35) undo.shift();
    while (
      undo.length > 1 &&
      undo.reduce((sum, item) => sum + item.length, 0) > 32 * 1024 * 1024
    )
      undo.shift();
    redo = [];
  };
  const commit = () => {
    updateOutline();
    emitState();
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => send("snapshot", { html: serialize() }), 180);
  };
  const rebuildRules = () => {
    let css = "";
    document.querySelectorAll("[data-folio-overrides]").forEach((el) => {
      const d = ruleData(el);
      const rules = Object.entries(d.styles || {})
        .map(([key, value]) => `${key}:${value}!important;`)
        .join("");
      const move =
        d.dx || d.dy
          ? `transform:translate(${d.dx || 0}px,${d.dy || 0}px) ${d.baseTransform || ""}!important;`
          : "";
      css += `[data-folio-id="${el.dataset.folioId}"]{${rules}${move}}\n`;
      if (d.graphicStyles)
        css += `[data-folio-id="${el.dataset.folioId}"] .cn-brand-ink{${Object.entries(
          d.graphicStyles,
        )
          .map(([key, value]) => `${key}:${value}!important;`)
          .join("")}}\n`;
    });
    let persisted = document.getElementById("folio-persistent-styles");
    if (!persisted) {
      persisted = document.createElement("style");
      persisted.id = "folio-persistent-styles";
      document.head.append(persisted);
    }
    persisted.textContent = css;
    let shared = document.getElementById("folio-shared-styles");
    if (!shared) {
      shared = document.createElement("style");
      shared.id = "folio-shared-styles";
    }
    shared.dataset.rules = JSON.stringify(sharedRules);
    shared.textContent = sharedRules
      .map(
        (rule) =>
          `${rule.selector}${rule.graphic ? " .cn-brand-ink" : ""}{${Object.entries(
            rule.styles,
          )
            .map(([key, value]) => `${key}:${value}!important;`)
            .join("")}}`,
      )
      .join("\n");
    persisted.before(shared);
  };
  const apply = (el, patch) => {
    const d = ruleData(el);
    if (patch.styles) d.styles = { ...d.styles, ...patch.styles };
    Object.entries(patch).forEach(([key, value]) => {
      if (key !== "styles") d[key] = value;
    });
    el.dataset.folioOverrides = JSON.stringify(d);
    rebuildRules();
  };
  const assignNodes = () => {
    candidates = [];
    const used = new Set(
      [...document.querySelectorAll("[data-folio-id]")].map(
        (el) => el.dataset.folioId,
      ),
    );
    const styleKeys = new Map();
    document
      .querySelectorAll("[data-folio-style]")
      .forEach((el) =>
        styleKeys.set(el.dataset.folioStyleSignature, el.dataset.folioStyle),
      );
    let styleSequence = Math.max(
      0,
      ...[...styleKeys.values()].map((value) => Number(value.slice(1)) || 0),
    );
    pages.forEach((page) => {
      page.dataset.folioPageKey ||= `p${pages.indexOf(page) + 1}`;
      page.querySelectorAll("*").forEach((el) => {
        if (
          !(el instanceof HTMLElement || el instanceof SVGSVGElement) ||
          skip(el) ||
          (el.closest("svg") && !(el instanceof SVGSVGElement))
        )
          return;
        const cs = getComputedStyle(el),
          rect = el.getBoundingClientRect();
        const directText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
        );
        const semanticText = /^(H[1-6]|P|LI|TD|TH|BLOCKQUOTE|FIGCAPTION)$/.test(
          el.tagName,
        );
        const picture =
          el.tagName === "IMG" ||
          el instanceof SVGSVGElement ||
          cs.backgroundImage !== "none";
        const shape =
          el.children.length === 0 &&
          cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          rect.width > 8 &&
          rect.height > 8;
        if (
          !(directText || semanticText || picture || shape) ||
          !rect.width ||
          !rect.height
        )
          return;
        if (!el.dataset.folioId) {
          while (used.has(`f${++nodeSequence}`)) {
            /* stable IDs survive export/import */
          }
          el.dataset.folioId = `f${nodeSequence}`;
          used.add(el.dataset.folioId);
        }
        candidates.push(el);
        if (el instanceof SVGSVGElement && !el.dataset.folioGraphicBase)
          el.dataset.folioGraphicBase = JSON.stringify(measureGraphic(el));
        if (!el.dataset.folioOriginal)
          el.dataset.folioOriginal = JSON.stringify({
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            color: cs.color,
            fontWeight: cs.fontWeight,
            fontStyle: cs.fontStyle,
            textAlign: cs.textAlign,
          });
        const signature =
          kindOf(el) +
          "|" +
          el.tagName +
          "|" +
          [...el.classList]
            .filter((c) => !c.startsWith("folio-"))
            .sort()
            .join(".");
        if (!styleKeys.has(signature))
          styleKeys.set(signature, `s${++styleSequence}`);
        el.dataset.folioStyleSignature = signature;
        el.dataset.folioStyle = styleKeys.get(signature);
      });
    });
    readDocumentFonts();
  };
  const scopeTargets = (scope, target = selected) => {
    if (!target || scope === "single") return target ? [target] : [];
    const kind = kindOf(target),
      cs = getComputedStyle(target);
    return candidates.filter((el) => {
      if (kindOf(el) !== kind) return false;
      if (scope === "page-style" || scope === "book-style")
        return (
          el.dataset.folioStyle === target.dataset.folioStyle &&
          (scope === "book-style" || pageFor(el) === pageFor(target))
        );
      if (scope === "book-font")
        return (
          kind === "text" &&
          firstFont(getComputedStyle(el).fontFamily) ===
            firstFont(cs.fontFamily)
        );
      if (scope === "book-size")
        return (
          kind === "text" &&
          Math.abs(
            parseFloat(getComputedStyle(el).fontSize) - parseFloat(cs.fontSize),
          ) < 0.1
        );
      if (scope === "spread-graphic") {
        const index = pages.indexOf(pageFor(target));
        const paired = target.dataset.spread === "left" ? index + 1 : index - 1;
        return (
          el instanceof SVGSVGElement &&
          el.dataset.variant === target.dataset.variant &&
          [index, paired].includes(pages.indexOf(pageFor(el))) &&
          !!el.dataset.spread
        );
      }
      return false;
    });
  };
  const scopeInfo = () =>
    [
      ["single", "仅此对象"],
      ["page-style", "本页同类样式"],
      ["book-style", "全册同类样式"],
      ...(selected instanceof SVGSVGElement && selected.dataset.spread
        ? [["spread-graphic", "当前跨页暗纹"]]
        : []),
      ...(kindOf(selected) === "text"
        ? [
            ["book-font", "全册同字体"],
            ["book-size", "全册同字号"],
          ]
        : []),
    ].map(([id, label]) => {
      const targets = scopeTargets(id);
      return {
        id,
        label,
        count: targets.length,
        pages: [
          ...new Set(targets.map((el) => pages.indexOf(pageFor(el)) + 1)),
        ],
        examples: targets.slice(0, 3).map((el) => describe(el).label),
      };
    });
  const sharedProperties = new Set([
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "color",
    "text-align",
    "text-align-last",
    "text-wrap",
    "background-color",
    "opacity",
    "object-fit",
    "object-position",
    "background-size",
    "background-position",
  ]);
  const setStyles = (
    target,
    styles,
    scope = "single",
    graphic = false,
    explicitTargets = null,
  ) => {
    const targets = explicitTargets || scopeTargets(scope, target);
    if (scope === "single" && !explicitTargets) {
      if (graphic) {
        const d = ruleData(target);
        d.graphicStyles = { ...d.graphicStyles, ...styles };
        target.dataset.folioOverrides = JSON.stringify(d);
        rebuildRules();
      } else apply(target, { styles });
      return;
    }
    const common = Object.fromEntries(
      Object.entries(styles).filter(([key]) => sharedProperties.has(key)),
    );
    const local = Object.fromEntries(
      Object.entries(styles).filter(([key]) => !sharedProperties.has(key)),
    );
    if (Object.keys(local).length) apply(target, { styles: local });
    if (!Object.keys(common).length || !targets.length) return;
    // All batch selectors have equal specificity; latest shared rule wins.
    let selector;
    if (!explicitTargets && (scope === "book-style" || scope === "page-style"))
      selector =
        (scope === "page-style"
          ? `:where([data-folio-page-key="${pageFor(target).dataset.folioPageKey}"]) `
          : "") + `[data-folio-style="${target.dataset.folioStyle}"]`;
    else {
      const group = `g${Date.now().toString(36)}${sharedRules.length}`;
      targets.forEach((el) => {
        el.dataset.folioGroups =
          `${el.dataset.folioGroups || ""} ${group}`.trim();
      });
      selector = `[data-folio-groups~="${group}"]`;
    }
    targets.forEach((el) => {
      const d = ruleData(el),
        key = graphic ? "graphicStyles" : "styles";
      Object.keys(common).forEach((property) => {
        if (d[key]) delete d[key][property];
      });
      if (el.hasAttribute("data-folio-overrides"))
        el.dataset.folioOverrides = JSON.stringify(d);
      el.dataset.folioStyleEdited = "";
    });
    // Reuse an existing class rule but place it last to supersede older batches.
    const prior = sharedRules.find(
      (r) => r.selector === selector && r.graphic === graphic,
    );
    sharedRules = sharedRules.filter((r) => r !== prior);
    sharedRules.push({
      selector,
      graphic,
      styles: { ...prior?.styles, ...common },
    });
    rebuildRules();
  };
  const describe = (el) => {
    const cs = getComputedStyle(el);
    const image = el.tagName === "IMG" || cs.backgroundImage !== "none";
    return {
      id: el.dataset.folioId,
      kind: kindOf(el),
      label: (el.matches(".cn-brand-graphic")
        ? "品牌暗纹（SVG）"
        : image
          ? el.getAttribute("alt") || "图片"
          : el.textContent.trim() ||
            (el instanceof SVGSVGElement ? "矢量图形" : "色块")
      )
        .replace(/\s+/g, " ")
        .slice(0, 54),
      tag: el.tagName.toLowerCase(),
    };
  };
  const graphicInk = (el) => el.querySelector(".cn-brand-ink") || el;
  const measureGraphic = (el) => {
    const ink = graphicInk(el),
      matrix = ink.transform?.baseVal.consolidate()?.matrix || new DOMMatrix(),
      box = ink.getBBox();
    return {
      baseTransform: [
        matrix.a,
        matrix.b,
        matrix.c,
        matrix.d,
        matrix.e,
        matrix.f,
      ],
      center: [
        matrix.a * (box.x + box.width / 2) +
          matrix.c * (box.y + box.height / 2) +
          matrix.e,
        matrix.b * (box.x + box.width / 2) +
          matrix.d * (box.y + box.height / 2) +
          matrix.f,
      ],
    };
  };
  const graphicInfo = (el) => {
    const ink = graphicInk(el),
      cs = getComputedStyle(ink);
    let meta = {};
    try {
      meta = JSON.parse(el.dataset.folioGraphic || "{}");
    } catch {
      /* initial graphic */
    }
    return {
      brand: ink !== el,
      opacity: Math.round(Number(cs.opacity) * 100),
      scale: (meta.scale || 1) * 100,
      rotation: meta.rotation || 0,
      color: rgbaToHex(cs.color),
    };
  };
  const editGraphic = (el, value) => {
    const ink = graphicInk(el);
    let meta = {};
    try {
      meta = JSON.parse(el.dataset.folioGraphic || "{}");
    } catch {
      /* initial graphic */
    }
    if (!meta.baseTransform) {
      // getBBox() on a display:none page is zero in Chromium. Measure before
      // navigation hides pages, then keep that source geometry for all edits.
      Object.assign(
        meta,
        JSON.parse(
          el.dataset.folioGraphicBase || JSON.stringify(measureGraphic(el)),
        ),
      );
    }
    if (value.scale !== undefined)
      meta.scale = clip(Number(value.scale) / 100, 0.05, 10);
    if (value.rotation !== undefined)
      meta.rotation = Number(value.rotation) || 0;
    const base = new DOMMatrix(meta.baseTransform),
      [cx, cy] = meta.center;
    const transformed = new DOMMatrix()
      .translate(cx, cy)
      .rotate(meta.rotation || 0)
      .scale(meta.scale || 1)
      .translate(-cx, -cy)
      .multiply(base);
    ink.setAttribute(
      "transform",
      `matrix(${transformed.a} ${transformed.b} ${transformed.c} ${transformed.d} ${transformed.e} ${transformed.f})`,
    );
    el.dataset.folioGraphic = JSON.stringify(meta);
  };
  const replaceSvg = (el, text) => {
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = parsed.documentElement;
    if (svg.localName !== "svg" || parsed.querySelector("parsererror"))
      throw new Error("这个文件不是有效的 SVG。");
    svg
      .querySelectorAll(
        "script,style,foreignObject,iframe,image,use,animate,animateTransform,set",
      )
      .forEach((node) => node.remove());
    svg.querySelectorAll("*").forEach((node) =>
      [...node.attributes].forEach((attribute) => {
        const urls = [...attribute.value.matchAll(/url\(([^)]+)\)/gi)];
        if (
          /^on|href$/i.test(attribute.name) ||
          urls.some(
            (match) =>
              !match[1]
                .trim()
                .replace(/^["']|["']$/g, "")
                .startsWith("#"),
          )
        )
          node.removeAttribute(attribute.name);
      }),
    );
    const prefix = `folio-svg-${el.dataset.folioId}-${Date.now()}-`;
    const ids = [...svg.querySelectorAll("[id]")].map((node) => node.id);
    svg.querySelectorAll("*").forEach((node) =>
      [...node.attributes].forEach((attr) => {
        let value = attr.value;
        if (attr.name === "id") value = prefix + value;
        else
          ids.forEach((id) => {
            value = value.split(`url(#${id})`).join(`url(#${prefix}${id})`);
          });
        node.setAttribute(attr.name, value);
      }),
    );
    const ink = graphicInk(el);
    if (ink !== el) {
      const oldBox = ink.getBBox();
      const values = (
        svg.getAttribute("viewBox") ||
        `0 0 ${parseFloat(svg.getAttribute("width")) || 100} ${parseFloat(svg.getAttribute("height")) || 100}`
      )
        .trim()
        .split(/[ ,]+/)
        .map(Number);
      const [x, y, w, h] = values;
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0)
        throw new Error("SVG 需要有效的 viewBox 尺寸。");
      const scale = Math.min(oldBox.width / w, oldBox.height / h);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("fill", "currentColor");
      svg.querySelectorAll("[fill],[stroke]").forEach((node) => {
        for (const property of ["fill", "stroke"])
          if (
            node.hasAttribute(property) &&
            node.getAttribute(property) !== "none"
          )
            node.setAttribute(property, "currentColor");
      });
      group.setAttribute(
        "transform",
        `translate(${oldBox.x + (oldBox.width - w * scale) / 2 - x * scale} ${oldBox.y + (oldBox.height - h * scale) / 2 - y * scale}) scale(${scale})`,
      );
      [...svg.childNodes].forEach((node) =>
        group.append(document.importNode(node, true)),
      );
      ink.replaceChildren(group);
    } else {
      if (svg.hasAttribute("viewBox"))
        el.setAttribute("viewBox", svg.getAttribute("viewBox"));
      for (const attr of [
        "fill",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
      ]) {
        const value =
          svg.getAttribute(attr) || svg.style.getPropertyValue(attr);
        if (value && !value.includes("url(")) el.setAttribute(attr, value);
        else el.removeAttribute(attr);
      }
      el.replaceChildren(
        ...[...svg.childNodes].map((node) => document.importNode(node, true)),
      );
    }
  };
  const recolorGraphic = (el) => {
    graphicInk(el)
      .querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line,text")
      .forEach((node) => {
        if (node.closest("defs")) return;
        const cs = getComputedStyle(node);
        if (cs.fill !== "none") node.setAttribute("fill", "currentColor");
        if (cs.stroke !== "none") node.setAttribute("stroke", "currentColor");
      });
  };
  const selectionInfo = () => {
    if (!selected) return null;
    const r = selected.getBoundingClientRect(),
      p = pageFor(selected).getBoundingClientRect(),
      cs = getComputedStyle(selected);
    return {
      ...describe(selected),
      sourceId:
        selected.closest("[data-source-id]")?.getAttribute("data-source-id") || null,
      editId: selected.closest("[data-edit-id]")?.getAttribute("data-edit-id") || null,
      traceable: traceability(selected),
      text: selected.textContent,
      image: selected.tagName === "IMG" || cs.backgroundImage !== "none",
      x: Math.round(r.left - p.left),
      y: Math.round(r.top - p.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      fontSize: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
      fontFamily: cs.fontFamily,
      color: rgbaToHex(cs.color),
      background: rgbaToHex(cs.backgroundColor),
      align: cs.textAlign,
      wrap: cs.getPropertyValue("text-wrap-style") || "auto",
      wrapSupport: {
        pretty: CSS.supports("text-wrap", "pretty"),
        balance: CSS.supports("text-wrap", "balance"),
      },
      bold: parseInt(cs.fontWeight) >= 600 || cs.fontWeight === "bold",
      italic: cs.fontStyle === "italic",
      letterSpacing: parseFloat(cs.letterSpacing) || 0,
      kind: kindOf(selected),
      originalFont: originalData(selected).fontFamily || cs.fontFamily,
      styleLabel:
        selected.tagName.toLowerCase() +
        [...selected.classList]
          .filter((c) => !c.startsWith("folio-"))
          .map((c) => "." + c)
          .join(""),
      scopes: scopeInfo(),
      graphic: selected instanceof SVGSVGElement ? graphicInfo(selected) : null,
    };
  };
  const pageInfo = () =>
    pages.map((p, i) => {
      const r = p.getBoundingClientRect();
      if (r.width && r.height)
        pageSizes.set(p, { width: r.width, height: r.height });
      const size = pageSizes.get(p) || { width: 794, height: 1123 };
      const titleElement =
        p.querySelector("h1,h2,.cn-disp,.cn-ttl,[data-page-title]") ||
        p.querySelector("h3,.cn-h");
      const titleCopy = titleElement?.cloneNode(true);
      titleCopy?.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
      const title = titleCopy?.textContent.trim() || `第 ${i + 1} 页`;
      return {
        id: p.id || `page-${i + 1}`,
        title: title.replace(/\s+/g, " ").slice(0, 55),
        width: Math.round(size.width),
        height: Math.round(size.height),
        color: rgbaToHex(getComputedStyle(p).backgroundColor),
      };
    });
  const warningCount = () => {
    let n = 0;
    candidates
      .filter(
        (el) =>
          pageFor(el) === pages[pageIndex] &&
          (el.hasAttribute("data-folio-overrides") ||
            el.hasAttribute("data-folio-style-edited") ||
            el.hasAttribute("data-folio-content-edited")),
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect(),
          p = pages[pageIndex].getBoundingClientRect();
        if (
          r.left < p.left - 2 ||
          r.right > p.right + 2 ||
          r.top < p.top - 2 ||
          r.bottom > p.bottom + 2 ||
          (el.scrollHeight > el.clientHeight + 3 &&
            getComputedStyle(el).overflow === "hidden")
        )
          n++;
      });
    return n;
  };
  // handbook-designer 编辑包：读取构建标记；判断所选对象能否按 ID 写回手册源文件。
  const hbSource = () => {
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || null;
    const build = meta("hb-build");
    return build ? { build, lang: meta("hb-lang"), title: meta("hb-title") } : null;
  };
  const traceability = (el) => {
    const styleTarget = el.matches("[data-edit-id],[data-source-id],.page");
    const texts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (n.textContent.trim()) texts.push(n);
    const text =
      texts.length === 0 ||
      texts.every((n) => n.parentElement.closest("[data-source-id]"));
    const image = el.tagName !== "IMG" || el.hasAttribute("data-edit-id");
    return { text, style: styleTarget, image };
  };
  const emitState = () =>
    send("state", {
      state: {
        source: hbSource(),
        pages: pageInfo(),
        page: pageIndex,
        selection: selectionInfo(),
        objects: candidates
          .filter((el) => pageFor(el) === pages[pageIndex])
          .map(describe),
        undo: undo.length > 0,
        redo: redo.length > 0,
        warnings: warningCount(),
        documentFonts: [...documentFonts.values()],
      },
    });
  const updateOutline = () => {
    if (!outline) return;
    if (!selected || editing) {
      outline.hidden = true;
      return;
    }
    const r = selected.getBoundingClientRect();
    outline.hidden = false;
    outline.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
    label.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
  };
  const select = (el) => {
    finishText();
    selected = el;
    updateOutline();
    emitState();
  };
  const showPage = (index) => {
    finishText();
    pageIndex = clip(index, 0, pages.length - 1);
    selected = null;
    pages.forEach((p, i) => {
      if (i === pageIndex) p.removeAttribute("data-folio-hidden");
      else p.setAttribute("data-folio-hidden", "");
    });
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    window.scrollTo(0, 0);
    updateOutline();
    emitState();
  };
  function finishText() {
    if (!editing) return;
    const el = editing;
    editing = null;
    const old = el.dataset.folioEditing;
    if (old === "") el.removeAttribute("contenteditable");
    else el.setAttribute("contenteditable", old);
    delete el.dataset.folioEditing;
    el.dataset.folioContentEdited = "";
    el.blur();
    // Runtime-computed heights in handbook text blocks need to follow new copy.
    if (
      el.scrollHeight > el.clientHeight + 2 &&
      getComputedStyle(el).overflow === "hidden"
    )
      apply(el, {
        styles: { height: "auto", "min-height": `${el.clientHeight}px` },
      });
    commit();
  }
  const startText = () => {
    if (
      !selected ||
      selected.tagName === "IMG" ||
      selected instanceof SVGSVGElement ||
      getComputedStyle(selected).backgroundImage !== "none"
    )
      return;
    checkpoint();
    editing = selected;
    editing.dataset.folioEditing =
      editing.getAttribute("contenteditable") || "";
    editing.setAttribute("contenteditable", "true");
    editing.focus();
    const range = document.createRange();
    range.selectNodeContents(editing);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    updateOutline();
  };
  const beginDrag = (event, resize = false) => {
    if (!selected || editing || event.button !== 0) return;
    event.preventDefault();
    checkpoint();
    const cs = getComputedStyle(selected),
      d = ruleData(selected),
      r = selected.getBoundingClientRect();
    drag = {
      x: event.clientX,
      y: event.clientY,
      dx: d.dx || 0,
      dy: d.dy || 0,
      width: r.width,
      height: r.height,
      baseTransform:
        d.baseTransform ?? (cs.transform === "none" ? "" : cs.transform),
      resize,
      moved: false,
    };
    event.target.setPointerCapture?.(event.pointerId);
  };
  const init = async () => {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    pages = [...document.querySelectorAll(".page")].filter(
      (el) => !el.parentElement.closest(".page"),
    );
    if (!pages.length) pages = [...document.querySelectorAll("[data-page]")];
    if (!pages.length) {
      let wrapper = document.querySelector("[data-folio-document]");
      if (!wrapper) {
        wrapper = document.createElement("main");
        wrapper.dataset.folioDocument = "";
        [...document.body.childNodes].forEach((n) => {
          if (!(n instanceof Element) || !n.matches("script,style"))
            wrapper.append(n);
        });
        document.body.append(wrapper);
      }
      const w = Math.max(320, Math.min(wrapper.scrollWidth || 794, 2400));
      wrapper.style.width ||= `${w}px`;
      wrapper.style.minHeight ||= "1123px";
      pages = [wrapper];
    }
    // Clear any previous studio instance without changing document styling.
    document.querySelectorAll(`[${runtimeId}]`).forEach((el) => el.remove());
    style = document.createElement("style");
    style.setAttribute(runtimeId, "");
    style.textContent = `html{scrollbar-width:none}body{display:block!important;min-width:0!important}[data-folio-hidden]{display:none!important}.page{margin:0!important;flex-shrink:0!important} [data-folio-editing]{outline:2px solid #164be8!important;cursor:text!important;user-select:text!important} [data-folio-runtime="overlay"]{position:fixed;inset:0;z-index:2147483646;pointer-events:none} #folio-outline{border:2px solid #164be8;box-sizing:border-box;pointer-events:none} #folio-outline:before,#folio-outline:after{content:'';position:absolute;width:7px;height:7px;background:white;border:1.5px solid #164be8;top:-5px} #folio-outline:before{left:-5px} #folio-outline:after{right:-5px} #folio-handle{position:absolute;right:-6px;bottom:-6px;width:10px;height:10px;background:white;border:2px solid #164be8;pointer-events:auto;cursor:nwse-resize;touch-action:none} #folio-size{position:absolute;bottom:-26px;left:0;white-space:nowrap;padding:3px 5px;background:#164be8;color:white;font:11px/1.2 system-ui;letter-spacing:0} @media print{[data-folio-runtime]{display:none!important}[data-folio-hidden]{display:block!important}.page{margin:0!important;box-shadow:none!important}body{margin:0!important;padding:0!important}}`;
    style.textContent +=
      ".cn-brand-graphic .cn-brand-ink path,.cn-brand-graphic .cn-brand-ink rect,.cn-brand-graphic .cn-brand-ink polygon,.cn-brand-graphic .cn-brand-ink line{pointer-events:visiblePainted!important}";
    document.head.append(style);
    overlay = document.createElement("div");
    overlay.setAttribute(runtimeId, "overlay");
    overlay.innerHTML =
      '<div id="folio-outline" hidden><span id="folio-size"></span><span id="folio-handle" aria-label="调整尺寸"></span></div>';
    document.body.append(overlay);
    outline = overlay.firstElementChild;
    label = document.getElementById("folio-size");
    handle = document.getElementById("folio-handle");
    pageInfo();
    assignNodes();
    rebuildRules();
    showPage(0);
    send("ready");
    send("snapshot", { html: serialize(), initial: true });
    document.addEventListener(
      "click",
      (e) => {
        if (e.target.closest("a")) e.preventDefault();
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target === handle) {
          beginDrag(e, true);
          return;
        }
        if (skip(e.target)) return;
        if (editing) {
          if (editing.contains(e.target)) return;
          finishText();
        }
        const el =
          candidates.find((c) => c === e.target) ||
          [...candidates].reverse().find((c) => c.contains(e.target));
        if (!el) {
          select(null);
          return;
        }
        if (selected !== el) select(el);
        if (e.detail < 2) beginDrag(e);
      },
      true,
    );
    document.addEventListener("pointermove", (e) => {
      if (!drag || !selected) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 2 && !drag.moved) return;
      drag.moved = true;
      if (drag.resize) {
        const w = Math.max(20, Math.round(drag.width + dx));
        const h = Math.max(16, Math.round(drag.height + dy));
        apply(selected, {
          styles: {
            width: `${w}px`,
            height: `${h}px`,
            "box-sizing": "border-box",
            "max-width": "none",
          },
        });
      } else {
        const snap = e.altKey
          ? (v) => Math.round(v)
          : (v) => Math.round(v / 4) * 4;
        apply(selected, {
          dx: snap(drag.dx + dx),
          dy: snap(drag.dy + dy),
          baseTransform: drag.baseTransform,
        });
      }
      updateOutline();
    });
    const endDrag = () => {
      if (!drag) return;
      if (!drag.moved) undo.pop();
      drag = null;
      commit();
    };
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    document.addEventListener(
      "dblclick",
      (e) => {
        if (selected && selected.contains(e.target)) {
          e.preventDefault();
          startText();
        }
      },
      true,
    );
    document.addEventListener("focusout", () => {
      if (editing)
        setTimeout(() => {
          if (editing && !editing.contains(document.activeElement))
            finishText();
        }, 0);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        finishText();
        select(null);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !editing &&
        ["z", "y"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        history(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
      }
      if (
        !editing &&
        selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        checkpoint();
        const d = ruleData(selected),
          step = e.shiftKey ? 10 : 1,
          cs = getComputedStyle(selected);
        apply(selected, {
          dx:
            (d.dx || 0) +
            (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0),
          dy:
            (d.dy || 0) +
            (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0),
          baseTransform:
            d.baseTransform ?? (cs.transform === "none" ? "" : cs.transform),
        });
        commit();
      }
    });
    window.addEventListener("scroll", updateOutline);
    window.addEventListener("resize", updateOutline);
    window.addEventListener("blur", finishText);
  };
  const history = (direction) => {
    finishText();
    const from = direction === "undo" ? undo : redo,
      to = direction === "undo" ? redo : undo;
    if (!from.length) return;
    to.push(serialize());
    send("restore", { html: from.pop(), undo, redo, page: pageIndex });
  };
  window.addEventListener("message", (e) => {
    if (
      e.source !== parent ||
      e.origin !== parentOrigin ||
      e.data?.folio !== channel
    )
      return;
    const { action, value } = e.data;
    if (action === "page") showPage(value);
    if (action === "select")
      select(candidates.find((el) => el.dataset.folioId === value) || null);
    if (action === "editText") startText();
    if (action === "finishText") finishText();
    if (action === "history") history(value);
    if (action === "setHistory") {
      undo = value.undo;
      redo = value.redo;
      showPage(value.page);
    }
    if (action === "patch" && selected) {
      finishText();
      checkpoint();
      const d = ruleData(selected),
        cs = getComputedStyle(selected);
      if (value.x !== undefined || value.y !== undefined) {
        const r = selected.getBoundingClientRect(),
          p = pageFor(selected).getBoundingClientRect();
        apply(selected, {
          dx:
            (d.dx || 0) +
            (value.x !== undefined ? value.x - (r.left - p.left) : 0),
          dy:
            (d.dy || 0) +
            (value.y !== undefined ? value.y - (r.top - p.top) : 0),
          baseTransform:
            d.baseTransform ?? (cs.transform === "none" ? "" : cs.transform),
        });
      }
      if (value.styles)
        setStyles(selected, value.styles, value.scope || "single");
      if (value.text !== undefined) selected.textContent = value.text;
      commit();
    }
    if (action === "restoreFont" && selected) {
      checkpoint();
      const targets = scopeTargets(value?.scope || "single");
      const groups = new Map();
      targets.forEach((el) => {
        const family =
          originalData(el).fontFamily || getComputedStyle(el).fontFamily;
        if (!groups.has(family)) groups.set(family, []);
        groups.get(family).push(el);
      });
      groups.forEach((items, family) =>
        setStyles(
          selected,
          { "font-family": family },
          value?.scope || "single",
          false,
          targets.length > 1 ? items : null,
        ),
      );
      commit();
    }
    if (
      action === "installFont" &&
      selected &&
      selected.dataset.folioId === value.targetId
    ) {
      const target = selected,
        scope = value.scope || "single";
      checkpoint();
      let fontStyle = document.querySelector(
        `style[data-folio-font="${CSS.escape(value.id)}"]`,
      );
      if (!fontStyle) {
        fontStyle = document.createElement("style");
        fontStyle.dataset.folioFont = value.id;
        fontStyle.textContent = value.css;
        document.head.append(fontStyle);
      }
      Promise.all([
        document.fonts.load(`400 16px "${value.family}"`),
        document.fonts.load(`700 16px "${value.family}"`),
      ])
        .then(() => {
          setStyles(
            target,
            { "font-family": `"${value.family}", ${value.fallback}` },
            scope,
          );
          rememberFont(`"${value.family}", ${value.fallback}`, true);
          commit();
          send("fontReady");
        })
        .catch(() =>
          send("error", {
            message: "字体没有成功加载，请重试。原来的字体没有替换。",
          }),
        );
    }
    if (action === "graphic" && selected instanceof SVGSVGElement) {
      if (!graphicTransaction) checkpoint();
      const targets = scopeTargets(value.scope || "single");
      if (value.styles) {
        if (value.styles.color) targets.forEach(recolorGraphic);
        setStyles(
          selected,
          value.styles,
          value.scope || "single",
          graphicInk(selected) !== selected,
        );
      }
      if (value.scale !== undefined || value.rotation !== undefined)
        targets.forEach((el) => editGraphic(el, value));
      commit();
    }
    if (action === "beginGraphic" && selected instanceof SVGSVGElement) {
      checkpoint();
      graphicTransaction = true;
    }
    if (action === "endGraphic") {
      graphicTransaction = false;
      commit();
    }
    if (action === "replaceSvg" && selected instanceof SVGSVGElement) {
      try {
        checkpoint();
        replaceSvg(selected, value);
        commit();
      } catch (error) {
        undo.pop();
        send("error", { message: error.message });
      }
    }
    if (
      action === "image" &&
      selected &&
      typeof value === "string" &&
      /^data:image\//.test(value)
    ) {
      checkpoint();
      if (selected.tagName === "IMG") {
        selected.src = value;
        selected.removeAttribute("srcset");
      } else
        apply(selected, { styles: { "background-image": `url("${value}")` } });
      commit();
    }
    if (action === "reset" && selected) {
      checkpoint();
      delete selected.dataset.folioOverrides;
      if (selected instanceof SVGSVGElement && selected.dataset.folioGraphic) {
        const base = JSON.parse(selected.dataset.folioGraphicBase || "{}");
        if (base.baseTransform)
          graphicInk(selected).setAttribute(
            "transform",
            `matrix(${base.baseTransform.join(" ")})`,
          );
        delete selected.dataset.folioGraphic;
      }
      rebuildRules();
      commit();
    }
    if (action === "export") {
      finishText();
      send("export", { html: serialize() });
    }
    if (action === "print") {
      finishText();
      selected = null;
      updateOutline();
      window.print();
    }
  });
  if (document.readyState === "complete") init();
  else window.addEventListener("load", init, { once: true });
})();
