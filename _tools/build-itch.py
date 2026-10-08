#!/usr/bin/env python3
"""Package the web daily (play/) as an itch.io HTML game: _build/linky-words-itch.zip.

itch.io serves an HTML game from its own domain (html-classic.itch.zone), inside
an iframe on the game's page. The player mostly works there unchanged - it finds
its data relative to its own address, and its share links already carry the full
metiscoda.com URL - but four things assume it is running on metiscoda.com:

1. Site links in index.html (the title, the footer, the favicon) are root paths,
   /linky-words/..., which on itch's domain point nowhere. They become full URLs,
   and the links open in a new tab rather than inside itch's frame.
2. The store buttons send the frame itself to the App Store or Google Play, and
   both refuse to load inside a frame. They open a new tab instead. The tab has to
   open inside the click, or the browser blocks it as a pop-up, so the analytics
   event is sent alongside it rather than waited for.
3. The Share button needs the frame to be allowed to use the share sheet, which
   itch's frame may not grant; the button would then do nothing. It stays hidden,
   and Copy result (which falls back to a plain copy) does the job.
4. Visitors arrive with no ?src=, so they would be counted as "web". They are
   counted as "itch", which carries through to the analytics events and to the
   store links' campaign tags (Play utm_source=itch, App Store ct=web-daily.itch).

Every patch must match exactly once, or the build stops: if play/ changes, this
script has to be looked at again rather than quietly shipping a broken package.

The data files hold every day up to the end of the run (today 31 January 2027),
and the player opens each day only when it has begun, exactly as on the site. So
the package needs rebuilding and re-uploading only when the run is extended.

    python3 _tools/build-itch.py

_build/ is ignored by git and, starting with an underscore, by Jekyll.
"""
import os
import shutil
import tempfile
import zipfile

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAY = os.path.join(SITE, "play")
OUT_DIR = os.path.join(SITE, "_build")
OUT = os.path.join(OUT_DIR, "linky-words-itch.zip")
HOME = "https://www.metiscoda.com/linky-words/"
NEW_TAB = ' target="_blank" rel="noopener"'


def patch(text, old, new, name):
    count = text.count(old)
    if count != 1:
        raise SystemExit("build-itch: expected exactly one %r in %s, found %d - "
                         "play/ has changed; update this script" % (old[:60], name, count))
    return text.replace(old, new)


def build_index(text):
    name = "index.html"
    text = patch(text, '<link rel="shortcut icon" href="/linky-words/assets/icon.png">',
                 '<link rel="shortcut icon" href="%sassets/icon.png">' % HOME, name)
    text = patch(text, '<h1 class="brand"><a href="/linky-words/">',
                 '<h1 class="brand"><a href="%s"%s>' % (HOME, NEW_TAB), name)
    for path in ("d/", "#app", "privacypolicy/"):
        text = patch(text, '<a href="/linky-words/%s">' % path,
                     '<a href="%s%s"%s>' % (HOME, path, NEW_TAB), name)
    if "/linky-words/" in text.replace(HOME, ""):
        raise SystemExit("build-itch: index.html still has a root /linky-words/ path")
    return text


def build_app(text):
    name = "app.js"
    # 4. count itch visitors as "itch" (both fallbacks)
    text = patch(text, "else src = lsGet(LS_SRC) || 'web';",
                 "else src = lsGet(LS_SRC) || 'itch';", name)
    text = patch(text, "src = src.replace(/[^\\w.\\- ]/g, '').slice(0, 40) || 'web';",
                 "src = src.replace(/[^\\w.\\- ]/g, '').slice(0, 40) || 'itch';", name)
    # 2. store pages in a new tab, opened inside the click
    text = patch(text,
                 "    track('web_store_click', { store: store, streak: streakFrom(loadDone(), todayIdx), src: src },\n"
                 "      function () { window.location.href = url; });",
                 "    track('web_store_click', { store: store, streak: streakFrom(loadDone(), todayIdx), src: src });\n"
                 "    window.open(url, '_blank', 'noopener');", name)
    # 3. no Share button inside itch's frame
    text = patch(text,
                 "    if (typeof navigator !== 'undefined' && navigator.share) $('btn-share').hidden = false;\n",
                 "", name)
    # "Play today's puzzle" on the not-found panel: name the file, since a bare
    # folder URL on itch's host is not guaranteed to serve index.html
    text = patch(text, "    window.location.href = BASE;\n",
                 "    window.location.href = BASE + 'index.html';\n", name)
    return text


def main():
    stage = tempfile.mkdtemp(prefix="linky-itch-")
    try:
        with open(os.path.join(PLAY, "index.html"), encoding="utf-8") as f:
            index = build_index(f.read())
        with open(os.path.join(PLAY, "app.js"), encoding="utf-8") as f:
            app = build_app(f.read())
        with open(os.path.join(stage, "index.html"), "w", encoding="utf-8") as f:
            f.write(index)
        with open(os.path.join(stage, "app.js"), "w", encoding="utf-8") as f:
            f.write(app)
        for name in ("style.css", "analytics.js"):
            shutil.copy(os.path.join(PLAY, name), os.path.join(stage, name))
        shutil.copytree(os.path.join(PLAY, "data"), os.path.join(stage, "data"))

        os.makedirs(OUT_DIR, exist_ok=True)
        if os.path.exists(OUT):
            os.remove(OUT)
        files = 0
        # index.html at the root of the zip, which is what itch looks for
        with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
            for root, _, names in sorted(os.walk(stage)):
                for n in sorted(names):
                    full = os.path.join(root, n)
                    z.write(full, os.path.relpath(full, stage))
                    files += 1
        print("%s: %d files, %.0f KB" % (os.path.relpath(OUT, SITE), files, os.path.getsize(OUT) / 1024))
    finally:
        shutil.rmtree(stage, ignore_errors=True)


if __name__ == "__main__":
    main()
