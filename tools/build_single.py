"""Bundle the app into one self-contained HTML file (used for the shareable artifact link)."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
css = (root / 'style.css').read_text()
def js(name): return (root / name).read_text().replace('</script', '<\\/script')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = re.sub(r'\s*<link rel="manifest"[^>]*>', '', html)
html = re.sub(r'\s*<link rel="(icon|apple-touch-icon)"[^>]*>', '', html)
html = html.replace('<link rel="stylesheet"', '<link rel="icon" href="data:,">\n<link rel="stylesheet"', 1) if False else html.replace('<title>', '<link rel="icon" href="data:,">\n<title>', 1)
scripts = '<script>window.__SINGLE_FILE__ = true;</script>\n' + ''.join(
    '<script>\n' + js(n) + '\n</script>\n' for n in ('profile.js', 'colour.js', 'app.js'))
html = html.replace('<script src="profile.js"></script>\n<script src="colour.js"></script>\n<script src="app.js"></script>\n', scripts)
assert 'src="app.js"' not in html and '<style>' in html
out = root / 'dist'; out.mkdir(exist_ok=True)
(out / 'index.html').write_text(html)
print('wrote', out / 'index.html', len(html), 'bytes')
