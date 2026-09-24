#!/usr/bin/env python3
"""Write the per-day share landing pages under <site>/d/YYYY-MM-DD/index.html.

These files carry NO YAML front matter, so Jekyll copies them verbatim.
They live under the repo root, which GitHub Pages serves at
https://www.metiscoda.com/linky-words/ -- so the published path is
/linky-words/d/YYYY-MM-DD/, which AASA's /linky-words/* rule covers.

RELEASE CUT. Every day's page is written in one batch, including days that are
not out yet, because the pages have to exist before the share links that point
at them do. A page for a day that has not arrived names its category in the
title and the og: tags, so an unreleased page carries

    <meta name="robots" content="noindex">

and a released one carries nothing (the default is indexable). That keeps
tomorrow's category out of search results without pretending it is a secret:
it is already in play/data/index.json, which the player fetches in full.

CADENCE -- THIS IS DATE-DRIVEN. The noindex above is decided against
today's date AT GENERATION TIME and then baked into a static file. A day that
comes due after the last run keeps its noindex until this script is run again,
so it stays out of search until then. .github/workflows/daily-release.yml runs
it, then gen-archive.py, every morning and commits whatever changed, with
TZ=America/Los_Angeles so "today" is the same date a local run would use. Run
both by hand only after exporting new days, to see the result before pushing:

    python3 _tools/gen-daily-share-pages.py
    python3 _tools/gen-archive.py

It reads play/data/index.json (written by the game repo's
scripts/export-web-daily.js) and nothing else, which is why it lives here and
not in the game repo: the Action can run it without Unity or the game's assets.
Set LW_TODAY=YYYY-MM-DD to generate as of another date.
"""
import json
import os
from datetime import date, datetime

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://www.metiscoda.com/linky-words"
DESC = ("Ten grids, one category. The same puzzle for everyone, every day. "
        "Free in your browser.")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{page_url}">{robots}
<link rel="shortcut icon" href="{base}/assets/icon.png">
<meta name="apple-itunes-app" content="app-id=6476451925">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Linky Words">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{page_url}">
<meta property="og:image" content="{image_url}">
<meta property="og:image:secure_url" content="{image_url}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{alt}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@metiscoda">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{image_url}">
<meta name="twitter:image:alt" content="{alt}">

<script>
/* Send a real visitor straight into the player; crawlers ignore this and
   read the tags above. Any &src= on the share link is carried through. */
(function () {{
  var m = /[?&]src=([^&#]*)/.exec(window.location.search);
  var to = "../../play/?d={date}" + (m ? "&src=" + m[1] : "");
  window.location.replace(to);
}})();
</script>

<style>
  html, body {{ margin: 0; padding: 0; }}
  body {{
    background: #FFF9F0;
    color: #3A332B;
    font-family: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; text-align: center; padding: 24px;
    box-sizing: border-box;
  }}
  .card {{ max-width: 34rem; }}
  .eyebrow {{
    font-size: 0.95rem; letter-spacing: 0.08em; text-transform: uppercase;
    color: #6F6557; margin: 0 0 0.6rem;
  }}
  h1 {{ font-size: 2.1rem; line-height: 1.2; margin: 0 0 0.75rem; }}
  p.blurb {{ color: #6F6557; font-size: 1.05rem; line-height: 1.5;
    margin: 0 0 1.6rem; }}
  a.play {{
    display: inline-block; background: #3A332B; color: #FFF9F0;
    text-decoration: none; font-size: 1.05rem; font-weight: 700;
    padding: 0.85rem 1.9rem; border-radius: 999px;
  }}
  img.preview {{
    width: 100%; height: auto; margin: 1.8rem 0 0;
    border-radius: 14px; background: #F2E8D5;
  }}
</style>
</head>
<body>
<div class="card">
  <p class="eyebrow">Linky Words Daily</p>
  <h1>{heading}</h1>
  <p class="blurb">{desc}</p>
  <a class="play" href="../../play/?d={date}" target="_self">Play this day</a>
  <img class="preview" src="{image_url}" alt="{alt}" width="1200" height="630">
</div>
</body>
</html>
"""


def pretty_date(iso):
    y, m, d = (int(p) for p in iso.split("-"))
    return "%d %s %d" % (d, MONTHS[m - 1], y)


def esc(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


NOINDEX = '\n<meta name="robots" content="noindex">'


def main():
    with open(os.path.join(SITE, "play", "data", "index.json")) as fh:
        index = json.load(fh)
    today = (datetime.strptime(os.environ["LW_TODAY"], "%Y-%m-%d").date()
             if os.environ.get("LW_TODAY") else date.today())
    made = 0
    held = 0
    for meta in index:
        day = meta["date"]
        pretty = pretty_date(day)
        due = datetime.strptime(day, "%Y-%m-%d").date()
        # Unreleased days exist on disk but must not reach a search index:
        # the title and og: tags name the category.
        robots = "" if due <= today else NOINDEX
        if robots:
            held += 1
        title = "Linky Words Daily · %s — %s" % (pretty,
                                                          meta["category"])
        page_url = "%s/d/%s/" % (BASE, day)
        image_url = "%s/assets/og/daily-%s.png" % (BASE, day)
        alt = "A four-by-four Linky Words grid for %s, %s." % (
            meta["category"], pretty)
        html = TEMPLATE.format(
            title=esc(title), desc=esc(DESC), page_url=page_url,
            image_url=image_url, alt=esc(alt), date=day, base=BASE,
            robots=robots,
            heading=esc("%s · %s" % (pretty, meta["category"])))
        out_dir = os.path.join(SITE, "d", day)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "index.html"), "w") as fh:
            fh.write(html)
        made += 1
    print("wrote %d day pages under %s/d/" % (made, SITE))
    print("%d indexable, %d held back with noindex (today is %s)"
          % (made - held, held, today.isoformat()))


if __name__ == "__main__":
    main()
