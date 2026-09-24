/* Linky Words - browser daily. Vanilla JS, no build step, no dependencies. */
'use strict';

/* ------------------------------------------------------------------ *
 * Pure helpers (also exported for the node test harness at the bottom)
 * ------------------------------------------------------------------ */

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var EPOCH_Y = 2026, EPOCH_M = 9, EPOCH_D = 1;   /* daily index 0 = 2026-09-01 */
var MAX_INDEX = 72;                              /* 73 days: 0 .. 72 */
var HINT_CAP = 5;
var GREEN = '🟩';                      /* U+1F7E9 */
var YELLOW = '🟨';                     /* U+1F7E8 */
var STORE_PLAY = 'https://play.google.com/store/apps/details?id=com.metiscoda.linkletter';
/* pt = App Store Connect provider id, ct = campaign; installs report under App Analytics > Campaigns */
var STORE_APPLE = 'https://apps.apple.com/app/apple-store/id6476451925?pt=118914450&mt=8';
var APP_GRIDS = 390;   /* Classic 160 + Geography 136 + Mythology 97, rounded down */

/* analytics.js may be blocked or missing; the game never depends on it */
function track(name, params, then) {
  if (typeof window !== 'undefined' && typeof window.lwTrack === 'function') window.lwTrack(name, params, then);
  else if (typeof then === 'function') then();
}

/* 'YYYY-MM-DD' -> {y,m,d} or null */
function parseDateStr(s) {
  if (typeof s !== 'string') return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return { y: y, m: mo, d: d };
}

/*
 * Calendar days, never elapsed milliseconds.
 *
 * The roll-over is local midnight (matching DailySchedule.cs), so the calendar
 * Y/M/D we count with is read from the LOCAL clock - but the counting itself is
 * done in UTC, where every day is exactly 86400000 ms. Subtracting two local
 * timestamps instead loses (or gains) a day across a DST shift: under
 * TZ=America/Santiago that put 67 of the 73 days on the wrong puzzle and made
 * 2026-11-12 unreachable.
 */
function utcDayNumber(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }

var EPOCH_DAY = utcDayNumber(EPOCH_Y, EPOCH_M, EPOCH_D);

/* Day difference from the epoch. May fall outside [0,72]. */
function dayIndexForDate(s) {
  var p = parseDateStr(s);
  if (!p) return null;
  return utcDayNumber(p.y, p.m, p.d) - EPOCH_DAY;
}

function todayIndexRaw(now) {
  var n = now || new Date();
  return utcDayNumber(n.getFullYear(), n.getMonth() + 1, n.getDate()) - EPOCH_DAY;
}

function clampIndex(i) { return Math.max(0, Math.min(MAX_INDEX, i)); }

function indexToDateStr(i) {
  var d = new Date((EPOCH_DAY + i) * 86400000);
  var mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
}

/* Invariant-culture "d MMM yyyy": no leading zero on the day. */
function formatDisplayDate(s) {
  var p = parseDateStr(s);
  if (!p) return s;
  return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
}

function formatTime(totalSeconds) {
  var s = Math.max(0, Math.floor(totalSeconds));
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

/* tiles: 3 chars per cell, row-major -> [{r,c,used,hasLetter,letter}] */
function parseTiles(tiles, size) {
  var out = [];
  for (var i = 0; i < size * size; i++) {
    var chunk = tiles.substr(i * 3, 3);
    out.push({
      index: i,
      r: Math.floor(i / size),
      c: i % size,
      used: chunk.charAt(0) === '1',
      hasLetter: chunk.charAt(1) === '1',
      letter: chunk.charAt(2)
    });
  }
  return out;
}

/* 8-way, no wrap, not the same cell. */
function isAdjacent(a, b) {
  if (!a || !b) return false;
  var dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
  return (dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0);
}

/* path: array of cells. Every step adjacent, no cell reused, all playable. */
function isValidPath(path) {
  if (!path || path.length === 0) return false;
  var seen = {};
  for (var i = 0; i < path.length; i++) {
    var cell = path[i];
    if (!cell || !cell.used || !cell.hasLetter) return false;
    var key = cell.r + ',' + cell.c;
    if (seen[key]) return false;
    seen[key] = true;
    if (i > 0 && !isAdjacent(path[i - 1], cell)) return false;
  }
  return true;
}

function pathToWord(path) {
  var s = '';
  for (var i = 0; i < path.length; i++) s += path[i].letter;
  return s;
}

/*
 * Depth-first search for ONE chain that spells `word`. Returns cells or null.
 *
 * Only a "does a chain exist" check - 1187 of the 2448 words have more than one
 * legal chain, so the one it happens to return is not the player's and not part
 * of any consistent whole-board solution. Never highlight from this; highlight
 * from the path the player traced, or from solveLevel() below.
 */
function findWordPath(cells, size, word) {
  var byRC = {};
  for (var i = 0; i < cells.length; i++) byRC[cells[i].r + ',' + cells[i].c] = cells[i];

  function step(cell, idx, used) {
    if (!cell || !cell.used || !cell.hasLetter || cell.letter !== word.charAt(idx)) return null;
    var key = cell.r + ',' + cell.c;
    if (used[key]) return null;
    if (idx === word.length - 1) return [cell];
    used[key] = true;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = cell.r + dr, nc = cell.c + dc;
        if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
        var rest = step(byRC[nr + ',' + nc], idx + 1, used);
        if (rest) { used[key] = false; return [cell].concat(rest); }
      }
    }
    used[key] = false;
    return null;
  }

  for (var k = 0; k < cells.length; k++) {
    var found = step(cells[k], 0, {});
    if (found) return found;
  }
  return null;
}

/* Indices of the up-to-8 neighbours of `i` on a size x size board. */
function neighbourIndices(i, size) {
  var r = Math.floor(i / size), c = i % size, out = [];
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      var nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) out.push(nr * size + nc);
    }
  }
  return out;
}

/*
 * Solve the whole level at once: a set partition that gives every word its own
 * chain, no two words sharing a tile, together covering every lettered tile.
 * This is the same search as solveBoard() in scripts/daily/board-generator.js,
 * except that it keeps the assignment instead of only answering "solvable?".
 *
 * Returns an array of paths (arrays of cells) parallel to `words`, or null when
 * no partition exists. `pinned` optionally fixes some words to a path the player
 * already traced, as an array of cell indices; a pin that is not a legal chain
 * for its word makes the whole call return null, so the caller can retry free.
 */
function solveLevel(cells, size, words, pinned) {
  var taken = [], i;
  for (i = 0; i < cells.length; i++) taken.push(false);
  var result = [];
  for (i = 0; i < words.length; i++) result.push(null);

  for (i = 0; i < words.length; i++) {
    var pin = pinned && pinned[i];
    if (!pin) continue;
    if (pin.length !== words[i].length) return null;
    var path = [], ok = true;
    for (var j = 0; j < pin.length; j++) {
      var cell = cells[pin[j]];
      if (!cell || !cell.used || !cell.hasLetter) { ok = false; break; }
      if (taken[pin[j]]) { ok = false; break; }
      if (cell.letter !== words[i].charAt(j)) { ok = false; break; }
      if (j > 0 && !isAdjacent(cells[pin[j - 1]], cell)) { ok = false; break; }
      taken[pin[j]] = true;
      path.push(cell);
    }
    if (!ok) return null;
    result[i] = path;
  }

  var order = [];
  for (i = 0; i < words.length; i++) if (!result[i]) order.push(i);
  /* longest first prunes hardest */
  order.sort(function (a, b) { return words[b].length - words[a].length; });

  var all = [];
  for (i = 0; i < cells.length; i++) all.push(i);

  function trace(oi, path, at) {
    var wi = order[oi], word = words[wi], pos = path.length;
    if (pos === word.length) {
      result[wi] = path.slice();
      if (solveFrom(oi + 1)) return true;
      result[wi] = null;
      return false;
    }
    var cands = pos === 0 ? all : neighbourIndices(at, size);
    for (var x = 0; x < cands.length; x++) {
      var k = cands[x], t = cells[k];
      if (taken[k] || !t || !t.used || !t.hasLetter || t.letter !== word.charAt(pos)) continue;
      taken[k] = true;
      path.push(t);
      if (trace(oi, path, k)) return true;
      path.pop();
      taken[k] = false;
    }
    return false;
  }

  function solveFrom(oi) { return oi === order.length ? true : trace(oi, [], -1); }

  return solveFrom(0) ? result : null;
}

/* The shareable page for one day - the same URL the day's own /d/ page lives at. */
function dayUrl(dateStr) {
  return 'https://www.metiscoda.com/linky-words/d/' + dateStr + '/';
}

/*
 * Share text, byte-identical to DailyResult.cs:
 *   Linky Words Daily · 17 Sep 2026\n🟩🟩🟩🟨🟩\n🟩🟩🟩🟩🟩\n35 words · 8/10 no hints · 7:12
 */
function formatResult(dateStr, hintsPerLevel, totalWords, seconds) {
  var squares = '';
  var clean = 0;
  for (var i = 0; i < hintsPerLevel.length; i++) {
    if (hintsPerLevel[i] > 0) squares += YELLOW; else { squares += GREEN; clean++; }
    var isLast = (i === hintsPerLevel.length - 1);
    if (!isLast && (i + 1) % 5 === 0) squares += '\n';
  }
  var stats = '';
  if (totalWords > 0) stats += totalWords + ' words · ';
  stats += clean + '/' + hintsPerLevel.length + ' no hints · ' + formatTime(seconds);
  return 'Linky Words Daily · ' + formatDisplayDate(dateStr) + '\n' + squares + '\n' + stats;
}

/*
 * What the web actually shares: the app's scoreboard, byte-identical, then a
 * blank line and a link the recipient can tap. The app share has no link
 * because the app is already installed.
 */
function formatShare(dateStr, hintsPerLevel, totalWords, seconds) {
  return formatResult(dateStr, hintsPerLevel, totalWords, seconds) + '\n\n' + dayUrl(dateStr);
}

/* ------------------------------------------------------------------ *
 * Storage - every read and write guarded.
 * ------------------------------------------------------------------ */

var LS_DONE = 'lw.done.v1';
var LS_SRC = 'lw.src.v1';
var LS_PROGRESS = 'lw.progress.v1';

function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
function readJSON(key, fallback) {
  var raw = lsGet(key);
  if (!raw) return fallback;
  try {
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : fallback;
  } catch (e) { return fallback; }
}
function writeJSON(key, value) {
  try { return lsSet(key, JSON.stringify(value)); } catch (e) { return false; }
}

/* completed days: { "2026-09-17": {seconds, clean, words} } */
function loadDone() { return readJSON(LS_DONE, {}); }

function streakFrom(doneMap, todayIdx) {
  var n = 0;
  for (var i = clampIndex(todayIdx); i >= 0; i--) {
    if (doneMap[indexToDateStr(i)]) n++; else break;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * Game
 * ------------------------------------------------------------------ */

function boot() {
  var $ = function (id) { return document.getElementById(id); };
  var BASE = window.location.pathname.replace(/[^/]*$/, '');

  var params = new URLSearchParams(window.location.search);

  /* utm source: ?src=, else remembered, else "web" */
  var src = (params.get('src') || '').trim();
  if (src) lsSet(LS_SRC, src);
  else src = lsGet(LS_SRC) || 'web';
  src = src.replace(/[^\w.\- ]/g, '').slice(0, 40) || 'web';

  var S = {
    day: null,
    dateStr: null,
    level: 0,
    cells: [],
    size: 3,
    found: [],          /* per level: array of found word strings */
    foundPaths: [],     /* per level: word -> the tile indices the PLAYER traced */
    reveals: [],        /* per level: array of revealed-letter counts, per word */
    hintsPerLevel: [],
    hintsUsed: 0,
    path: [],
    pointerActive: false,
    movedSinceDown: false,
    tapMode: false,
    locked: {},         /* "r,c" -> true for tiles a found word has spent */
    assignCache: null,  /* {key, value} - the whole-level partition, for hints */
    elapsedMs: 0,
    runningSince: 0,
    tick: null,
    complete: false
  };

  /* ---------- day selection ---------- */

  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }

  function fail(detail) {
    show('loading', false);
    show('game', false);
    show('done', false);
    show('notfound', true);
    $('notfound-detail').textContent = detail;
  }

  $('btn-today').addEventListener('click', function () {
    window.location.href = BASE;
  });

  var wantedDate = params.get('d');
  var todayIdx = todayIndexRaw();
  var idx = null, failDetail = null;

  /*
   * Past days stay open - the web archive deliberately has no 7-day window.
   * Only the future is refused: without this clamp ?d=2026-11-12 handed out
   * Geology 55 days early and spoiled the rest of the run.
   */
  if (wantedDate) {
    var got = dayIndexForDate(wantedDate);
    if (got !== null && got >= 0 && got <= MAX_INDEX && got > todayIdx) {
      failDetail = 'The ' + formatDisplayDate(wantedDate) + ' puzzle opens that morning. Today’s is ready now.';
    } else if (got === null || got < 0 || got > MAX_INDEX) {
      failDetail = '“' + wantedDate + '” isn’t one of the 73 daily puzzles (1 Sep 2026 – 12 Nov 2026).';
    } else {
      idx = got;
    }
  } else if (todayIdx < 0) {
    failDetail = 'The first daily puzzle opens on 1 Sep 2026.';
  } else {
    idx = Math.min(MAX_INDEX, todayIdx);
  }

  if (idx === null) {
    fail(failDetail || 'Unknown day.');
    return;
  }

  var dayId = 'daily_' + String(idx).padStart(4, '0');

  fetch(BASE + 'data/' + dayId + '.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (day) { startDay(day); })
    .catch(function (err) {
      fail('Could not load that puzzle (' + err.message + '). Try today’s instead.');
    });

  /* ---------- setup ---------- */

  function startDay(day) {
    S.day = day;
    S.dateStr = day.date || indexToDateStr(idx);
    S.found = [];
    S.foundPaths = [];
    S.reveals = [];
    S.hintsPerLevel = [];
    for (var i = 0; i < day.levels.length; i++) {
      S.found.push([]);
      S.foundPaths.push({});
      S.reveals.push(day.levels[i].words.map(function () { return 0; }));
      S.hintsPerLevel.push(0);
    }
    restoreProgress();

    show('loading', false);
    show('notfound', false);
    show('game', true);

    $('d-category').textContent = day.category || '';
    $('d-date').textContent = formatDisplayDate(S.dateStr) + (idx === todayIdx ? ' · today' : '');
    $('foot-note').textContent = 'Puzzle ' + (idx + 1) + ' of 73.';

    $('btn-hint').addEventListener('click', useHint);
    $('btn-copy').addEventListener('click', copyResult);
    $('btn-share').addEventListener('click', shareResult);
    $('btn-play').addEventListener('click', function () {
      var referrer = 'utm_source=' + src + '&utm_medium=organic&utm_campaign=web-daily';
      storeClick('play', STORE_PLAY + '&referrer=' + encodeURIComponent(referrer));
    });
    $('btn-appstore').addEventListener('click', function () {
      /* ct mirrors the Play referrer's campaign, with the source appended when it is not the default */
      var ct = (src === 'web' ? 'web-daily' : 'web-daily.' + src).slice(0, 40);
      storeClick('appstore', STORE_APPLE + '&ct=' + encodeURIComponent(ct));
    });
    if (typeof navigator !== 'undefined' && navigator.share) $('btn-share').hidden = false;

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseTimer(); else if (!S.complete && S.elapsedMs > 0) resumeTimer();
    });
    window.addEventListener('resize', drawTrail);

    track('web_daily_open', { content_id: S.day.id || dayId, is_today: idx === todayIdx, src: src });

    if (S.level >= S.day.levels.length) { finishDay(false); return; }
    renderLevel();
  }

  function storeClick(store, url) {
    track('web_store_click', { store: store, streak: streakFrom(loadDone(), todayIdx), src: src },
      function () { window.location.href = url; });
  }

  /* ---------- progress persistence ---------- */

  function saveProgress() {
    writeJSON(LS_PROGRESS, {
      id: S.day.id,
      level: S.level,
      found: S.found,
      foundPaths: S.foundPaths,
      reveals: S.reveals,
      hintsPerLevel: S.hintsPerLevel,
      hintsUsed: S.hintsUsed,
      elapsedMs: elapsed()
    });
  }

  function restoreProgress() {
    var p = readJSON(LS_PROGRESS, null);
    if (!p || p.id !== S.day.id) return;
    try {
      if (Array.isArray(p.found) && p.found.length === S.found.length) S.found = p.found;
      if (Array.isArray(p.foundPaths) && p.foundPaths.length === S.foundPaths.length) {
        for (var k = 0; k < p.foundPaths.length; k++) {
          var entry = p.foundPaths[k];
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) S.foundPaths[k] = entry;
        }
      }
      if (Array.isArray(p.reveals) && p.reveals.length === S.reveals.length) S.reveals = p.reveals;
      if (Array.isArray(p.hintsPerLevel) && p.hintsPerLevel.length === S.hintsPerLevel.length) S.hintsPerLevel = p.hintsPerLevel;
      if (typeof p.hintsUsed === 'number') S.hintsUsed = Math.min(HINT_CAP, Math.max(0, p.hintsUsed));
      if (typeof p.level === 'number') S.level = Math.max(0, Math.min(S.day.levels.length, p.level));
      if (typeof p.elapsedMs === 'number' && p.elapsedMs >= 0) S.elapsedMs = p.elapsedMs;
    } catch (e) { /* ignore a malformed save */ }
  }

  /* ---------- timer ---------- */

  function elapsed() { return S.elapsedMs + (S.runningSince ? (Date.now() - S.runningSince) : 0); }

  function startTimer() {
    if (S.complete || S.runningSince) return;
    S.runningSince = Date.now();
    if (!S.tick) S.tick = window.setInterval(paintTimer, 500);
  }
  function pauseTimer() {
    if (S.runningSince) { S.elapsedMs += Date.now() - S.runningSince; S.runningSince = 0; }
    if (S.tick) { window.clearInterval(S.tick); S.tick = null; }
    paintTimer();
  }
  function resumeTimer() { startTimer(); }
  function paintTimer() { $('d-timer').textContent = formatTime(elapsed() / 1000); }

  /* ---------- rendering ---------- */

  function level() { return S.day.levels[S.level]; }

  function renderLevel() {
    var lv = level();
    S.size = lv.size;
    S.cells = parseTiles(lv.tiles, lv.size);
    S.path = [];
    S.assignCache = null;
    dropBadFoundPaths();

    var board = $('d-board');
    board.innerHTML = '';
    board.style.setProperty('--size', S.size);
    for (var k = 0; k < S.cells.length; k++) {
      var cell = S.cells[k];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile' + (cell.used && cell.hasLetter ? '' : ' tile-blank');
      b.dataset.r = cell.r;
      b.dataset.c = cell.c;
      b.dataset.i = cell.index;
      b.textContent = (cell.used && cell.hasLetter) ? cell.letter : '';
      if (!cell.used) b.disabled = true;
      b.setAttribute('aria-label', 'Row ' + (cell.r + 1) + ' column ' + (cell.c + 1) + ' letter ' + cell.letter);
      board.appendChild(b);
    }
    paintBoard();
    paintWords();
    paintStatus();
    paintTimer();
    message('');
  }

  function tileEl(cell) {
    return $('d-board').querySelector('[data-i="' + cell.index + '"]');
  }

  /* A traced path restored from storage is only trusted if it still spells its
     word as a legal chain on this board. Anything else is dropped, and that
     word falls back to the level assignment. */
  function dropBadFoundPaths() {
    var lv = level();
    var store = S.foundPaths[S.level] || (S.foundPaths[S.level] = {});
    var spent = {};
    for (var w in store) {
      if (!Object.prototype.hasOwnProperty.call(store, w)) continue;
      var p = store[w], path = [], ok = Array.isArray(p) && p.length === w.length;
      for (var i = 0; ok && i < p.length; i++) {
        var cell = S.cells[p[i]];
        /* a tile another restored word already holds - two words cannot share one */
        if (!cell || cell.letter !== w.charAt(i) || spent[p[i]]) { ok = false; break; }
        path.push(cell);
      }
      if (!ok || !isValidPath(path) || lv.words.indexOf(w) === -1) { delete store[w]; continue; }
      for (var j = 0; j < p.length; j++) spent[p[j]] = true;
    }
  }

  /* The path the player actually traced for a found word, or null. */
  function tracedPath(word) {
    var p = (S.foundPaths[S.level] || {})[word];
    if (!p) return null;
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var cell = S.cells[p[i]];
      if (!cell) return null;
      out.push(cell);
    }
    return out;
  }

  /*
   * One partition for the whole level, so hints never light a tile that belongs
   * to another word. Words the player has already traced are pinned to their own
   * path, so the hint assignment agrees with what is already on the board.
   * Cached; the key changes only when the found set does.
   */
  function currentAssignment() {
    var lv = level();
    var pinned = [], sig = [];
    for (var i = 0; i < lv.words.length; i++) {
      var p = S.found[S.level].indexOf(lv.words[i]) === -1 ? null : (S.foundPaths[S.level] || {})[lv.words[i]];
      pinned.push(p || null);
      sig.push(p ? p.join('.') : '');
    }
    var key = S.day.id + '#' + S.level + '#' + sig.join('|');
    if (S.assignCache && S.assignCache.key === key) return S.assignCache.value;
    var value = solveLevel(S.cells, S.size, lv.words, pinned) ||
                solveLevel(S.cells, S.size, lv.words, null);
    S.assignCache = { key: key, value: value };
    return value;
  }

  function foundCells() {
    /* every cell locked by an already-found word on this level */
    var lockedMap = {};
    var lv = level();
    var assign = null;
    for (var i = 0; i < lv.words.length; i++) {
      var word = lv.words[i];
      if (S.found[S.level].indexOf(word) === -1) continue;
      var p = tracedPath(word);
      if (!p) {                       /* a save from before paths were recorded */
        if (!assign) assign = currentAssignment();
        p = assign && assign[i];
      }
      if (p) for (var j = 0; j < p.length; j++) lockedMap[p[j].r + ',' + p[j].c] = true;
    }
    return lockedMap;
  }

  function hintCells() {
    /* the first `reveals[i]` tiles of every unfound word that has been hinted */
    var lv = level();
    var out = {}, assign = null;
    for (var i = 0; i < lv.words.length; i++) {
      var n = S.reveals[S.level][i] || 0;
      if (!n || S.found[S.level].indexOf(lv.words[i]) !== -1) continue;
      if (!assign) assign = currentAssignment();
      var p = assign && assign[i];
      if (!p) continue;
      for (var j = 0; j < n && j < p.length; j++) out[p[j].r + ',' + p[j].c] = true;
    }
    return out;
  }

  function paintBoard() {
    var locked = foundCells();
    var hinted = hintCells();
    S.locked = locked;
    var inPath = {};
    for (var i = 0; i < S.path.length; i++) inPath[S.path[i].r + ',' + S.path[i].c] = true;
    var tiles = $('d-board').children;
    for (var k = 0; k < tiles.length; k++) {
      var t = tiles[k];
      var key = t.dataset.r + ',' + t.dataset.c;
      var cell = S.cells[+t.dataset.i];
      t.classList.toggle('is-found', !!locked[key]);
      t.classList.toggle('is-active', !!inPath[key]);
      t.classList.toggle('is-hint', !!hinted[key] && !locked[key]);
      /* a found tile is spent: GameManager.OnWordFound marks it Found and
         LetterBoard only builds a tile for UsedButNotFound, so the app takes it
         off the board. Letting the web reuse it would put two words on one tile
         and leave another tile uncovered. */
      t.disabled = !cell || !cell.used || !!locked[key];
    }
    drawTrail();
  }

  function drawTrail() {
    var svg = $('d-trail'), board = $('d-board');
    if (!svg || !board) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var rect = board.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + Math.max(1, rect.width) + ' ' + Math.max(1, rect.height));
    if (S.path.length < 2) return;
    var pts = [];
    for (var i = 0; i < S.path.length; i++) {
      var el = tileEl(S.path[i]);
      if (!el) return;
      var r = el.getBoundingClientRect();
      pts.push((r.left - rect.left + r.width / 2) + ',' + (r.top - rect.top + r.height / 2));
    }
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('class', 'trail-line');
    svg.appendChild(line);
  }

  function paintWords() {
    var lv = level();
    var list = $('d-words');
    list.innerHTML = '';
    for (var i = 0; i < lv.words.length; i++) {
      var word = lv.words[i];
      var isFound = S.found[S.level].indexOf(word) !== -1;
      var shown = isFound ? word.length : (S.reveals[S.level][i] || 0);
      var li = document.createElement('li');
      li.className = 'word' + (isFound ? ' word-found' : '');
      for (var j = 0; j < word.length; j++) {
        var span = document.createElement('span');
        span.className = 'ch' + (j < shown ? '' : ' ch-hidden');
        span.textContent = j < shown ? word.charAt(j) : '·';
        li.appendChild(span);
      }
      li.setAttribute('aria-label', isFound ? word + ', found' : word.length + ' letter word');
      list.appendChild(li);
    }
  }

  function paintStatus() {
    var lv = level();
    var remaining = lv.words.length - S.found[S.level].length;
    $('d-level').textContent = 'Level ' + (S.level + 1) + ' of ' + S.day.levels.length +
      ' · ' + remaining + ' word' + (remaining === 1 ? '' : 's') + ' left';
    var left = HINT_CAP - S.hintsUsed;
    $('d-hints').textContent = left + ' left';
    $('btn-hint').disabled = left <= 0;
  }

  function message(text) {
    $('d-message').textContent = text || ' ';
  }

  /* ---------- pointer / tap input ---------- */

  var board = $('d-board');

  function cellFromEvent(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return null;
    var t = el.closest ? el.closest('.tile') : null;
    if (!t || !board.contains(t)) return null;
    var cell = S.cells[+t.dataset.i];
    return playable(cell) ? cell : null;
  }

  /* a tile can be traced only while it is lettered and not already spent */
  function playable(cell) {
    return !!cell && cell.used && cell.hasLetter && !(S.locked || {})[cell.r + ',' + cell.c];
  }

  function lastCell() { return S.path.length ? S.path[S.path.length - 1] : null; }

  function inPath(cell) {
    for (var i = 0; i < S.path.length; i++) if (S.path[i].index === cell.index) return i;
    return -1;
  }

  function tryExtend(cell) {
    var at = inPath(cell);
    if (at !== -1) {
      /* stepping back onto the previous tile trims the tail */
      if (at === S.path.length - 2) { S.path.pop(); paintBoard(); return true; }
      return false;
    }
    if (!S.path.length || isAdjacent(lastCell(), cell)) {
      S.path.push(cell);
      if (!isValidPath(S.path)) { S.path.pop(); return false; }
      paintBoard();
      return true;
    }
    return false;
  }

  function startPath(cell) { S.path = [cell]; paintBoard(); }

  board.addEventListener('pointerdown', function (e) {
    var cell = cellFromEvent(e);
    if (!cell) return;
    e.preventDefault();
    startTimer();
    S.pointerActive = true;
    S.movedSinceDown = false;
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }

    if (S.tapMode && S.path.length) {
      var last = lastCell();
      if (cell.index === last.index) { S.pointerActive = false; submit(); return; }
      if (!tryExtend(cell)) startPath(cell);
    } else {
      startPath(cell);
    }
  });

  board.addEventListener('pointermove', function (e) {
    if (!S.pointerActive) return;
    var cell = cellFromEvent(e);
    if (!cell) return;
    var last = lastCell();
    if (last && cell.index === last.index) return;
    if (tryExtend(cell)) S.movedSinceDown = true;
  });

  function endPointer(e) {
    if (!S.pointerActive) return;
    S.pointerActive = false;
    try { board.releasePointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    if (S.movedSinceDown) { S.tapMode = false; submit(); }
    else { S.tapMode = true; }   /* a plain tap keeps the chain open */
  }

  board.addEventListener('pointerup', endPointer);
  board.addEventListener('pointercancel', function (e) {
    if (!S.pointerActive) return;
    S.pointerActive = false;
    S.path = [];
    S.tapMode = false;
    paintBoard();
  });
  board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* keyboard: Enter/Space walks the same chain, Escape clears it */
  board.addEventListener('keydown', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.tile') : null;
    if (!t || !board.contains(t)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      S.path = []; S.tapMode = false; paintBoard();
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var cell = S.cells[+t.dataset.i];
    if (!playable(cell)) return;
    e.preventDefault();          /* also stops the synthesized click */
    startTimer();
    var last = lastCell();
    if (S.path.length && last && cell.index === last.index) { submit(); return; }
    if (!S.path.length || !tryExtend(cell)) startPath(cell);
    S.tapMode = true;
  });

  /* ---------- submitting a chain ---------- */

  function submit() {
    var lv = level();
    var word = pathToWord(S.path);
    var ok = isValidPath(S.path) && lv.words.indexOf(word) !== -1 && S.found[S.level].indexOf(word) === -1;
    if (ok) {
      S.found[S.level].push(word);
      /* remember the chain the PLAYER traced - that is what lights up */
      var traced = [];
      for (var i = 0; i < S.path.length; i++) traced.push(S.path[i].index);
      S.foundPaths[S.level][word] = traced;
      S.path = [];
      S.tapMode = false;
      paintBoard();
      paintWords();
      paintStatus();
      message(word + ' ✓');
      saveProgress();
      if (S.found[S.level].length === lv.words.length) {
        window.setTimeout(nextLevel, 450);
      }
    } else {
      var known = lv.words.indexOf(word) !== -1;
      S.path = [];
      S.tapMode = false;
      paintBoard();
      message(word.length > 1 ? (known ? 'Already found' : 'Not a word here') : '');
    }
  }

  function nextLevel() {
    S.level++;
    saveProgress();
    if (S.level >= S.day.levels.length) { finishDay(true); return; }
    renderLevel();
  }

  /* ---------- hints ---------- */

  function useHint() {
    if (S.complete) return;
    if (S.hintsUsed >= HINT_CAP) { message('No hints left today'); return; }
    startTimer();
    var lv = level();
    var pick = -1;
    for (var i = 0; i < lv.words.length; i++) {
      if (S.found[S.level].indexOf(lv.words[i]) !== -1) continue;
      var rev = S.reveals[S.level][i] || 0;
      if (rev >= lv.words[i].length) continue;              /* fully spelled out already */
      if (pick === -1) { pick = i; continue; }
      var bestRev = S.reveals[S.level][pick] || 0;
      /* finish a word that is already part-revealed, otherwise take the shortest */
      if (rev > bestRev || (rev === bestRev && lv.words[i].length < lv.words[pick].length)) pick = i;
    }
    if (pick === -1) { message('Every remaining word is already spelled out'); return; }

    var word = lv.words[pick];
    var n = (S.reveals[S.level][pick] || 0) + 1;
    S.reveals[S.level][pick] = n;
    S.hintsUsed++;
    S.hintsPerLevel[S.level] = (S.hintsPerLevel[S.level] || 0) + 1;

    paintBoard();     /* hintCells() reads S.reveals through the level assignment */
    paintWords();
    paintStatus();
    message('Hint: a word starts ' + word.slice(0, n));
    saveProgress();
  }

  /* ---------- finishing ---------- */

  function totalWords() {
    var n = 0;
    for (var i = 0; i < S.day.levels.length; i++) n += S.day.levels[i].words.length;
    return n;
  }

  function finishDay(justNow) {
    S.complete = true;
    pauseTimer();
    var seconds = Math.floor(elapsed() / 1000);
    var result = formatResult(S.dateStr, S.hintsPerLevel, totalWords(), seconds);

    show('game', false);
    show('done', true);
    /* shown, copied and shared with the link; the scoreboard above it stays
       byte-identical to the app's, so an app share and a web share read alike */
    $('d-result').textContent = formatShare(S.dateStr, S.hintsPerLevel, totalWords(), seconds);
    $('btn-copy').dataset.text = $('d-result').textContent;
    $('btn-share').dataset.url = dayUrl(S.dateStr);
    $('btn-share').dataset.text = result;

    var done = loadDone();
    if (!done[S.dateStr] || justNow) {
      var clean = 0;
      for (var i = 0; i < S.hintsPerLevel.length; i++) if (!S.hintsPerLevel[i]) clean++;
      done[S.dateStr] = { seconds: seconds, clean: clean, words: totalWords() };
      writeJSON(LS_DONE, done);
    }
    saveProgress();

    var n = streakFrom(loadDone(), todayIdx);
    $('d-streak').textContent = n > 1
      ? n + ' days in a row.'
      : (n === 1 ? 'Day 1 of a new streak.' : '');
    renderCta(n);

    if (justNow) {
      track('web_day_complete', {
        content_id: S.day.id || dayId, seconds: seconds, hints: S.hintsUsed, streak: n
      });
    }
  }

  /* A first visit wants more to play; a returning player has a habit to keep. */
  function renderCta(streak) {
    if (streak > 1) {
      $('cta-title').textContent = 'Keep the streak in your pocket';
      $('cta-line').textContent = 'The app reminds you at 7pm so a busy day doesn’t cost you the streak, '
        + 'and has ' + APP_GRIDS + ' more grids for when today’s are done. Free, and it plays offline.';
    } else {
      $('cta-title').textContent = 'Want more?';
      $('cta-line').textContent = 'The app has ' + APP_GRIDS + ' more grids in Classic, Geography '
        + 'and Mythology, plus a new daily every morning. Free, and it plays offline.';
    }
  }

  function copyResult() {
    var text = $('btn-copy').dataset.text || $('d-result').textContent;
    var done = function () {
      $('btn-copy').textContent = 'Copied';
      track('web_share', { method: 'copy', content_id: S.day.id || dayId });
      window.setTimeout(function () { $('btn-copy').textContent = 'Copy result'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done();
    else $('btn-copy').textContent = 'Select the text above';
  }

  function shareResult() {
    if (!navigator.share) return;
    /* url goes in its own field, so the scoreboard is not carrying a bare link
       the recipient cannot tap - and text stays free of it, or every sheet that
       appends the url would print it twice */
    var payload = { text: $('btn-share').dataset.text || $('d-result').textContent };
    if ($('btn-share').dataset.url) payload.url = $('btn-share').dataset.url;
    navigator.share(payload).then(function () {
      track('web_share', { method: 'share', content_id: S.day.id || dayId });
    }, function () { /* dismissed */ });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseTiles: parseTiles,
    isAdjacent: isAdjacent,
    isValidPath: isValidPath,
    pathToWord: pathToWord,
    findWordPath: findWordPath,
    solveLevel: solveLevel,
    formatResult: formatResult,
    formatShare: formatShare,
    dayUrl: dayUrl,
    formatDisplayDate: formatDisplayDate,
    formatTime: formatTime,
    dayIndexForDate: dayIndexForDate,
    todayIndexRaw: todayIndexRaw,
    indexToDateStr: indexToDateStr,
    clampIndex: clampIndex,
    MAX_INDEX: MAX_INDEX
  };
}
