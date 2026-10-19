# 印刷字体库与授权

此库包含 9 组字体的常规与粗体。它们的上游版本均使用 SIL Open Font License 1.1，可用于商业出版、印刷及文档嵌入；随软件和 HTML 分发时一并保留对应的版权与完整授权文本。具体许可见下表。

| 界面名称                 | 建议用途                                       | 上游与许可                                                                                                |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Inter                    | 理性无衬线正文、信息、瑞士风标签               | [字体](https://github.com/rsms/inter) · [OFL](public/fonts/licenses/inter-OFL.txt)                        |
| Source Sans 3            | 人文无衬线正文、表格，与衬线标题搭配           | [字体](https://github.com/adobe-fonts/source-sans) · [OFL](public/fonts/licenses/source-sans-OFL.txt)     |
| Source Serif 4           | 编辑式正文、杂志长文                           | [字体](https://github.com/adobe-fonts/source-serif) · [OFL](public/fonts/licenses/source-serif-OFL.txt)   |
| EB Garamond              | 人文画册、古典书籍、书卷感正文                 | [字体](https://github.com/octaviopardo/EBGaramond12) · [OFL](public/fonts/licenses/garamond-OFL.txt)      |
| Playfair Display         | 大标题、章扉、展示字；不作为密集小字的默认     | [字体](https://github.com/clauseggers/Playfair) · [OFL](public/fonts/licenses/playfair-OFL.txt)           |
| Libre Baskerville        | 开阔稳重的正文、导语                           | [字体](https://github.com/impallari/Libre-Baskerville) · [OFL](public/fonts/licenses/baskerville-OFL.txt) |
| 思源黑体 · Noto Sans SC  | 中文正文、信息页、现代画册                     | [字体](https://github.com/notofonts/noto-cjk) · [OFL](public/fonts/licenses/noto-sans-sc-OFL.txt)         |
| 思源宋体 · Noto Serif SC | 中文出版正文、人文画册与标题                   | [字体](https://github.com/notofonts/noto-cjk) · [OFL](public/fonts/licenses/noto-serif-sc-OFL.txt)        |
| 霞鹜文楷 GB              | 人文叙述、引言、注释；常规及 Medium 映射到粗体 | [字体](https://github.com/lxgw/LxgwWenkaiGB) · [OFL](public/fonts/licenses/wenkai-OFL.txt)                |

这些用途是 Folio 的排版建议，并非字体作者的背书；最终仍需根据纸张、字号、印刷方式与文案密度试排。

## 构建与嵌入

`scripts/build_fonts.py` 从上游 TrueType 字体生成静态 400 / 700 字重，保留完整字符集并压缩为 WOFF2。浏览器解码后仍是 TrueType 轮廓。可变轴被固定，不使用系统字体替代内置字体。

为满足修改版字体的保留名称要求，构建后的内部家族名使用独立的 `Folio …` 名称；菜单标注其上游来源。原版权和 OFL 不被删除。每个文件的源 SHA-256、构建后 SHA-256、地址、大小记录在 `src/font-catalog.json`。

选择某组字体时才从本站读取它的两个字重和授权文本，嵌入当前文档。下载的 HTML 包含字体数据和完整许可，不依赖第三方字体 CDN，也不要求接收方预装字体。

字体资产已包含在项目内，Vercel 构建不需要 Python。需要重新制作资产时，可用独立 Python 环境安装 `fonttools[woff]` 后运行：

```bash
python3 scripts/build_fonts.py
```

可用 `--source-dir /path/to/upstream-fonts` 复用已下载的原始字体；原始下载缓存不进入 Git。

## 验证范围

静态检查核对轮廓表为 `glyf`、无 `fvar`、嵌入权限位、常用中英文字覆盖、字体与授权文件哈希。浏览器回归验证实际加载、替换、恢复和下载重开；中文与西文的 PDF 控制样张核对字体嵌入与文字提取。

这证明控制样张及当前 Chromium 下的结果，不替代每本手册的逐页复核与印前检查。
