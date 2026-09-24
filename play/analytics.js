/* Linky Words - web analytics. Google Analytics 4 through the Firebase web app
 * "Linky Words Web" (project linky-words-470002, measurement id below).
 *
 * The only third-party request the player makes. Everything here is optional:
 * if the script is blocked or never loads, lwTrack() queues into dataLayer and
 * the game plays exactly the same.
 *
 * Events (read by scripts/ga4-report.js in the game repo, plan section 6):
 *   web_daily_open    a day's grids loaded           content_id, is_today, src
 *   web_day_complete  the tenth grid solved          content_id, seconds, hints, streak
 *   web_store_click   a store button pressed         store, streak, src
 *   web_share         result copied or shared        method, content_id
 *
 * Consent: no advertising storage or signals anywhere. Analytics cookies are
 * denied by default in the EEA, UK and Switzerland, where there is no banner to
 * ask, so visits there send cookieless pings only.
 */
'use strict';

(function () {
  var ID = 'G-RWN7TL2FFE';
  var CONSENT_REGIONS = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'GB', 'CH'
  ];

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'granted'
  });
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied',
    region: CONSENT_REGIONS
  });
  gtag('set', 'ads_data_redaction', true);
  gtag('js', new Date());
  gtag('config', ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);

  /* Fire and forget. With `then`, calls it once the hit is sent - or after
     600 ms, so a blocked script never holds up a store redirect. */
  window.lwTrack = function (name, params, then) {
    var p = {};
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
    if (typeof then === 'function') {
      var called = false;
      var once = function () { if (!called) { called = true; then(); } };
      p.event_callback = once;
      p.event_timeout = 600;
      window.setTimeout(once, 700);
    }
    try { gtag('event', name, p); } catch (e) { if (typeof then === 'function') then(); }
  };
})();
