#!/usr/bin/env python3
"""Write the daily archive index (d/index.html) and the site's sitemap.xml.

WHY THIS EXISTS. The 73 per-day share pages under d/YYYY-MM-DD/ carry the og:
tags that make a shared link unfurl as that day's puzzle, but until now nothing
on the site pointed at them: no link, no sitemap, so a crawler had no way to
reach one and a person had no way to browse them. This gives them both a page
that lists the days and a sitemap that names them.

WHAT IT WILL NOT DO. A day that has not arrived yet is listed by date only -
no link, no category. The pages for future days already sit on disk because
they are generated in one batch, and naming tomorrow's category on a public
page, or handing it to a crawler, would give the puzzle away before it is due.
So the cut is the same one the app makes: a day is public once its date has
come.

HOW IT IS REGENERATED. Run it from anywhere; it works on the repo it lives in:

    python3 _tools/gen-archive.py

It reads play/data/index.json (written by the game repo's
scripts/export-web-daily.js) and the d/ folder, and rewrites d/index.html and
sitemap.xml from scratch. It is safe to run again at any time. Nothing here is
hand-edited.

  *** THIS SCRIPT IS DATE-DRIVEN. IT MUST BE RERUN, DAILY. ***

It reads date.today() and bakes the answer into two static files. Skip a day
and sitemap.xml still ends at the last day it was run, so a day that has since
come due is never offered to a crawler. The per-day pages have the same
dependency in the other direction: scripts/gen-daily-share-pages.py stamps
<meta name="robots" content="noindex"> on every day that is not out yet, and a
day that has since come due keeps that noindex until IT is rerun too. Neither
of those can be fixed from the browser - a crawler reads the raw HTML, and no
script can retract a noindex or add a URL to a sitemap after the fact.

So the required cadence, every day the site is rebuilt, in this order:

    node   scripts/export-web-daily.js          # game repo, only if days changed
    python3 scripts/gen-daily-share-pages.py    # game repo, clears noindex
    python3 _tools/gen-archive.py               # here, relists and re-sitemaps

See the game repo's scripts/README.md, "Daily site regeneration".

WHAT THE BROWSER DOES COVER. d/index.html lists all 73 days, and the unreleased
ones carry their date but no category and no link. A small inline script checks
the visitor's own clock and, for any day that has since come due, fetches
play/data/index.json and fills the link and category back in. That is only for
the human reader - it means a missed rerun degrades to "not in Google yet"
rather than "the archive claims today's puzzle is not out". The visitor's clock
is also the same cut the player uses (app.js takes the local calendar date), so
the two agree. Crawlers still see only what was released at generation time.

This folder starts with an underscore, so Jekyll leaves it out of the built
site; the two files it writes have no YAML front matter, so Jekyll copies them
through untouched.
"""
import json
import os
from datetime import date, datetime, timezone

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://www.metiscoda.com/linky-words"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]

TODAY = date.today()


def day_date(entry):
    return datetime.strptime(entry["date"], "%Y-%m-%d").date()


def esc(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


def lastmod(path):
    stamp = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc)
    return stamp.date().isoformat()


days = json.load(open(os.path.join(SITE, "play", "data", "index.json")))
days.sort(key=day_date)

# Only days that actually have a page. An entry in index.json with no page
# behind it would be a dead link here and a 404 in the sitemap.
days = [d for d in days
        if os.path.isfile(os.path.join(SITE, "d", d["date"], "index.html"))]

released = [d for d in days if day_date(d) <= TODAY]
upcoming = [d for d in days if day_date(d) > TODAY]

# ---------------------------------------------------------------- d/index.html

rows = []
month = None

for position, entry in enumerate(days):
    when = day_date(entry)
    label = "%s %d" % (MONTHS[when.month - 1], when.year)

    if label != month:
        if month is not None:
            rows.append('  </ul>')
        month = label
        rows.append('  <h2>%s</h2>\n  <ul class="days">' % esc(label))

    if when <= TODAY:
        rows.append(
            '    <li><a href="%s/">'
            '<span class="date">%d %s</span>'
            '<span class="cat">%s</span></a></li>'
            % (entry["date"], when.day, MONTHS[when.month - 1][:3], esc(entry["category"])))
    else:
        # No category and no link: that is the whole point of holding it back.
        # data-date lets the inline script below reinstate the day, from the
        # visitor's clock, if this file was generated before the day came due.
        rows.append(
            '    <li class="soon" data-date="%s">'
            '<span class="date">%d %s</span>'
            '<span class="cat">Not out yet</span></li>'
            % (entry["date"], when.day, MONTHS[when.month - 1][:3]))

if days:
    rows.append('  </ul>')

# Kept out of the .format() template on purpose: it is full of braces, and
# doubling every one of them to survive str.format is how this breaks later.
CATCH_UP_SCRIPT = """<script>
/* This page is generated, so its idea of "released" is frozen at generation
   time. If it was not rebuilt today, any day that has since come due is still
   sitting here as "Not out yet". Put those back, using the visitor's own
   calendar date - the same cut app.js makes - and the category list the player
   already downloads. Progressive enhancement only: with no JS, or if the fetch
   fails, the page stays exactly as generated. Crawlers are unaffected; the
   unreleased day pages carry noindex until they are regenerated. */
(function () {
  var held = document.querySelectorAll('li.soon[data-date]');
  if (!held.length || !window.fetch) return;

  var now = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' +
              pad(now.getDate());

  var due = [];
  for (var i = 0; i < held.length; i++) {
    /* ISO dates compare correctly as strings. */
    if (held[i].getAttribute('data-date') <= today) due.push(held[i]);
  }
  if (!due.length) return;

  fetch('../play/data/index.json').then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (list) {
    if (!list) return;
    var category = {};
    list.forEach(function (m) { category[m.date] = m.category; });

    due.forEach(function (li) {
      var date = li.getAttribute('data-date');
      var name = category[date];
      if (!name) return;

      var link = document.createElement('a');
      link.href = date + '/';

      var when = li.querySelector('.date');
      if (!when) return;
      var cat = document.createElement('span');
      cat.className = 'cat';
      cat.textContent = name;

      link.appendChild(when);
      link.appendChild(cat);

      li.innerHTML = '';
      li.className = '';
      li.removeAttribute('data-date');
      li.appendChild(link);
    });
  })['catch'](function () { /* leave the page as generated */ });
})();
</script>"""

index_html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Linky Words Daily &middot; every puzzle so far</title>
<meta name="description" content="Every Linky Words daily puzzle released so far. Ten grids, one category, the same puzzle for everyone. Free in your browser.">
<link rel="canonical" href="{base}/d/">
<link rel="shortcut icon" href="{base}/assets/icon.png">
<meta name="apple-itunes-app" content="app-id=6476451925">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Linky Words">
<meta property="og:title" content="Linky Words Daily &middot; every puzzle so far">
<meta property="og:description" content="Every Linky Words daily puzzle released so far. Ten grids, one category, the same puzzle for everyone. Free in your browser.">
<meta property="og:url" content="{base}/d/">
<meta property="og:image" content="{base}/assets/headerimage.png">
<meta property="og:image:secure_url" content="{base}/assets/headerimage.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1500">
<meta property="og:image:height" content="1001">
<meta property="og:image:alt" content="Linky Words - link letters together to form words.">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@metiscoda">
<meta name="twitter:title" content="Linky Words Daily &middot; every puzzle so far">
<meta name="twitter:description" content="Every Linky Words daily puzzle released so far. Ten grids, one category, the same puzzle for everyone. Free in your browser.">
<meta name="twitter:image" content="{base}/assets/headerimage.png">

<!-- Generated by _tools/gen-archive.py. Do not edit by hand: rerun
     `python3 _tools/gen-archive.py` after exporting new days, and on any day
     the site is rebuilt, so the days that have since come due get their links. -->

<style>
  html, body {{ margin: 0; padding: 0; }}
  body {{
    background: #FFF9F0;
    color: #3A332B;
    font-family: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
    line-height: 1.5;
    padding: 32px 16px 56px;
  }}
  main {{ max-width: 44rem; margin: 0 auto; }}
  .eyebrow {{
    font-size: 0.9rem; letter-spacing: 0.08em; text-transform: uppercase;
    color: #6F6557; margin: 0 0 0.5rem;
  }}
  h1 {{ font-size: 2rem; line-height: 1.2; margin: 0 0 0.6rem; }}
  p.blurb {{ color: #6F6557; margin: 0 0 1.6rem; }}
  a.today {{
    display: inline-block; background: #3A332B; color: #FFF9F0;
    text-decoration: none; font-weight: 700;
    padding: 0.7rem 1.4rem; border-radius: 999px; margin-bottom: 2rem;
  }}
  h2 {{ font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.06em;
       color: #6F6557; margin: 2rem 0 0.6rem; }}
  ul.days {{ list-style: none; margin: 0; padding: 0;
             display: grid; gap: 8px;
             grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); }}
  ul.days li {{ border: 1px solid #E4D9C6; border-radius: 10px; }}
  ul.days a, ul.days .soon > span:first-child {{ display: block; }}
  ul.days a {{ text-decoration: none; color: #3A332B; padding: 0.6rem 0.8rem; }}
  ul.days a:hover {{ background: #F3E7D3; }}
  ul.days li.soon {{ padding: 0.6rem 0.8rem; border-style: dashed; color: #9B917F; }}
  .date {{ display: block; font-weight: 700; }}
  .cat {{ display: block; font-size: 0.95rem; color: #6F6557; }}
  ul.days li.soon .cat {{ color: #9B917F; }}
  footer {{ margin-top: 2.5rem; color: #6F6557; font-size: 0.95rem; }}
  footer a {{ color: #3A332B; }}
</style>
</head>
<body>
<main>
  <p class="eyebrow">Linky Words</p>
  <h1>The daily puzzle, day by day</h1>
  <p class="blurb">Ten grids, one category, the same puzzle for everyone. Free
  in your browser, no sign-up. Puzzles appear here on the day they are due.</p>
  <a class="today" href="../play/">Play today&rsquo;s puzzle</a>

{rows}

  <footer>
    <p><a href="../">About Linky Words</a> &middot; the full game, with every
    category, is on the <a href="https://apps.apple.com/us/app/linky-words-word-puzzle-game/id6476451925">App Store</a>
    and <a href="https://play.google.com/store/apps/details?id=com.metiscoda.linkletter&amp;referrer=utm_source%3Dsite%26utm_medium%3Dorganic%26utm_campaign%3Darchive">Google Play</a>.</p>
  </footer>
</main>
{script}
</body>
</html>
""".format(base=BASE, rows="\n".join(rows), script=CATCH_UP_SCRIPT)

with open(os.path.join(SITE, "d", "index.html"), "w") as handle:
    handle.write(index_html)

# ----------------------------------------------------------------- sitemap.xml

# The Jekyll-rendered pages, by the URL they are published at. Kept as a list
# here rather than discovered, because there are three of them and each one is
# a deliberate page rather than a file that happens to exist.
entries = [("%s/" % BASE, lastmod(os.path.join(SITE, "index.html"))),
           ("%s/privacypolicy/" % BASE, lastmod(os.path.join(SITE, "_pages", "privacypolicy.md"))),
           ("%s/changelog/" % BASE, lastmod(os.path.join(SITE, "_pages", "changelog.md"))),
           ("%s/play/" % BASE, lastmod(os.path.join(SITE, "play", "index.html"))),
           ("%s/d/" % BASE, TODAY.isoformat())]

entries += [("%s/d/%s/" % (BASE, d["date"]),
             lastmod(os.path.join(SITE, "d", d["date"], "index.html")))
            for d in released]

sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!-- Generated by _tools/gen-archive.py - rerun it rather than editing this.',
           '     Unreleased days are held back until the day they are due, for the same',
           '     reason they are not linked from /d/: the category would give the puzzle',
           '     away. -->',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']

for loc, when in entries:
    sitemap.append("  <url><loc>%s</loc><lastmod>%s</lastmod></url>" % (loc, when))

sitemap.append("</urlset>")

with open(os.path.join(SITE, "sitemap.xml"), "w") as handle:
    handle.write("\n".join(sitemap) + "\n")

print("d/index.html: %d days (%d released, %d still to come)"
      % (len(days), len(released), len(upcoming)))
print("sitemap.xml: %d urls" % len(entries))
