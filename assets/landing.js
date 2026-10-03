/* Linky Words - front page. Two small jobs, both optional: the page reads and
 * works without this file.
 *
 * 1. Put today's theme and date on the "Today's puzzle" card. "Today" is the
 *    visitor's local calendar date, the same rule the player uses (local
 *    midnight, matching DailySchedule.cs), so the card names the puzzle that
 *    play/ will open. A date missing from the index leaves the card generic.
 * 2. Start the board animation once the board is on screen (CSS holds it
 *    paused until then, and skips it for reduced motion).
 */
'use strict';

(function () {
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var card = document.getElementById('today');
  if (card && window.fetch) {
    var now = new Date();
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    fetch(card.getAttribute('data-index'))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (days) {
        for (var i = 0; i < days.length; i++) {
          if (days[i].date === today && days[i].category) {
            document.getElementById('today-cat').textContent = days[i].category;
            document.getElementById('today-date').textContent =
              DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
            card.className += ' has-day';
            return;
          }
        }
      })
      .catch(function () { /* keep the generic card */ });
  }

  var demo = document.querySelector('.demo');
  if (demo) {
    var play = function () { demo.className += ' is-playing'; };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { io.disconnect(); play(); return; }
        }
      }, { threshold: 0.6 });
      io.observe(demo);
    } else {
      play();
    }
  }
})();
