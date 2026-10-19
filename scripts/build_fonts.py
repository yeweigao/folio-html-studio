#!/usr/bin/env python3
"""Prepare licensed, static TrueType-outline WOFF2 files for browser/PDF use.

Optional build tool, not needed by Vercel. Requires fonttools[woff].
Source files are cached outside the repository. Pass --source-dir to reuse
downloaded upstream files with the filenames listed below.
"""
import argparse
import hashlib
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
CATALOG = [
    dict(id='inter', name='Inter', family='Folio Modern Sans', category='英文 · 无衬线', use='清晰理性，适合瑞士风正文、信息与标签', source='Inter-VF.ttf', folder='inter', remote='Inter%5Bopsz,wght%5D.ttf'),
    dict(id='source-sans', name='Source Sans 3', family='Folio Humanist Sans', category='英文 · 无衬线', use='人文无衬线，适合长文、表格及衬线标题的搭配', source='SourceSans3-VF.ttf', folder='sourcesans3', remote='SourceSans3%5Bwght%5D.ttf'),
    dict(id='source-serif', name='Source Serif 4', family='Folio Editorial Text', category='英文 · 衬线', use='扎实的编辑式正文，适合杂志、长篇阅读', source='SourceSerif4-VF.ttf', folder='sourceserif4', remote='SourceSerif4%5Bopsz,wght%5D.ttf'),
    dict(id='garamond', name='EB Garamond', family='Folio Classic Book', category='英文 · 衬线', use='古典书卷气，适合人文画册与书籍正文', source='EBGaramond-VF.ttf', folder='ebgaramond', remote='EBGaramond%5Bwght%5D.ttf'),
    dict(id='playfair', name='Playfair Display', family='Folio Display Serif', category='英文 · 衬线', use='高对比展示字体，适合大标题，不建议密集小字', source='PlayfairDisplay-VF.ttf', folder='playfairdisplay', remote='PlayfairDisplay%5Bwght%5D.ttf'),
    dict(id='baskerville', name='Libre Baskerville', family='Folio Book Serif', category='英文 · 衬线', use='开阔稳重，适合中小字号正文与导语', source='LibreBaskerville-VF.ttf', folder='librebaskerville', remote='LibreBaskerville%5Bwght%5D.ttf'),
    dict(id='noto-sans-sc', name='思源黑体 · Noto Sans SC', family='Folio CJK Sans', category='中文', use='中性清晰，适合正文、信息页及现代画册', source='NotoSansSC-VF.ttf', folder='notosanssc', remote='NotoSansSC%5Bwght%5D.ttf'),
    dict(id='noto-serif-sc', name='思源宋体 · Noto Serif SC', family='Folio CJK Serif', category='中文', use='端正细腻，适合出版正文、人文画册与标题', source='NotoSerifSC-VF.ttf', folder='notoserifsc', remote='NotoSerifSC%5Bwght%5D.ttf'),
    dict(id='wenkai', name='霞鹜文楷 GB', family='Folio Literary Kai', category='中文', use='温润书写感，适合人文叙述、引言与注释', source='LXGWWenKaiGB-Regular.ttf', bold_source='LXGWWenKaiGB-Medium.ttf', url='https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/LXGWWenKaiGB-Regular.ttf', bold_url='https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/LXGWWenKaiGB-Medium.ttf', license_url='https://raw.githubusercontent.com/lxgw/LxgwWenkaiGB/main/OFL.txt'),
]

def retrieve(url, target):
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(url, timeout=90) as response:
            target.write_bytes(response.read())
    return target

def build(args):
    item, source_dirs, cache_dir = args
    out = ROOT / 'public' / 'fonts'
    out.mkdir(parents=True, exist_ok=True)
    cache = Path(cache_dir)
    def source(name, url):
        existing = next((Path(d) / name for d in source_dirs if (Path(d) / name).exists()), None)
        return existing or retrieve(url, cache / name)
    upstream = item.get('url') or GF + item['folder'] + '/' + item['remote']
    license_url = item.get('license_url') or GF + item['folder'] + '/OFL.txt'
    license_file = retrieve(license_url, cache / (item['id'] + '-OFL.txt'))
    license_text = license_file.read_text()
    if 'SIL OPEN FONT LICENSE' not in license_text:
        raise ValueError('Unexpected font license: ' + item['id'])
    licenses = out / 'licenses'
    licenses.mkdir(exist_ok=True)
    (licenses / (item['id'] + '-OFL.txt')).write_text(license_text)
    files = []
    for weight in (400, 700):
        name = item.get('bold_source', item['source']) if weight == 700 else item['source']
        url = item.get('bold_url', upstream) if weight == 700 else upstream
        original = source(name, url)
        font = TTFont(original)
        if 'fvar' in font:
            limits = {axis.axisTag: (weight if axis.axisTag == 'wght' else 12 if axis.axisTag == 'opsz' else axis.defaultValue) for axis in font['fvar'].axes}
            font = instantiateVariableFont(font, limits, inplace=True)
        assert 'fvar' not in font and 'glyf' in font, 'Print font must have static TrueType outlines'
        # Modified builds get independent family names to honor reserved names.
        subfamily = 'Regular' if weight == 400 else 'Bold'
        values = {1:item['family'], 2:subfamily, 3:f'Folio-{item["id"]}-{weight}', 4:item['family']+' '+subfamily, 6:item['family'].replace(' ', '')+'-'+subfamily, 16:item['family'], 17:subfamily, 21:item['family'], 22:subfamily}
        for record in font['name'].names:
            if record.nameID in values:
                record.string = values[record.nameID].encode(record.getEncoding(), errors='replace')
        font['OS/2'].usWeightClass = weight
        font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~0x61) | (0x40 if weight == 400 else 0x20)
        font['head'].macStyle = (font['head'].macStyle & ~3) | (1 if weight == 700 else 0)
        font.flavor = 'woff2'
        target = out / f'{item["id"]}-{weight}.woff2'
        font.save(target)
        files.append(dict(weight=weight, path=f'/fonts/{target.name}', bytes=target.stat().st_size, sha256=hashlib.sha256(target.read_bytes()).hexdigest(), sourceSha256=hashlib.sha256(original.read_bytes()).hexdigest()))
    print(item['name'] + ': ready', flush=True)
    return {key:item[key] for key in ('id','name','family','category','use')} | dict(license='OFL-1.1', licensePath=f'/fonts/licenses/{item["id"]}-OFL.txt', sourceUrl=upstream, licenseUrl=license_url, files=files)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', action='append', default=[])
    parser.add_argument('--jobs', type=int, default=3)
    parser.add_argument('--cache', default=str(Path.home()/'.cache/folio-html-studio/fonts'))
    options = parser.parse_args()
    with ProcessPoolExecutor(max_workers=options.jobs) as pool:
        fonts = list(pool.map(build, [(item, options.source_dir, options.cache) for item in CATALOG]))
    (ROOT/'src/font-catalog.json').write_text(json.dumps(fonts, ensure_ascii=False, indent=2)+'\n')
    print('Font catalog complete: ' + str(len(fonts)) + ' families', flush=True)
