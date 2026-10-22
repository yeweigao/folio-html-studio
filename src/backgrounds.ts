export type BackgroundAsset = {
  id: string;
  label: string;
  family: string;
  src: string;
  opacity: number;
};

const svgData = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const shell = (content: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1414" viewBox="0 0 1000 1414"><defs>${defs}</defs>${content}</svg>`;

const presets: BackgroundAsset[] = [
  {
    id: "mist-blue",
    label: "雾光渐变",
    family: "弥散",
    opacity: 34,
    src: svgData(
      shell(
        `<ellipse cx="760" cy="300" rx="370" ry="300" fill="url(#blue)"/><ellipse cx="350" cy="720" rx="390" ry="300" fill="url(#cyan)"/><ellipse cx="680" cy="1100" rx="360" ry="280" fill="url(#violet)"/>`,
        `<radialGradient id="blue"><stop stop-color="#2869ff" stop-opacity=".78"/><stop offset=".48" stop-color="#49bdff" stop-opacity=".38"/><stop offset="1" stop-color="#8be5ff" stop-opacity="0"/></radialGradient><radialGradient id="cyan"><stop stop-color="#59dded" stop-opacity=".62"/><stop offset=".5" stop-color="#8de8ec" stop-opacity=".24"/><stop offset="1" stop-color="#8de8ec" stop-opacity="0"/></radialGradient><radialGradient id="violet"><stop stop-color="#8a78ff" stop-opacity=".5"/><stop offset="1" stop-color="#9d8bff" stop-opacity="0"/></radialGradient>`,
      ),
    ),
  },
  {
    id: "aurora-haze",
    label: "极光漫游",
    family: "弥散",
    opacity: 32,
    src: svgData(
      shell(
        `<ellipse cx="710" cy="480" rx="420" ry="250" transform="rotate(-32 710 480)" fill="url(#a)"/><ellipse cx="350" cy="830" rx="420" ry="270" transform="rotate(27 350 830)" fill="url(#b)"/><ellipse cx="820" cy="1120" rx="300" ry="210" transform="rotate(-25 820 1120)" fill="url(#c)"/>`,
        `<radialGradient id="a"><stop stop-color="#2262ed" stop-opacity=".8"/><stop offset=".48" stop-color="#56c6ff" stop-opacity=".4"/><stop offset="1" stop-color="#56c6ff" stop-opacity="0"/></radialGradient><radialGradient id="b"><stop stop-color="#36d5c4" stop-opacity=".54"/><stop offset=".56" stop-color="#70cfff" stop-opacity=".24"/><stop offset="1" stop-color="#70cfff" stop-opacity="0"/></radialGradient><radialGradient id="c"><stop stop-color="#a98bff" stop-opacity=".5"/><stop offset="1" stop-color="#a98bff" stop-opacity="0"/></radialGradient>`,
      ),
    ),
  },
  {
    id: "blue-ribbon",
    label: "蓝色绸幕",
    family: "流线",
    opacity: 30,
    src: svgData(
      shell(
        `<path d="M-80 630 C170 390 360 810 610 580 S900 390 1090 510 L1090 800 C850 660 760 900 510 850 S120 590 -80 850Z" fill="url(#r1)"/><path d="M-60 920 C210 720 320 1050 590 940 S850 700 1080 850 L1080 1070 C850 970 740 1160 480 1120 S120 880 -60 1080Z" fill="url(#r2)"/><g fill="none" stroke="#fff" stroke-width="2" opacity=".54"><path d="M-40 760 C210 530 350 920 600 700S930 530 1060 640"/><path d="M-40 780 C210 550 350 940 600 720S930 550 1060 660"/><path d="M-40 800 C210 570 350 960 600 740S930 570 1060 680"/><path d="M-40 820 C210 590 350 980 600 760S930 590 1060 700"/><path d="M-40 840 C210 610 350 1000 600 780S930 610 1060 720"/></g>`,
        `<linearGradient id="r1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4bd8eb" stop-opacity=".2"/><stop offset=".48" stop-color="#1564ee" stop-opacity=".84"/><stop offset="1" stop-color="#7c8cff" stop-opacity=".18"/></linearGradient><linearGradient id="r2" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#3bc8dc" stop-opacity=".14"/><stop offset=".55" stop-color="#2c75ff" stop-opacity=".76"/><stop offset="1" stop-color="#9b8bff" stop-opacity=".18"/></linearGradient>`,
      ),
    ),
  },
  {
    id: "tide-lines",
    label: "潮汐细线",
    family: "流线",
    opacity: 28,
    src: svgData(
      shell(
        `<path d="M-80 770 C120 610 250 660 410 820 S720 1030 1080 710" fill="none" stroke="url(#line)" stroke-width="3" opacity=".56"/>${Array.from({ length: 13 }, (_, i) => `<path d="M-80 ${790 + i * 17} C120 ${630 + i * 16} 250 ${680 + i * 13} 410 ${840 + i * 10} S720 ${1050 + i * 6} 1080 ${730 - i * 12}" fill="none" stroke="url(#line)" stroke-width="1.5" opacity="${0.42 - i * 0.018}"/>`).join("")}`,
        `<linearGradient id="line" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#3bc6df"/><stop offset=".48" stop-color="#2675ef"/><stop offset="1" stop-color="#9583eb"/></linearGradient>`,
      ),
    ),
  },
  {
    id: "glass-facets",
    label: "玻璃折面",
    family: "几何",
    opacity: 30,
    src: svgData(
      shell(
        `<path d="M0 710 335 500 468 885 170 1080Z" fill="#18c6e8" fill-opacity=".3"/><path d="M335 500 650 625 468 885Z" fill="#1268ed" fill-opacity=".42"/><path d="M650 625 1000 390 1000 880 755 1020 468 885Z" fill="url(#g1)"/><path d="M0 1020 170 1080 468 885 410 1270 0 1390Z" fill="#59d4e3" fill-opacity=".22"/><path d="M468 885 755 1020 640 1414 410 1270Z" fill="#255df0" fill-opacity=".24"/><path d="M755 1020 1000 880 1000 1414 640 1414Z" fill="#a5a3ff" fill-opacity=".25"/><g fill="none" stroke="#fff" stroke-width="3" opacity=".6"><path d="M335 500 468 885 755 1020"/><path d="M650 625 468 885 410 1270"/><path d="M170 1080 410 1270"/></g>`,
        `<linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7fe5eb" stop-opacity=".46"/><stop offset="1" stop-color="#3866ed" stop-opacity=".5"/></linearGradient>`,
      ),
    ),
  },
  {
    id: "city-glass",
    label: "未来光廊",
    family: "几何",
    opacity: 30,
    src: svgData(
      shell(
        `<path d="M50 940V590l160-112v462Z" fill="#35d5d3" fill-opacity=".3"/><path d="M210 940V478l90 62v490Z" fill="#1d83ef" fill-opacity=".38"/><path d="M310 1020V390l180 115v515Z" fill="#2f69ed" fill-opacity=".34"/><path d="M490 1000V505l115-82v577Z" fill="#67dce3" fill-opacity=".34"/><path d="M605 1000V423l135-110v687Z" fill="#91e8c8" fill-opacity=".28"/><path d="M740 1050V313l125 78v659Z" fill="#167cf0" fill-opacity=".34"/><path d="M865 1080V391l105-68v757Z" fill="#74e3df" fill-opacity=".38"/><path d="M-50 1120 300 960 500 1110 1000 890v270L460 1310 230 1190-50 1330Z" fill="url(#floor)"/><g stroke="#fff" stroke-width="3" opacity=".46"><path d="M210 478v462M310 390v630M490 505v495M605 423v577M740 313v737M865 391v689"/></g>`,
        `<linearGradient id="floor" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#4ed6d2" stop-opacity=".08"/><stop offset=".48" stop-color="#1568f2" stop-opacity=".42"/><stop offset="1" stop-color="#74dcff" stop-opacity=".16"/></linearGradient>`,
      ),
    ),
  },
  {
    id: "orbit-glass",
    label: "环形折光",
    family: "几何",
    opacity: 26,
    src: svgData(
      shell(
        `<circle cx="760" cy="745" r="330" fill="url(#orb)"/><circle cx="760" cy="745" r="250" fill="none" stroke="#2369ee" stroke-opacity=".42" stroke-width="80"/><circle cx="760" cy="745" r="155" fill="none" stroke="#73d9e8" stroke-opacity=".44" stroke-width="44"/><path d="M760 415a330 330 0 0 1 286 165L905 660a168 168 0 0 0-145-83Z" fill="#27a9f4" fill-opacity=".4"/><path d="M470 905a330 330 0 0 0 550 15L900 830a168 168 0 0 1-280-5Z" fill="#9b80f4" fill-opacity=".28"/><circle cx="760" cy="745" r="78" fill="#fff" fill-opacity=".56"/>`,
        `<radialGradient id="orb"><stop stop-color="#66dbe8" stop-opacity=".1"/><stop offset="1" stop-color="#4779f4" stop-opacity=".08"/></radialGradient>`,
      ),
    ),
  },
  {
    id: "diagonal-engraving",
    label: "斜线刻纹",
    family: "线纹",
    opacity: 27,
    src: svgData(
      shell(
        `<defs><pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path d="M0 0V14" stroke="#2d69df" stroke-opacity=".28" stroke-width="1"/></pattern><linearGradient id="fade" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#fff" stop-opacity=".88"/><stop offset="1" stop-color="#fff" stop-opacity=".15"/></linearGradient></defs><path d="M200 0H1000V850H200Z" fill="url(#p)"/><path d="M0 740 590 1400H0Z" fill="url(#p)" opacity=".72"/><path d="M0 0H1000V1414H0Z" fill="url(#fade)"/>`,
      ),
    ),
  },
  {
    id: "dot-field",
    label: "星点阵列",
    family: "线纹",
    opacity: 30,
    src: svgData(
      shell(
        `<defs><radialGradient id="fade"><stop stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></radialGradient></defs>${Array.from({ length: 100 }, (_, i) => { const x = 80 + (i % 10) * 88; const y = 470 + Math.floor(i / 10) * 88; const dist = Math.hypot(x - 720, y - 930); const opacity = Math.max(.06, .48 - dist / 1400); const size = i % 13 === 0 ? 8 : i % 5 === 0 ? 5 : 3; return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="1" fill="${i % 17 === 0 ? "#26baca" : "#2569e8"}" fill-opacity="${opacity.toFixed(2)}"/>`; }).join("")}<path d="M0 350H1000V1414H0Z" fill="url(#fade)"/>`,
      ),
    ),
  },
  {
    id: "arc-blueprint",
    label: "蓝图弧线",
    family: "线纹",
    opacity: 24,
    src: svgData(
      shell(
        `<g fill="none" stroke="#2475df"><path d="M-180 1110A520 520 0 0 1 860 1110" stroke-width="2" stroke-opacity=".45"/><path d="M-140 1110A480 480 0 0 1 820 1110" stroke-width="2" stroke-opacity=".36"/><path d="M-100 1110A440 440 0 0 1 780 1110" stroke-width="2" stroke-opacity=".3"/><path d="M-60 1110A400 400 0 0 1 740 1110" stroke-width="2" stroke-opacity=".24"/><path d="M-20 1110A360 360 0 0 1 700 1110" stroke-width="2" stroke-opacity=".2"/><path d="M20 1110A320 320 0 0 1 660 1110" stroke-width="2" stroke-opacity=".17"/><path d="M60 1110A280 280 0 0 1 620 1110" stroke-width="2" stroke-opacity=".14"/><path d="M100 1110A240 240 0 0 1 580 1110" stroke-width="2" stroke-opacity=".12"/></g><path d="M0 900Q500 650 1000 900V1414H0Z" fill="url(#wash)"/>`,
        `<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#53c9df" stop-opacity=".02"/><stop offset="1" stop-color="#2c6fe8" stop-opacity=".18"/></linearGradient>`,
      ),
    ),
  },
  {
    id: "soft-circles",
    label: "柔和彩环",
    family: "弥散",
    opacity: 26,
    src: svgData(
      shell(
        `<circle cx="780" cy="310" r="210" fill="url(#c1)"/><circle cx="700" cy="1010" r="330" fill="none" stroke="url(#c2)" stroke-width="130"/><circle cx="700" cy="1010" r="195" fill="none" stroke="#42c5e4" stroke-opacity=".24" stroke-width="45"/><circle cx="185" cy="720" r="94" fill="#50d1db" fill-opacity=".24"/>`,
        `<radialGradient id="c1"><stop stop-color="#8c82f6" stop-opacity=".42"/><stop offset=".55" stop-color="#55d3e6" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="c2" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#37bedc" stop-opacity=".62"/><stop offset=".5" stop-color="#2b6eea" stop-opacity=".42"/><stop offset="1" stop-color="#9b81f2" stop-opacity=".5"/></linearGradient>`,
      ),
    ),
  },
  {
    id: "color-blocks",
    label: "轻盈色块",
    family: "几何",
    opacity: 24,
    src: svgData(
      shell(
        `<path d="M0 830 245 610 500 830 245 1050Z" fill="#1f71ed" fill-opacity=".4"/><path d="M245 610 500 390 755 610 500 830Z" fill="#52d2df" fill-opacity=".36"/><path d="M500 830 755 610 1010 830 755 1050Z" fill="#9984ef" fill-opacity=".3"/><path d="M245 1050 500 830 755 1050 500 1270Z" fill="#2e98e9" fill-opacity=".3"/><path d="M0 830 245 1050 245 1380 0 1160Z" fill="#69d4d4" fill-opacity=".2"/><path d="M755 1050 1010 830 1010 1160 755 1380Z" fill="#175bd7" fill-opacity=".22"/><g fill="none" stroke="#fff" stroke-width="4" opacity=".44"><path d="m0 830 500 440 500-440"/><path d="m245 610 510 440"/><path d="m755 610-510 440"/></g>`,
      ),
    ),
  },
  {
    id: "wave-horizon",
    label: "海平线",
    family: "流线",
    opacity: 26,
    src: svgData(
      shell(
        `<path d="M0 870Q180 780 360 860T720 850T1080 780V1414H0Z" fill="url(#sea)"/><path d="M0 1000Q220 850 440 990T880 950T1100 890" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4"/><path d="M0 1040Q220 890 440 1030T880 990T1100 930" fill="none" stroke="#55d9e7" stroke-opacity=".6" stroke-width="3"/><path d="M0 1080Q220 930 440 1070T880 1030T1100 970" fill="none" stroke="#2471eb" stroke-opacity=".34" stroke-width="2"/><ellipse cx="740" cy="930" rx="450" ry="170" fill="url(#glow)"/>`,
        `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#3e83f1" stop-opacity=".08"/><stop offset="1" stop-color="#3aaedc" stop-opacity=".36"/></linearGradient><radialGradient id="glow"><stop stop-color="#57d8eb" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
      ),
    ),
  },
];

presets.push(
  {
    id: "sunset-mist",
    label: "日落云雾",
    family: "弥散",
    opacity: 32,
    src: svgData(
      shell(
        `<ellipse cx="780" cy="340" rx="390" ry="280" fill="url(#sun)"/><ellipse cx="300" cy="810" rx="390" ry="300" fill="url(#rose)"/><ellipse cx="760" cy="1120" rx="380" ry="260" fill="url(#gold)"/>`,
        `<radialGradient id="sun"><stop stop-color="#ff8c69" stop-opacity=".7"/><stop offset=".58" stop-color="#ffc17a" stop-opacity=".34"/><stop offset="1" stop-color="#ffc17a" stop-opacity="0"/></radialGradient><radialGradient id="rose"><stop stop-color="#e979a5" stop-opacity=".54"/><stop offset="1" stop-color="#e979a5" stop-opacity="0"/></radialGradient><radialGradient id="gold"><stop stop-color="#f4ca67" stop-opacity=".5"/><stop offset="1" stop-color="#f4ca67" stop-opacity="0"/></radialGradient>`,
      ),
    ),
  },
  {
    id: "botanical-glow",
    label: "植物微光",
    family: "弥散",
    opacity: 30,
    src: svgData(
      shell(
        `<ellipse cx="760" cy="360" rx="300" ry="360" transform="rotate(32 760 360)" fill="url(#leaf)"/><ellipse cx="340" cy="850" rx="370" ry="260" transform="rotate(-28 340 850)" fill="url(#mint)"/><path d="M170 1140Q510 760 850 420" fill="none" stroke="#73a86f" stroke-opacity=".3" stroke-width="5"/>`,
        `<radialGradient id="leaf"><stop stop-color="#83b96b" stop-opacity=".62"/><stop offset="1" stop-color="#a7d786" stop-opacity="0"/></radialGradient><radialGradient id="mint"><stop stop-color="#4bb9a0" stop-opacity=".5"/><stop offset="1" stop-color="#a3dfc5" stop-opacity="0"/></radialGradient>`,
      ),
    ),
  },
  {
    id: "terracotta-arches",
    label: "陶土拱影",
    family: "几何",
    opacity: 26,
    src: svgData(
      shell(
        `<path d="M80 1000V620a210 210 0 0 1 420 0v380Z" fill="#d96b4d" fill-opacity=".3"/><path d="M390 1060V740a250 250 0 0 1 500 0v320Z" fill="#e6ae68" fill-opacity=".34"/><path d="M630 1414V1050a190 190 0 0 1 380 0v364Z" fill="#b95d46" fill-opacity=".2"/><circle cx="210" cy="1160" r="90" fill="#e9c77a" fill-opacity=".3"/>`,
      ),
    ),
  },
  {
    id: "peony-veil",
    label: "花瓣薄雾",
    family: "弥散",
    opacity: 29,
    src: svgData(
      shell(
        `<ellipse cx="690" cy="420" rx="340" ry="220" transform="rotate(-34 690 420)" fill="url(#petal)"/><ellipse cx="380" cy="720" rx="340" ry="230" transform="rotate(28 380 720)" fill="url(#peach)"/><ellipse cx="740" cy="1030" rx="390" ry="260" transform="rotate(-26 740 1030)" fill="url(#lilac)"/>`,
        `<radialGradient id="petal"><stop stop-color="#dd72a8" stop-opacity=".6"/><stop offset="1" stop-color="#f0a6bb" stop-opacity="0"/></radialGradient><radialGradient id="peach"><stop stop-color="#f6a076" stop-opacity=".58"/><stop offset="1" stop-color="#f6a076" stop-opacity="0"/></radialGradient><radialGradient id="lilac"><stop stop-color="#9d83d8" stop-opacity=".48"/><stop offset="1" stop-color="#b59be7" stop-opacity="0"/></radialGradient>`,
      ),
    ),
  },
  {
    id: "golden-lines",
    label: "琥珀流线",
    family: "流线",
    opacity: 27,
    src: svgData(
      shell(
        `<path d="M-50 900C190 650 360 1050 590 820S870 650 1060 750" fill="none" stroke="url(#amber)" stroke-width="74" stroke-opacity=".38"/><path d="M-50 1060C210 810 350 1180 610 1010S850 830 1060 930" fill="none" stroke="url(#rose)" stroke-width="38" stroke-opacity=".38"/>${Array.from({ length: 9 }, (_, i) => `<path d="M-30 ${840 + i * 22}C180 ${650 + i * 18} 370 ${1030 + i * 16} 600 ${810 + i * 12}S870 ${650 + i * 15} 1040 ${740 + i * 20}" fill="none" stroke="#d5a64d" stroke-width="1.5" stroke-opacity="${(0.24 - i * 0.012).toFixed(2)}"/>`).join("")}`,
        `<linearGradient id="amber"><stop stop-color="#d69a37"/><stop offset=".5" stop-color="#f2c56e"/><stop offset="1" stop-color="#cb6f50"/></linearGradient><linearGradient id="rose"><stop stop-color="#e9b46d"/><stop offset="1" stop-color="#ba6172"/></linearGradient>`,
      ),
    ),
  },
);

export type ClassicPalette = {
  id: string;
  label: string;
  colors: [string, string, string, string];
};

export const classicPalettes: ClassicPalette[] = [
  { id: "mondrian", label: "蒙德里安原色", colors: ["#E94436", "#F2C230", "#2364AA", "#42A5A0"] },
  { id: "bauhaus", label: "包豪斯", colors: ["#D94332", "#F1B82D", "#275D9B", "#282A2E"] },
  { id: "swiss", label: "瑞士国际主义", colors: ["#E13C3C", "#1D4ED8", "#111827", "#F0A24A"] },
  { id: "nordic", label: "北欧自然", colors: ["#537C71", "#9DB9A8", "#D89B73", "#637A91"] },
  { id: "ukiyo", label: "日本浮世", colors: ["#254B70", "#C95B43", "#D9B85F", "#4B8A78"] },
  { id: "mediterranean", label: "地中海", colors: ["#1769AA", "#E06D4F", "#F0C44F", "#5CB9A6"] },
  { id: "morandi", label: "莫兰迪柔色", colors: ["#87978A", "#C5867D", "#8296AF", "#C6AD86"] },
  { id: "sunset", label: "落日余晖", colors: ["#EF6A55", "#F4A261", "#D782A8", "#7356A8"] },
  { id: "electric", label: "霓虹电光", colors: ["#FF4D8D", "#27DCE6", "#7257FF", "#E5E94D"] },
];

export const backgroundPresets = presets;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const hexToHsl = (hex: string) => {
  const value = hex.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const maximum = Math.max(red, green, blue),
    minimum = Math.min(red, green, blue),
    delta = maximum - minimum;
  let hue = 0;
  const lightness = (maximum + minimum) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (delta !== 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, saturation, lightness] as const;
};
const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
};

const hexToLab = (hex: string) => {
  const value = hex.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const transform = (component: number) => component > 0.008856 ? Math.cbrt(component) : 7.787 * component + 16 / 116;
  const fx = transform(x), fy = transform(y), fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

export function selectPaletteColors(candidates: string[], count = 4): string[] {
  const unique = [...new Set(candidates.filter((color) => /^#[\da-f]{6}$/i.test(color)).map((color) => color.toLowerCase()))];
  if (unique.length <= count) return unique;
  const selected = [unique[0]];
  while (selected.length < count) {
    const remaining = unique.filter((color) => !selected.includes(color));
    let bestColor = remaining[0];
    let bestScore = -Infinity;
    remaining.forEach((color) => {
      const originalRank = unique.indexOf(color);
      const prominence = 1 - originalRank / Math.max(1, unique.length - 1);
      const [light, greenRed, blueYellow] = hexToLab(color);
      const separation = Math.min(1, Math.min(...selected.map((chosen) => {
        const [otherLight, otherGreenRed, otherBlueYellow] = hexToLab(chosen);
        return Math.hypot(light - otherLight, greenRed - otherGreenRed, blueYellow - otherBlueYellow) / 100;
      })));
      const score = prominence * 0.58 + separation * 0.42;
      if (score > bestScore) {
        bestColor = color;
        bestScore = score;
      }
    });
    selected.push(bestColor);
  }
  return selected;
}

export function paletteColorCount(family: string): number {
  if (family === "几何") return 4;
  if (family === "弥散") return 3;
  if (family === "线纹" || family === "流线") return 2;
  return 3;
}

export function completeDocumentPalette(colors: string[], fallback: string[]): string[] {
  if (colors.length >= 4) return colors.slice(0, 4);
  if (!colors.length) return fallback.slice(0, 4);
  const [hue, saturation, lightness] = hexToHsl(colors[0]);
  const variants = [
    hslToHex(hue, clamp(saturation * 0.68, 0.24, 0.76), clamp(lightness + 0.24, 0.28, 0.9)),
    hslToHex((hue + 28) % 360, clamp(saturation * 0.82, 0.28, 0.82), clamp(lightness + 0.02, 0.28, 0.76)),
    hslToHex((hue + 180) % 360, clamp(saturation * 0.68, 0.24, 0.72), clamp(lightness + 0.12, 0.32, 0.84)),
  ];
  const palette = colors.slice(0, 4);
  variants.forEach((color) => {
    if (palette.length < 4 && !palette.includes(color)) palette.push(color);
  });
  while (palette.length < 4) palette.push(fallback[palette.length]);
  return palette;
}

export function recolorBackgroundSource(source: string, colors: string[], colorCount = 4): string {
  if (!source.startsWith("data:image/svg+xml")) return source;
  const separator = source.indexOf(",");
  const activeColors = colors.slice(0, colorCount);
  if (separator < 0 || activeColors.length === 0) return source;
  let svg: string;
  try {
    svg = decodeURIComponent(source.slice(separator + 1));
  } catch {
    return source;
  }
  const sourceColors = [...new Set(svg.match(/#[\da-f]{3,8}\b/gi) || [])].filter(
    (color) => {
      if (color.length !== 4 && color.length !== 7) return false;
      const hex = color.length === 4 ? color.slice(1).split("").map((c) => c + c).join("") : color.slice(1);
      const channels = hex.match(/.{2}/g)?.map((part) => parseInt(part, 16)) || [];
      if (channels.length !== 3) return false;
      const [red, green, blue] = channels;
      // Bright saturated colors can still be brand colors; only skip near-gray tones.
      return Math.max(red, green, blue) - Math.min(red, green, blue) >= 22;
    },
  );
  const replacements = new Map(
    sourceColors.map((color, index) => [color.toLowerCase(), activeColors[index % activeColors.length]]),
  );
  svg = svg.replace(/#[\da-f]{3,8}\b/gi, (color) => replacements.get(color.toLowerCase()) || color);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createRandomBackground(paletteColors: string[] = classicPalettes[0].colors): BackgroundAsset {
  let seed = Math.floor(Math.random() * 0xffffffff) || 1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const family = ["雾光", "海浪", "折面", "光环", "流线"][
    Math.floor(random() * 5)
  ];
  const paletteCount = paletteColorCount(family === "折面" ? "几何" : family === "雾光" || family === "光环" ? "弥散" : family === "海浪" || family === "流线" ? "流线" : family);
  const availableColors = paletteColors.length >= 2 ? paletteColors : classicPalettes[0].colors;
  const chosenColors = availableColors.slice(0, paletteCount);
  const palette = Array.from({ length: 4 }, (_, index) => chosenColors[index % chosenColors.length]);
  const defs = `<radialGradient id="mistA"><stop stop-color="${palette[0]}" stop-opacity=".64"/><stop offset=".55" stop-color="${palette[1]}" stop-opacity=".3"/><stop offset="1" stop-color="${palette[1]}" stop-opacity="0"/></radialGradient><radialGradient id="mistB"><stop stop-color="${palette[2]}" stop-opacity=".48"/><stop offset="1" stop-color="${palette[2]}" stop-opacity="0"/></radialGradient><linearGradient id="band" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[1]}" stop-opacity=".12"/><stop offset=".48" stop-color="${palette[0]}" stop-opacity=".64"/><stop offset="1" stop-color="${palette[2]}" stop-opacity=".16"/></linearGradient>`;

  let content = "";
  if (family === "雾光") {
    content = Array.from({ length: 6 }, (_, i) => {
      const cx = Math.round(random() * 1050 - 25);
      const cy = Math.round(180 + random() * 1120);
      const rx = Math.round(180 + random() * 270);
      const ry = Math.round(170 + random() * 250);
      const rotate = Math.round(random() * 80 - 40);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rotate} ${cx} ${cy})" fill="${i % 2 ? "url(#mistA)" : "url(#mistB)"}"/>`;
    }).join("");
  } else if (family === "海浪" || family === "流线") {
    const base = Math.round(580 + random() * 420);
    content = `<path d="M-50 ${base} C180 ${base - 230} 310 ${base + 170} 535 ${base - 8} S850 ${base - 180} 1050 ${base + 8} L1050 1414H-50Z" fill="url(#band)"/>`;
    content += Array.from({ length: 12 }, (_, i) => {
      const y = base + i * 17 - 84;
      const swing = Math.round(80 + random() * 130);
      return `<path d="M-60 ${y} C180 ${y - swing} 340 ${y + swing} 540 ${y - 12} S850 ${y - swing / 2} 1060 ${y + 30}" fill="none" stroke="${i % 2 ? palette[1] : palette[0]}" stroke-width="${i % 3 === 0 ? 3 : 1.5}" stroke-opacity="${(0.35 - i * 0.018).toFixed(2)}"/>`;
    }).join("");
  } else if (family === "折面") {
    content = Array.from({ length: 15 }, (_, i) => {
      const x = Math.round(random() * 1150 - 80);
      const y = Math.round(360 + random() * 1000);
      const w = Math.round(100 + random() * 380);
      const h = Math.round(120 + random() * 440);
      const points = `${x},${y} ${x + w},${y + Math.round(random() * 180 - 90)} ${x + Math.round(w * 0.55)},${y + h}`;
      return `<polygon points="${points}" fill="${palette[i % palette.length]}" fill-opacity="${(0.12 + random() * 0.32).toFixed(2)}"/>`;
    }).join("");
  } else {
    content = Array.from({ length: 5 }, (_, i) => {
      const cx = Math.round(140 + random() * 780);
      const cy = Math.round(430 + random() * 800);
      const rx = Math.round(120 + random() * 250);
      const ry = Math.round(100 + random() * 260);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${palette[i % palette.length]}" stroke-width="${Math.round(16 + random() * 45)}" stroke-opacity="${(0.16 + random() * 0.28).toFixed(2)}" transform="rotate(${Math.round(random() * 70 - 35)} ${cx} ${cy})"/>`;
    }).join("");
  }

  return {
    id: `random-${seed.toString(16)}`,
    label: `随机 · ${family}`,
    family: "随机",
    src: svgData(shell(content, defs)),
    opacity: 32,
  };
}
