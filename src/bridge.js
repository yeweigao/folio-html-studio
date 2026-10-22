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
    style,
    gridLayer,
    guideLayer;
  let nodeSequence = 0,
    savedTimer;
  let backgroundTransaction = false;
  let layoutGrids = [],
    gridVisible = true;
  const pageSizes = new Map();
  const documentFonts = new Map();
  let sharedRules = [];
  let graphicTransaction = false;
  let documentColors = [];
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
  const parseCssColor = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].replace(/,/g, " ").replace(/\//g, " ").trim().split(/\s+/);
    if (parts.length < 3) return null;
    const channel = (part) => {
      const number = Number.parseFloat(part);
      return Number.isFinite(number)
        ? Math.max(0, Math.min(255, Math.round(part.includes("%") ? number * 2.55 : number)))
        : 0;
    };
    const rgb = parts.slice(0, 3).map(channel);
    const alpha = parts[3] ? Number.parseFloat(parts[3]) * (parts[3].includes("%") ? 0.01 : 1) : 1;
    return { rgb, alpha: Number.isFinite(alpha) ? alpha : 1 };
  };
  const scanDocumentColors = () => {
    const scores = new Map();
    const add = (cssValue, weight) => {
      const values = cssValue.match(/rgba?\([^)]+\)/gi) || [];
      values.forEach((value) => {
        const parsed = parseCssColor(value);
        if (!parsed || parsed.alpha < 0.16) return;
        const [red, green, blue] = parsed.rgb;
        const maximum = Math.max(red, green, blue),
          minimum = Math.min(red, green, blue);
        const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
        if (saturation < 0.12 || maximum > 247 || maximum < 22) return;
        const hex = `#${parsed.rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
        scores.set(hex, (scores.get(hex) || 0) + weight * parsed.alpha);
      });
    };
    pages.forEach((page) => {
      [page, ...page.querySelectorAll("*")].forEach((el) => {
        if (!(el instanceof HTMLElement || el instanceof SVGElement) || skip(el)) return;
        const computed = getComputedStyle(el);
        if (computed.display === "none" || computed.visibility === "hidden" || Number(computed.opacity) === 0) return;
        add(computed.backgroundColor, 2.4);
        add(computed.color, 0.75);
        add(computed.borderTopColor, 0.24);
        add(computed.backgroundImage, 0.45);
        if (el instanceof SVGElement) {
          add(computed.fill, 1.1);
          add(computed.stroke, 0.6);
        }
      });
    });
    return [...scores.entries()]
      .sort((first, second) => second[1] - first[1])
      .slice(0, 8)
      .map(([color]) => color);
  };
  const pageFor = (el) => pages.find((p) => p === el || p.contains(el));
  const ruleData = (el) => {
    try {
      return JSON.parse(el.dataset.folioOverrides || "{}");
    } catch {
      return {};
    }
  };
  const backgroundProperties = [
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
  ];
  const readBackground = (page) => {
    try {
      return JSON.parse(page.dataset.folioBackground || "null");
    } catch {
      return null;
    }
  };
  const backgroundInfo = (page) => {
    const value = page && readBackground(page);
    if (!value) return null;
    const opacity = Number(value.opacity ?? 30);
    return {
      id: value.id || "custom",
      label: value.label || "页面底纹",
      opacity: Math.round(Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) : 30),
      fit: value.fit === "contain" ? "contain" : "cover",
    };
  };
  const cssLayers = (value) => {
    const layers = [];
    let start = 0,
      depth = 0,
      quote = "";
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (quote) {
        if (char === "\\") i++;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === "'" || char === '"') quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        layers.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    const last = value.slice(start).trim();
    if (last) layers.push(last);
    return layers;
  };
  const captureBackgroundStyles = (page) =>
    Object.fromEntries(
      backgroundProperties.map((property) => [
        property,
        {
          value: page.style.getPropertyValue(property),
          priority: page.style.getPropertyPriority(property),
        },
      ]),
    );
  const setBackgroundStyle = (page, property, value) =>
    page.style.setProperty(property, value, "important");
  const backgroundUrl = (source) => `url("${source}")`;
  const xmlEscape = (value) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  const imageLayer = (source, opacity, page) => {
    const rect = page.getBoundingClientRect(),
      size = pageSizes.get(page) || {
        width: rect.width || 794,
        height: rect.height || 1123,
      },
      ratio = Math.max(0.1, Math.min(5, size.width / size.height));
    const width = 1000,
      height = Math.round(width / ratio),
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-folio-background-layer="1"><image x="0" y="0" width="${width}" height="${height}" href="${xmlEscape(source)}" preserveAspectRatio="xMidYMid slice" opacity="${Math.max(0, Math.min(100, opacity)) / 100}"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const updateLayerOpacity = (url, opacity) => {
    const comma = url.indexOf(",");
    if (!url.startsWith("data:image/svg+xml") || comma < 0) return url;
    try {
      const svg = decodeURIComponent(url.slice(comma + 1));
      if (!svg.includes('data-folio-background-layer="1"')) return url;
      const updated = svg.replace(
        /(<image\b[^>]*\bopacity=")[^"]*(")/,
        `$1${Math.max(0, Math.min(100, opacity)) / 100}$2`,
      );
      return `${url.slice(0, comma + 1)}${encodeURIComponent(updated)}`;
    } catch {
      return url;
    }
  };
  const firstBackgroundUrl = (value) => {
    const match = value.match(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/i);
    return match ? match[1] || match[2] || match[3].trim() : "";
  };
  const applyPageBackground = (page, value) => {
    const previous = readBackground(page),
      original = previous?.original || captureBackgroundStyles(page),
      computed = getComputedStyle(page),
      currentImages = previous
        ? cssLayers(page.style.getPropertyValue("background-image")).slice(1)
        : computed.backgroundImage === "none"
          ? []
          : cssLayers(computed.backgroundImage),
      currentSizes = previous
        ? cssLayers(page.style.getPropertyValue("background-size")).slice(1)
        : computed.backgroundImage === "none"
          ? []
          : cssLayers(computed.backgroundSize),
      currentPositions = previous
        ? cssLayers(page.style.getPropertyValue("background-position")).slice(1)
        : computed.backgroundImage === "none"
          ? []
          : cssLayers(computed.backgroundPosition),
      currentRepeats = previous
        ? cssLayers(page.style.getPropertyValue("background-repeat")).slice(1)
        : computed.backgroundImage === "none"
          ? []
          : cssLayers(computed.backgroundRepeat),
      opacity = Math.max(0, Math.min(100, Number(value.opacity ?? 30)));
    const source = imageLayer(value.src, opacity, page),
      images = [backgroundUrl(source), ...currentImages],
      sizes = [value.fit === "contain" ? "contain" : "cover", ...currentSizes],
      positions = ["center", ...currentPositions],
      repeats = ["no-repeat", ...currentRepeats];
    setBackgroundStyle(page, "background-image", images.join(", "));
    setBackgroundStyle(page, "background-size", sizes.join(", "));
    setBackgroundStyle(page, "background-position", positions.join(", "));
    setBackgroundStyle(page, "background-repeat", repeats.join(", "));
    page.dataset.folioBackground = JSON.stringify({
      id: value.id || "custom",
      label: value.label || "页面底纹",
      opacity,
      fit: value.fit === "contain" ? "contain" : "cover",
      original,
    });
  };
  const updatePageBackground = (page, patch) => {
    const background = readBackground(page);
    if (!background) return;
    if (patch.opacity !== undefined) {
      const layers = cssLayers(page.style.getPropertyValue("background-image"));
      const source = updateLayerOpacity(
        firstBackgroundUrl(layers[0] || ""),
        patch.opacity,
      );
      if (source) {
        layers[0] = backgroundUrl(source);
        setBackgroundStyle(page, "background-image", layers.join(", "));
      }
      background.opacity = Math.max(0, Math.min(100, Number(patch.opacity)));
    }
    if (patch.fit !== undefined) {
      const layers = cssLayers(page.style.getPropertyValue("background-size"));
      layers[0] = patch.fit === "contain" ? "contain" : "cover";
      setBackgroundStyle(page, "background-size", layers.join(", "));
      background.fit = patch.fit === "contain" ? "contain" : "cover";
    }
    page.dataset.folioBackground = JSON.stringify(background);
  };
  const removePageBackground = (page) => {
    const background = readBackground(page);
    if (!background) return;
    backgroundProperties.forEach((property) => {
      const original = background.original?.[property];
      if (original?.value)
        page.style.setProperty(property, original.value, original.priority || "");
      else page.style.removeProperty(property);
    });
    delete page.dataset.folioBackground;
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
      if (scope === "page-heading" || scope === "book-heading")
        return (
          kind === "text" &&
          /^H[1-6]$/.test(target.tagName) &&
          el.tagName === target.tagName &&
          (scope === "book-heading" || pageFor(el) === pageFor(target))
        );
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
            ...(/^H[1-6]$/.test(selected.tagName)
              ? [
                  ["page-heading", "本页同级标题"],
                  ["book-heading", "全册同级标题"],
                ]
              : []),
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
    "text-decoration-line",
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
      fontWeight: Number.parseFloat(cs.fontWeight) || (cs.fontWeight === "bold" ? 700 : 400),
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
      underline: cs.textDecorationLine.split(/\s+/).includes("underline"),
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
  // ---- Layout grid and snapping ------------------------------------------
  const snapDistance = 7;
  const baseGrid = 4;
  const edgeTolerance = 4;
  const clusterEdges = (values) => {
    const clusters = [];
    [...values]
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .forEach((value) => {
        const last = clusters[clusters.length - 1];
        if (last && value - last.max <= edgeTolerance) {
          last.sum += value;
          last.max = value;
          last.count++;
          last.value = last.sum / last.count;
        } else clusters.push({ value, sum: value, max: value, count: 1 });
      });
    return clusters;
  };
  const uniqueEdges = (values) => {
    const out = [];
    [...values]
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .forEach((value) => {
        if (!out.length || value - out[out.length - 1] > 0.6)
          out.push(value);
      });
    return out;
  };
  const rectInPage = (el, page) => {
    const rect = el.getBoundingClientRect(),
      origin = page.getBoundingClientRect();
    return {
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
      width: rect.width,
      height: rect.height,
    };
  };
  const candidateBlocks = (page) =>
    candidates.filter(
      (el) =>
        pageFor(el) === page &&
        !el.parentElement?.closest("[data-folio-id]"),
    );
  const gridTracks = (el) => {
    const cs = getComputedStyle(el);
    if (!cs.display.includes("grid")) return null;
    const widths = cs.gridTemplateColumns
      .split(/\s+/)
      .map((track) => Number.parseFloat(track))
      .filter((width) => Number.isFinite(width) && width > 0);
    if (widths.length < 2 || widths.length > 8) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const gapValue = Number.parseFloat(cs.columnGap);
    const gap = Number.isFinite(gapValue) ? gapValue : 0;
    const borderLeft = Number.parseFloat(cs.borderLeftWidth) || 0,
      borderRight = Number.parseFloat(cs.borderRightWidth) || 0,
      paddingLeft = Number.parseFloat(cs.paddingLeft) || 0,
      paddingRight = Number.parseFloat(cs.paddingRight) || 0;
    const available =
      rect.width - borderLeft - borderRight - paddingLeft - paddingRight;
    const used =
      widths.reduce((sum, width) => sum + width, 0) +
      gap * (widths.length - 1);
    if (available <= 0 || used > available + 3) return null;
    const scale = available / used;
    return {
      widths: widths.map((width) => width * scale),
      gap: gap * scale,
      rect,
      inset: borderLeft + paddingLeft,
    };
  };
  const readContentMargins = (entries) => {
    const lefts = [],
      rights = [];
    entries.forEach(({ page, rect }) => {
      if (!rect.width) return;
      [...page.children].forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const block = el.getBoundingClientRect();
        if (block.width < 8 || block.height < 8) return;
        const left = block.left - rect.left,
          right = rect.right - block.right;
        if (left > 1 && left < rect.width * 0.35) lefts.push(left);
        if (right > 1 && right < rect.width * 0.35) rights.push(right);
      });
    });
    const fallback = Math.round((entries[0]?.rect.width || 794) * 0.07);
    const pick = (values) => {
      const cluster = clusterEdges(values).sort(
        (a, b) => b.count - a.count || a.value - b.value,
      )[0];
      return cluster ? cluster.value : null;
    };
    let left = pick(lefts),
      right = pick(rights);
    if (left == null && right == null) left = right = fallback;
    else if (left == null) left = right;
    else if (right == null) right = left;
    return { left, right };
  };
  const readPageGrid = (entries) => {
    const found = [];
    entries.forEach(({ page, rect }) => {
      const pageWidth = rect.width,
        pageHeight = rect.height;
      if (!pageWidth || !pageHeight) return;
      [...page.querySelectorAll("*")].forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const template = gridTracks(el);
        if (!template) return;
        const grid = template.rect;
        if (grid.width < pageWidth * 0.78) return;
        const left = grid.left - rect.left,
          right = rect.right - grid.right;
        if (left < 0 || right < 0) return;
        if (left > pageWidth * 0.3 || right > pageWidth * 0.3) return;
        const direct = el.parentElement === page;
        const named = /(^|[-_ ])(?:ed-grid|layout-grid|page-grid)(?:$|[-_ ])/.test(
          String(el.className),
        );
        if (!direct && !named) return;
        // Layout grids are modular: equal tracks. Content tables have mixed
        // widths and must not redefine the page grid.
        if (
          Math.max(...template.widths) - Math.min(...template.widths) >
          Math.max(2, template.widths[0] * 0.04)
        )
          return;
        if (direct && !named && grid.height < pageHeight * 0.25) return;
        let x = left + template.inset;
        const columns = template.widths.map((width) => {
          const column = { start: x, end: x + width };
          x += width + template.gap;
          return column;
        });
        const start = columns[0].start,
          end = columns[columns.length - 1].end;
        if (start < -2 || end > pageWidth + 2) return;
        found.push({
          page,
          pageWidth,
          columns,
          gap: template.gap,
          marginLeft: start,
          marginRight: pageWidth - end,
          direct,
          named,
          area: grid.width * grid.height,
          signature: `${columns.length}:${Math.round(template.gap)}:${Math.round(
            start,
          )}:${Math.round(pageWidth - end)}`,
        });
      });
    });
    if (!found.length) return null;
    const groups = new Map();
    found.forEach((item) => {
      const group = groups.get(item.signature) || {
        items: [],
        pages: new Set(),
      };
      group.items.push(item);
      group.pages.add(item.page);
      groups.set(item.signature, group);
    });
    const group = [...groups.values()].sort(
      (a, b) =>
        b.pages.size - a.pages.size ||
        b.items.length - a.items.length ||
        Number(b.items.some((item) => item.named)) -
          Number(a.items.some((item) => item.named)) ||
        Math.max(...b.items.map((item) => item.area)) -
          Math.max(...a.items.map((item) => item.area)),
    )[0];
    return group.items.sort(
      (a, b) => Number(b.direct) - Number(a.direct) || b.area - a.area,
    )[0];
  };
  const readGridVars = () => {
    const cs = getComputedStyle(document.body);
    const read = (name) => {
      const value = Number.parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(value) ? value : 0;
    };
    return { gutter: read("--gut"), rhythm: read("--lh") };
  };
  const readRhythm = (blocks) => {
    const scores = new Map();
    blocks.forEach(({ el }) => {
      if (kindOf(el) !== "text") return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cs = getComputedStyle(el),
        size = Number.parseFloat(cs.fontSize),
        height = Number.parseFloat(cs.lineHeight);
      if (!Number.isFinite(height) || height < 8 || height > 56) return;
      const value = Math.round(height);
      scores.set(value, (scores.get(value) || 0) + (size <= 30 ? 2 : 1));
    });
    const best = [...scores.entries()].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )[0];
    return best && best[1] >= 2 ? best[0] : 0;
  };
  const buildLayoutGrid = () => {
    const entries = pages.map((page) => ({
      page,
      rect: page.getBoundingClientRect(),
    }));
    const visible = entries.filter((entry) => entry.rect.width > 0);
    if (!visible.length) {
      layoutGrids = [];
      return;
    }
    const baseWidth = visible[0].rect.width;
    const margins = readContentMargins(visible);
    const explicit = readPageGrid(visible);
    const vars = readGridVars();
    const rhythm =
      vars.rhythm >= 8 && vars.rhythm <= 56
        ? Math.round(vars.rhythm)
        : readRhythm(
            visible.flatMap(({ page }) =>
              candidates
                .filter((el) => pageFor(el) === page)
                .map((el) => ({ el })),
            ),
          );
    layoutGrids = entries.map(({ rect }) => {
      const width = rect.width || baseWidth,
        scale = width / baseWidth,
        height = rect.height || Math.round(baseWidth * 1.414);
      if (explicit) {
        const gridScale = width / explicit.pageWidth;
        return {
          width,
          height,
          columns: explicit.columns.map((column) => ({
            start: column.start * gridScale,
            end: column.end * gridScale,
          })),
          lines: uniqueEdges(
            explicit.columns.flatMap((column) => [column.start, column.end]),
          ).map((x) => x * gridScale),
          marginLeft: explicit.marginLeft * gridScale,
          marginRight: explicit.marginRight * gridScale,
          gutter: explicit.gap * gridScale,
          rhythm: rhythm ? Math.max(0, Math.round(rhythm * gridScale)) : 0,
          source: "css-grid",
        };
      }
      const marginLeft = Math.min(margins.left * scale, width * 0.4),
        marginRight = Math.min(margins.right * scale, width * 0.4),
        contentWidth = Math.max(0, width - marginLeft - marginRight),
        gutter = Math.max(
          0,
          (vars.gutter || 32 * (baseWidth / 794)) * scale,
        );
      let count = 6;
      while (
        count > 2 &&
        (contentWidth - (count - 1) * gutter) / count < 14
      )
        count--;
      const columnWidth = Math.max(
        0,
        (contentWidth - (count - 1) * gutter) / count,
      );
      const columns = [];
      for (let index = 0; index < count; index++) {
        const start = marginLeft + index * (columnWidth + gutter);
        columns.push({ start, end: start + columnWidth });
      }
      return {
        width,
        height,
        columns,
        lines: uniqueEdges(
          columns.flatMap((column) => [column.start, column.end]),
        ),
        marginLeft,
        marginRight,
        gutter,
        rhythm: rhythm ? Math.max(0, Math.round(rhythm * scale)) : 0,
        source: "typographic",
      };
    });
  };
  const gridInfo = () => {
    const grid = layoutGrids[pageIndex];
    if (!grid) return null;
    return {
      visible: gridVisible,
      columns: grid.columns.length,
      lines: grid.lines.length,
      source: grid.source,
      rhythm: grid.rhythm,
      gutter: Math.round(grid.gutter),
    };
  };
  const gridSvg = (parts) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" aria-hidden="true">${parts.join("")}</svg>`;
  const renderGrid = () => {
    if (!gridLayer) return;
    const page = pages[pageIndex],
      grid = layoutGrids[pageIndex];
    if (!gridVisible || !page || !grid) {
      gridLayer.hidden = true;
      return;
    }
    const rect = page.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      gridLayer.hidden = true;
      return;
    }
    gridLayer.hidden = false;
    gridLayer.style.left = `${rect.left}px`;
    gridLayer.style.top = `${rect.top}px`;
    gridLayer.style.width = `${rect.width}px`;
    gridLayer.style.height = `${rect.height}px`;
    const width = rect.width,
      height = rect.height,
      parts = [];
    grid.columns.forEach((column) => {
      parts.push(
        `<rect data-folio-grid-column="" x="${column.start}" y="0" width="${Math.max(
          0,
          column.end - column.start,
        )}" height="${height}" fill="#ff4d7d" fill-opacity=".03"/>`,
      );
    });
    const rhythmParts = [];
    if (grid.rhythm >= 8 && grid.rhythm <= 48)
      for (let y = grid.rhythm; y < height; y += grid.rhythm)
        rhythmParts.push(
          `<path d="M0 ${y}H${width}" stroke="#164be8" stroke-opacity=".06"/>`,
        );
    const lineParts = [];
    if (grid.columns.length)
      uniqueEdges(
        grid.columns.flatMap((column) => [column.start, column.end]),
      ).forEach((x) =>
        lineParts.push(
          `<path d="M${x} 0V${height}" stroke="#ff4d7d" stroke-opacity=".17"/>`,
        ),
      );
    else
      grid.lines.forEach((x) =>
        lineParts.push(
          `<path d="M${x} 0V${height}" stroke="#ff4d7d" stroke-opacity=".18"/>`,
        ),
      );
    parts.push(
      ...rhythmParts,
      ...lineParts,
      `<path d="M${grid.marginLeft} 0V${height}M${width - grid.marginRight} 0V${height}" stroke="#ff4d7d" stroke-opacity=".26" stroke-dasharray="3 3"/>`,
    );
    gridLayer.innerHTML = gridSvg(parts);
  };
  const snapPriority = { element: 0, grid: 1, page: 2 };
  const buildSnapLines = (page, excluded) => {
    const rect = page.getBoundingClientRect(),
      x = [
        { axis: "x", position: 0, kind: "page" },
        { axis: "x", position: rect.width / 2, kind: "page" },
        { axis: "x", position: rect.width, kind: "page" },
      ],
      y = [
        { axis: "y", position: 0, kind: "page" },
        { axis: "y", position: rect.height / 2, kind: "page" },
        { axis: "y", position: rect.height, kind: "page" },
      ];
    const grid = layoutGrids[pageIndex];
    if (grid && gridVisible) {
      grid.lines.forEach((position) =>
        x.push({ axis: "x", position, kind: "grid" }),
      );
      if (grid.rhythm >= 8 && grid.rhythm <= 48)
        for (let position = grid.rhythm; position < rect.height; position += grid.rhythm)
          y.push({ axis: "y", position, kind: "grid" });
    }
    candidateBlocks(page).forEach((el) => {
      if (
        el === excluded ||
        excluded?.contains(el) ||
        (el.contains(excluded) && el !== excluded)
      )
        return;
      const block = rectInPage(el, page);
      if (block.width < 2 || block.height < 2) return;
      [block.left, block.left + block.width / 2, block.right].forEach(
        (position) => {
          if (position < 0 || position > rect.width) return;
          x.push({
            axis: "x",
            position,
            kind: "element",
            rect: block,
          });
        },
      );
      [block.top, block.top + block.height / 2, block.bottom].forEach(
        (position) => {
          if (position < 0 || position > rect.height) return;
          y.push({
            axis: "y",
            position,
            kind: "element",
            rect: block,
          });
        },
      );
    });
    const compact = (lines) => {
      const map = new Map();
      lines.forEach((line) => {
        const key = Math.round(line.position * 2);
        const current = map.get(key);
        if (
          !current ||
          snapPriority[line.kind] < snapPriority[current.kind]
        )
          map.set(key, line);
      });
      return [...map.values()].sort(
        (a, b) => a.position - b.position,
      );
    };
    return { x: compact(x), y: compact(y) };
  };
  const findSnap = (anchors, lines, skipGridCenter = false) => {
    let best = null;
    anchors.forEach((value, index) => {
      lines.forEach((line) => {
        if (
          skipGridCenter &&
          index === 1 &&
          anchors.length === 3 &&
          line.kind === "grid"
        )
          return;
        const delta = line.position - value,
          distance = Math.abs(delta);
        if (distance > snapDistance) return;
        if (
          !best ||
          distance < Math.abs(best.delta) - 0.01 ||
          (Math.abs(distance - Math.abs(best.delta)) < 0.01 &&
            snapPriority[line.kind] < snapPriority[best.line.kind])
        )
          best = { delta, line };
      });
    });
    return best;
  };
  const clearGuides = () => {
    if (!guideLayer) return;
    guideLayer.hidden = true;
    guideLayer.replaceChildren();
  };
  const renderGuides = (lines, target, pageRect) => {
    if (!guideLayer) return;
    if (!lines.length) {
      clearGuides();
      return;
    }
    const parts = [];
    lines.forEach((line) => {
      const color = line.kind === "page" ? "#164be8" : "#ff3b6b",
        opacity = line.kind === "element" ? 0.92 : 0.66,
        strokeWidth = line.kind === "element" ? 1.5 : 1,
        dash = line.kind === "element" ? "" : ' stroke-dasharray="3 3"';
      if (line.axis === "x") {
        let from = 0,
          to = pageRect.height;
        if (line.rect) {
          from = Math.max(
            0,
            Math.min(target.top, line.rect.top) - 12,
          );
          to = Math.min(
            pageRect.height,
            Math.max(
              target.top + target.height,
              line.rect.top + line.rect.height,
            ) + 12,
          );
        }
        parts.push(
          `<path data-folio-guide="" d="M${pageRect.left + line.position} ${
            pageRect.top + from
          }V${pageRect.top + to}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}"${dash}/>`,
        );
      } else {
        let from = 0,
          to = pageRect.width;
        if (line.rect) {
          from = Math.max(
            0,
            Math.min(target.left, line.rect.left) - 12,
          );
          to = Math.min(
            pageRect.width,
            Math.max(
              target.left + target.width,
              line.rect.left + line.rect.width,
            ) + 12,
          );
        }
        parts.push(
          `<path data-folio-guide="" d="M${pageRect.left + from} ${
            pageRect.top + line.position
          }H${pageRect.left + to}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}"${dash}/>`,
        );
      }
    });
    guideLayer.hidden = false;
    guideLayer.innerHTML = gridSvg(parts);
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
        documentColors,
        background: backgroundInfo(pages[pageIndex]),
        grid: gridInfo(),
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
    clearGuides();
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
    clearGuides();
    updateOutline();
    renderGrid();
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
      r = selected.getBoundingClientRect(),
      page = pageFor(selected),
      p = page.getBoundingClientRect();
    drag = {
      x: event.clientX,
      y: event.clientY,
      dx: d.dx || 0,
      dy: d.dy || 0,
      width: r.width,
      height: r.height,
      startLeft: r.left - p.left,
      startTop: r.top - p.top,
      snapLines: buildSnapLines(page, selected),
      lastDx: d.dx || 0,
      lastDy: d.dy || 0,
      lastW: Math.round(r.width),
      lastH: Math.round(r.height),
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
    style.textContent +=
      "#folio-grid{position:absolute;overflow:hidden;pointer-events:none} #folio-guides{position:absolute;inset:0;pointer-events:none} #folio-grid svg,#folio-guides svg{display:block;width:100%;height:100%}";
    document.head.append(style);
    overlay = document.createElement("div");
    overlay.setAttribute(runtimeId, "overlay");
    overlay.innerHTML =
      '<div id="folio-outline" hidden><span id="folio-size"></span><span id="folio-handle" aria-label="调整尺寸"></span></div>';
    document.body.append(overlay);
    outline = overlay.firstElementChild;
    label = document.getElementById("folio-size");
    handle = document.getElementById("folio-handle");
    gridLayer = document.createElement("div");
    gridLayer.id = "folio-grid";
    gridLayer.setAttribute(runtimeId, "grid");
    gridLayer.hidden = true;
    overlay.prepend(gridLayer);
    guideLayer = document.createElement("div");
    guideLayer.id = "folio-guides";
    guideLayer.setAttribute(runtimeId, "guides");
    guideLayer.hidden = true;
    overlay.append(guideLayer);
    pageInfo();
    assignNodes();
    buildLayoutGrid();
    documentColors = scanDocumentColors();
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
      const page = pageFor(selected),
        p = page.getBoundingClientRect(),
        guides = [];
      let target;
      if (drag.resize) {
        let right = drag.startLeft + drag.width + dx,
          bottom = drag.startTop + drag.height + dy;
        if (!e.altKey) {
          const xSnap = findSnap([right], drag.snapLines.x);
          const ySnap = findSnap([bottom], drag.snapLines.y);
          if (xSnap) {
            right += xSnap.delta;
            guides.push({ ...xSnap.line, axis: "x" });
          } else right = Math.round(right / baseGrid) * baseGrid;
          if (ySnap) {
            bottom += ySnap.delta;
            guides.push({ ...ySnap.line, axis: "y" });
          } else bottom = Math.round(bottom / baseGrid) * baseGrid;
        }
        const w = Math.max(
            20,
            Math.round(right - drag.startLeft),
          ),
          h = Math.max(
            16,
            Math.round(bottom - drag.startTop),
          );
        target = {
          left: drag.startLeft,
          top: drag.startTop,
          width: w,
          height: h,
        };
        if (w !== drag.lastW || h !== drag.lastH) {
          apply(selected, {
            styles: {
              width: `${w}px`,
              height: `${h}px`,
              "box-sizing": "border-box",
              "max-width": "none",
            },
          });
          drag.lastW = w;
          drag.lastH = h;
        }
      } else {
        let left = drag.startLeft + dx,
          top = drag.startTop + dy;
        if (!e.altKey) {
          const xSnap = findSnap(
            [left, left + drag.width / 2, left + drag.width],
            drag.snapLines.x,
          );
          const ySnap = findSnap(
            [top, top + drag.height / 2, top + drag.height],
            drag.snapLines.y,
            true,
          );
          if (xSnap) {
            left += xSnap.delta;
            guides.push({ ...xSnap.line, axis: "x" });
          } else left = Math.round(left / baseGrid) * baseGrid;
          if (ySnap) {
            top += ySnap.delta;
            guides.push({ ...ySnap.line, axis: "y" });
          } else top = Math.round(top / baseGrid) * baseGrid;
        }
        target = {
          left,
          top,
          width: drag.width,
          height: drag.height,
        };
        const nextDx = drag.dx + (left - drag.startLeft),
          nextDy = drag.dy + (top - drag.startTop);
        if (
          nextDx !== drag.lastDx ||
          nextDy !== drag.lastDy
        ) {
          apply(selected, {
            dx: nextDx,
            dy: nextDy,
            baseTransform: drag.baseTransform,
          });
          drag.lastDx = nextDx;
          drag.lastDy = nextDy;
        }
      }
      renderGuides(guides, target, p);
      updateOutline();
    });
    const endDrag = () => {
      if (!drag) return;
      if (!drag.moved) undo.pop();
      drag = null;
      clearGuides();
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
    const syncOverlay = () => {
      updateOutline();
      renderGrid();
    };
    window.addEventListener("scroll", syncOverlay);
    window.addEventListener("resize", syncOverlay);
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
    if (action === "grid") {
      gridVisible = Boolean(value);
      renderGrid();
      clearGuides();
      emitState();
    }
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
    if (action === "beginBackground") {
      checkpoint();
      backgroundTransaction = true;
    }
    if (action === "endBackground") {
      backgroundTransaction = false;
      commit();
    }
    if (action === "background" && pages.length) {
      const mode = value?.mode || "apply",
        targets = value?.scope === "all" ? pages : [pages[pageIndex]];
      if (mode === "apply") {
        const source = value?.background?.src;
        if (
          typeof source !== "string" ||
          !/^data:image\/(?:svg\+xml|png|jpe?g|webp|gif)(?:;|,)/i.test(source) ||
          source.length > 20 * 1024 * 1024
        ) {
          send("error", { message: "底纹图片格式不支持，或文件超过 15 MB。" });
        } else {
          if (!backgroundTransaction) checkpoint();
          targets.forEach((page) =>
            applyPageBackground(page, value.background),
          );
          commit();
        }
      } else if (
        (mode === "opacity" || mode === "fit") &&
        targets.some((page) => readBackground(page))
      ) {
        if (!backgroundTransaction) checkpoint();
        targets.forEach((page) =>
          updatePageBackground(
            page,
            mode === "opacity"
              ? { opacity: value.opacity }
              : { fit: value.fit },
          ),
        );
        commit();
      } else if (
        mode === "remove" &&
        targets.some((page) => readBackground(page))
      ) {
        checkpoint();
        targets.forEach(removePageBackground);
        commit();
      }
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
