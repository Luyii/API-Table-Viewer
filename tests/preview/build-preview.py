#!/usr/bin/env python3
"""Assemble previews from the actual extension source, without making a ZIP."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def inline_script(code):
    return '<script>' + re.sub(r'</script', lambda _: r'<\/script', code, flags=re.I) + '</script>'


def build(output, fragment=None):
    html = (ROOT / 'panel.html').read_text(encoding='utf-8')
    worker = (ROOT / 'worker.js').read_text(encoding='utf-8').replace(
        "importScripts('json-codec.js');", (ROOT / 'json-codec.js').read_text(encoding='utf-8')).replace(
        "importScripts('field-patch-core.js');", (ROOT / 'field-patch-core.js').read_text(encoding='utf-8'))
    html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + (ROOT / 'style.css').read_text(encoding='utf-8') + '</style>')
    html = html.replace('<title>API Table Viewer</title>', '<title>响应编辑 · API Table Viewer 交互预览</title>')
    html = html.replace('<body>', '<body>' + inline_script((ROOT / 'tests/preview/env.js').read_text(encoding='utf-8')))
    for match in list(re.finditer(r'<script src="([^"]+)"></script>', html)):
        code = (ROOT / match[1]).read_text(encoding='utf-8')
        if match[1] == 'panel.js':
            code = code.replace('new Worker("worker.js")', 'new Worker(URL.createObjectURL(new Blob([' + json.dumps(worker) + '],{type:"text/javascript"})))')
        html = html.replace(match[0], inline_script(code))
    html = html.replace('</body>', inline_script((ROOT / 'tests/preview/boot.js').read_text(encoding='utf-8')) + '</body>')
    html = html.replace('<span>API Table Viewer</span>', '<span>API Table Viewer · 示例数据预览</span>')
    output.write_text(html, encoding='utf-8')
    print(output)
    if fragment:
        source = (ROOT / 'panel.html').read_text(encoding='utf-8')
        markup = source[source.index('<div id="responseEditor"'):source.index('<div id="toast"')]
        styles = (ROOT / 'style.css').read_text(encoding='utf-8').split('/* Response editing is a separate workspace; captured data stays read-only. */')[1]
        # Namespace product controls so host utility CSS cannot alter them.
        names = [('icon-btn', 'atv-icon-button'), ('btn', 'atv-button'), ('hidden', 'atv-hidden'), ('app', 'atv-app')]
        def namespace(text):
            for old, new in names:
                text = re.sub(r'(?<![\w-])' + old + r'(?![\w-])', new, text)
            return re.sub(r'overflow:\s*atv-hidden', 'overflow:hidden', text)
        def scope(match):
            selector = match[1].strip()
            if selector.startswith('@'):
                return selector + '{'
            return ','.join('#api-response-preview ' + part.strip() for part in selector.split(',')) + '{'
        styles = re.sub(r'([^{}]+)\{', scope, namespace(styles))
        template = (ROOT / 'tests/preview/inline-template.html').read_text(encoding='utf-8')
        template = template.replace('<!-- EDITOR_MARKUP -->', markup)
        template = template.replace('// CODEC_SCRIPT', (ROOT / 'json-codec.js').read_text(encoding='utf-8'))
        template = template.replace('// EDITOR_SCRIPT', (ROOT / 'response-editor.js').read_text(encoding='utf-8'))
        template = namespace(template)
        overrides = (ROOT / 'tests/preview/inline-style.css').read_text(encoding='utf-8')
        template = template.replace('/* EDITOR_STYLES */', styles + '\n' + overrides)
        fragment.write_text(template, encoding='utf-8')
        print(fragment)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--inline', type=Path)
    args = parser.parse_args()
    build(args.output, args.inline)
