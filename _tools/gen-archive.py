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

HOW IT IS REGENERATED. .github/workflows/daily-release.yml runs it every
morning, after gen-daily-share-pages.py, and commits whatever changed. By hand,
from anywhere (it works on the repo it lives in):

    python3 _tools/gen-archive.py

It reads play/data/index.json (written by the game repo's
scripts/export-web-daily.js) and the d/ folder, and rewrites d/index.html and
sitemap.xml from scratch. It is safe to run again at any time. Nothing here is
hand-edited.

  *** THIS SCRIPT IS DATE-DRIVEN. IT MUST BE RERUN, DAILY. ***

The Action does that. It reads today's date (LW_TODAY=YYYY-MM-DD overrides it)
and bakes the answer into two static files. Skip a day
and sitemap.xml still ends at the last day it was run, so a day that has since
come due is never offered to a crawler. The per-day pages have the same
dependency in the other direction: _tools/gen-daily-share-pages.py stamps
<meta name="robots" content="noindex"> on every day that is not out yet, and a
day that has since come due keeps that noindex until IT is rerun too. Neither
of those can be fixed from the browser - a crawler reads the raw HTML, and no
script can retract a noindex or add a URL to a sitemap after the fact.

So the required cadence, every day, in this order - which is what the Action
runs:

    python3 _tools/gen-daily-share-pages.py     # clears noindex off days now due
    python3 _tools/gen-archive.py               # relists and re-sitemaps

LASTMOD comes from git, not file times: a fresh checkout stamps every file with
the moment it was cloned, which would move every date in the sitemap on every
run and give the Action something to commit every day forever. A file with
uncommitted changes counts as changed today. A Jekyll page counts as changed
when its source or anything that renders it (_layouts, _includes, _config.yml)
changed.

See the game repo's scripts/README.md, "Daily site regeneration".

WHAT THE BROWSER DOES COVER. d/index.html is a calendar with every month of the
run, and the unreleased days carry their date but no category and no link. A
small inline script shows one month at a time, opening on the visitor's own
month, and checks the visitor's own clock: for any day that has since come due,
it fetches play/data/index.json and fills the link and category back in. That is only for
the human reader - it means a missed rerun degrades to "not in Google yet"
rather than "the archive claims today's puzzle is not out". The visitor's clock
is also the same cut the player uses (app.js takes the local calendar date), so
the two agree. Crawlers still see only what was released at generation time.

This folder starts with an underscore, so Jekyll leaves it out of the built
site. sitemap.xml has no YAML front matter, so Jekyll copies it through
untouched. d/index.html does have front matter: Jekyll renders it with
_layouts/page.html, so it shares the site's head, top bar, footer and app band.
Its body is plain HTML; the script is fenced in {% raw %} so Liquid leaves it
alone.
"""
import calendar
import json
import os
import subprocess
from datetime import date, datetime, timezone

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://www.metiscoda.com/linky-words"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]

TODAY = (datetime.strptime(os.environ["LW_TODAY"], "%Y-%m-%d").date()
         if os.environ.get("LW_TODAY") else date.today())


def day_date(entry):
    return datetime.strptime(entry["date"], "%Y-%m-%d").date()


def esc(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


def git(*args):
    return subprocess.run(["git", "-C", SITE] + list(args), capture_output=True,
                          text=True, check=True).stdout.strip()


def lastmod(*paths):
    """The day these files last changed: today if any has uncommitted changes
    (they are about to be committed), else the newest commit touching them.
    File times only when git is not there to ask."""
    try:
        if git("status", "--porcelain", "--", *paths):
            return TODAY.isoformat()
        committed = git("log", "-1", "--format=%cs", "--", *paths)
        if committed:
            return committed
    except (OSError, subprocess.CalledProcessError):
        pass
    stamp = max(datetime.fromtimestamp(os.path.getmtime(p), timezone.utc) for p in paths)
    return stamp.date().isoformat()


# What every Jekyll-rendered page is built from besides its own source file.
JEKYLL = [os.path.join(SITE, p) for p in ("_layouts", "_includes", "_config.yml")]


days = json.load(open(os.path.join(SITE, "play", "data", "index.json")))
days.sort(key=day_date)

# Only days that actually have a page. An entry in index.json with no page
# behind it would be a dead link here and a 404 in the sitemap.
days = [d for d in days
        if os.path.isfile(os.path.join(SITE, "d", d["date"], "index.html"))]

released = [d for d in days if day_date(d) <= TODAY]
upcoming = [d for d in days if day_date(d) > TODAY]

# ---------------------------------------------------------------- d/index.html
#
# A month-by-month calendar. All months are written into the file, so a crawler
# and a reader with scripting off get every released day as a plain link; the
# script below then shows one month at a time, opening on the visitor's own
# month. Weeks start on Sunday.

WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def sunday_first(when):
    """Column of a date in a Sunday-first week (Python counts Monday as 0)."""
    return (when.weekday() + 1) % 7


by_date = {entry["date"]: entry for entry in days}
month_keys = sorted({entry["date"][:7] for entry in days})

# The month a crawler and the page's first paint treat as current. The script
# moves to the visitor's own month, which can differ near a month boundary.
this_month = TODAY.strftime("%Y-%m")
current_key = max([k for k in month_keys if k <= this_month] or month_keys[:1] or [""])

sections = []
for key in month_keys:
    year, month = int(key[:4]), int(key[5:])
    cells = ['        <li class="pad" aria-hidden="true"></li>'] * sunday_first(date(year, month, 1))

    for number in range(1, calendar.monthrange(year, month)[1] + 1):
        when = date(year, month, number)
        iso = when.isoformat()
        entry = by_date.get(iso)
        spoken = "%s %d %s %d" % (WEEKDAYS[sunday_first(when)], number, MONTHS[month - 1], year)

        if entry is None:
            # A date in a month the run touches but has no puzzle of its own.
            cells.append('        <li class="none"><span class="n">%d</span></li>' % number)
        elif when <= TODAY:
            cells.append(
                '        <li data-day="%s"><a href="%s/" aria-label="%s: %s">'
                '<span class="n">%d</span><span class="cat">%s</span></a></li>'
                % (iso, iso, spoken, esc(entry["category"]), number, esc(entry["category"])))
        else:
            # No category and no link: that is the whole point of holding it back.
            # data-date lets the script reinstate the day, from the visitor's
            # clock, if this file was generated before the day came due.
            cells.append(
                '        <li class="soon" data-day="%s" data-date="%s">'
                '<span class="n" aria-hidden="true">%d</span><span class="sr-only">%s, not out yet</span></li>'
                % (iso, iso, number, spoken))

    sections.append(
        '  <section class="month%s" data-month="%s" aria-labelledby="m-%s">\n'
        '    <h2 class="month-title" id="m-%s">%s %d</h2>\n'
        '    <div class="dow" aria-hidden="true">%s</div>\n'
        '    <ol class="days">\n%s\n    </ol>\n'
        '  </section>'
        % (" is-shown" if key == current_key else "", key, key, key, MONTHS[month - 1], year,
           "".join("<span>%s</span>" % name[:3] for name in WEEKDAYS), "\n".join(cells)))

# Kept out of the .format() template on purpose: it is full of braces, and
# doubling every one of them to survive str.format is how this breaks later.
# {% raw %} keeps Jekyll's Liquid away from it for the same reason.
CALENDAR_SCRIPT = """{% raw %}<script>
/* Two jobs, both progressive enhancement: with no JS the page shows every
   month as generated.

   1. This page is generated, so its idea of "released" is frozen at generation
      time. If it was not rebuilt today, any day that has since come due is
      still held back. Put those back, using the visitor's own calendar date -
      the same cut app.js makes - and the category list the player already
      downloads. Crawlers are unaffected; the unreleased day pages carry noindex
      until they are regenerated.
   2. Show one month at a time, opening on the visitor's month, with buttons
      back through earlier months and forward no further than this month. */
(function () {
  var cal = document.getElementById('cal');
  if (!cal) return;

  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var now = new Date();
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var thisMonth = today.slice(0, 7);
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var todayCell = cal.querySelector('li[data-day="' + today + '"]');
  if (todayCell) {
    todayCell.classList.add('is-today');
    todayCell.setAttribute('aria-current', 'date');
  }

  /* 1. Days that have come due since generation. ISO dates compare as strings. */
  var held = cal.querySelectorAll('li.soon[data-date]');
  var due = [];
  for (var i = 0; i < held.length; i++) {
    if (held[i].getAttribute('data-date') <= today) due.push(held[i]);
  }
  if (due.length && window.fetch) {
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
        var d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));

        var link = document.createElement('a');
        link.href = date + '/';
        link.setAttribute('aria-label', DAYS[d.getDay()] + ' ' + d.getDate() + ' ' +
                          MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ': ' + name);
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = d.getDate();
        var cat = document.createElement('span');
        cat.className = 'cat';
        cat.textContent = name;
        link.appendChild(n);
        link.appendChild(cat);

        li.innerHTML = '';
        li.classList.remove('soon');
        li.removeAttribute('data-date');
        li.appendChild(link);
      });
    })['catch'](function () { /* leave the days as generated */ });
  }

  /* 2. One month at a time. */
  var months = [].slice.call(cal.querySelectorAll('.month'));
  var nav = cal.querySelector('.cal-nav');
  if (!months.length || !nav) return;
  var title = nav.querySelector('.cal-title');
  var prev = nav.querySelector('[data-step="-1"]');
  var next = nav.querySelector('[data-step="1"]');

  /* The newest month that has begun on the visitor's clock. */
  var last = 0;
  months.forEach(function (m, j) { if (m.getAttribute('data-month') <= thisMonth) last = j; });

  var shown = last;
  var asked = /^#(\\d{4}-\\d{2})$/.exec(window.location.hash);
  if (asked) {
    months.forEach(function (m, j) { if (j <= last && m.getAttribute('data-month') === asked[1]) shown = j; });
  }

  function show(j, remember) {
    shown = j;
    months.forEach(function (m, k) { m.classList.toggle('is-shown', k === j); });
    title.textContent = months[j].querySelector('.month-title').textContent;
    /* A focused button that is about to be disabled would drop keyboard focus
       to the top of the page; hand it to the other button first. */
    var focused = document.activeElement;
    prev.disabled = next.disabled = false;
    if (focused === prev && j === 0) next.focus();
    if (focused === next && j >= last) prev.focus();
    prev.disabled = j === 0;
    next.disabled = j >= last;
    if (remember && window.history && history.replaceState) {
      history.replaceState(null, '', j === last ? window.location.pathname
                                                : '#' + months[j].getAttribute('data-month'));
    }
  }

  nav.addEventListener('click', function (e) {
    var button = e.target.closest ? e.target.closest('button[data-step]') : null;
    if (!button || button.disabled) return;
    show(shown + Number(button.getAttribute('data-step')), true);
  });

  nav.hidden = false;
  cal.classList.add('is-paged');
  show(shown, false);
})();
</script>{% endraw %}"""

# A Jekyll page (it has front matter), so it shares the site's head, top bar,
# footer and app band through _layouts/page.html. Everything below the front
# matter is plain HTML and must stay free of Liquid; the script is fenced off.
index_html = """---
layout: page
title: Past puzzles
seo_title: "Linky Words Daily · every puzzle so far"
description: "Every Linky Words daily puzzle released so far. Ten grids, one category, the same puzzle for everyone. Free in your browser."
lead: "Ten grids, one theme, the same puzzle for everyone. Pick a day to play it in your browser. New puzzles appear on the day they are due."
og_image: assets/og/landing.png
og_image_width: 1200
og_image_height: 630
og_image_alt: "Linky Words: a letter grid with LINKY, WORDS and PUZZLE traced through it."
prose: false
---
<!-- Generated by _tools/gen-archive.py. Do not edit by hand: rerun
     `python3 _tools/gen-archive.py` after exporting new days, and on any day
     the site is rebuilt, so the days that have since come due get their links. -->

<p class="archive-cta"><a class="btn btn-primary" href="../play/">Play today&rsquo;s puzzle</a></p>

<div class="cal" id="cal">
  <div class="cal-nav" hidden>
    <button type="button" class="cal-btn" data-step="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
    <p class="cal-title" aria-live="polite"></p>
    <button type="button" class="cal-btn" data-step="1" aria-label="Next month"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
  </div>

{sections}
</div>

{script}
""".format(sections="\n\n".join(sections), script=CALENDAR_SCRIPT)

with open(os.path.join(SITE, "d", "index.html"), "w") as handle:
    handle.write(index_html)

# ----------------------------------------------------------------- sitemap.xml

# The Jekyll-rendered pages, by the URL they are published at. Kept as a list
# here rather than discovered, because there are three of them and each one is
# a deliberate page rather than a file that happens to exist.
entries = [("%s/" % BASE, lastmod(os.path.join(SITE, "index.html"), *JEKYLL)),
           ("%s/privacypolicy/" % BASE, lastmod(os.path.join(SITE, "_pages", "privacypolicy.md"), *JEKYLL)),
           ("%s/changelog/" % BASE, lastmod(os.path.join(SITE, "_pages", "changelog.md"), *JEKYLL)),
           ("%s/play/" % BASE, lastmod(os.path.join(SITE, "play", "index.html"))),
           # written above, so an unchanged day leaves it byte-identical and dated
           # by its last commit
           ("%s/d/" % BASE, lastmod(os.path.join(SITE, "d", "index.html"), *JEKYLL))]

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
