// Core shell: router, demo clock, idle/ambient, toasts, sheets, helpers.
(function () {
  'use strict';
  var D = window.DATA;
  var App = window.App = { state: D, views: {}, current: null, mode: 'day', calMode: 'normal' };
  var $ = App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ events
  var handlers = {};
  App.on = function (e, fn) { (handlers[e] = handlers[e] || []).push(fn); };
  App.emit = function (e, a) { (handlers[e] || []).forEach(function (fn) { fn(a); }); };

  // ------------------------------------------------------------ time (demo clock)
  var offset = 0;
  App.now = function () { return new Date(Date.now() + offset); };
  App.setTime = function (h, m) {
    if (h == null) offset = 0;
    else { var d = new Date(); d.setHours(h, m, 0, 0); offset = d - Date.now(); }
    lastMin = -1;
    App.emit('time');
    App.rerender();
  };
  App.dayStart = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  App.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  App.sameDay = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  App.settings = { screensaverAfter: 120, photoSeconds: 30, showClock: true, showPhotoInfo: true,
    returnHomeAfter: 60, nightMode: true, nightStart: 22, nightEnd: 6, nightScreen: 'clock' };
  App.isNight = function () {
    var st = App.settings, h = App.now().getHours();
    return st.nightMode !== false && (h >= st.nightStart || h < st.nightEnd);
  };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  App.fmt = {
    time: function (d, ampm) {
      var h = d.getHours(), m = d.getMinutes();
      var s = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m;
      return ampm === false ? s : s + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    // "4 PM", "3:45 PM"
    hour: function (d) {
      var h = d.getHours(), m = d.getMinutes();
      return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    ampm: function (d) { return d.getHours() >= 12 ? 'PM' : 'AM'; },
    range: function (a, b) {
      var same = App.fmt.ampm(a) === App.fmt.ampm(b);
      return (same ? App.fmt.time(a, false) : App.fmt.time(a)) + ' – ' + App.fmt.time(b);
    },
    day: function (d) { return DAYS[d.getDay()]; },
    dayShort: function (d) { return DAYS[d.getDay()].slice(0, 3); },
    month: function (d) { return MONTHS[d.getMonth()]; },
    monthShort: function (d) { return MON_SHORT[d.getMonth()]; },
    mins: function (m) {
      m = Math.max(0, Math.round(m));
      if (m < 60) return m + ' min';
      var h = Math.floor(m / 60), r = m % 60;
      return h + ' hr' + (r ? ' ' + r + ' min' : '');
    },
    rel: function (d) {
      var t = App.dayStart(App.now()), x = App.dayStart(d), diff = Math.round((x - t) / 864e5);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return DAYS[d.getDay()];
    }
  };
  App.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // ------------------------------------------------------------ icons + people
  App.icon = function (name, size, cls) {
    size = size || 24;
    return '<svg class="i ' + (cls || '') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (window.ICONS[name] || '') + '</svg>';
  };
  App.person = function (id) {
    if (id === 'family' || id === 'any') return D.family;
    for (var i = 0; i < D.people.length; i++) if (D.people[i].id === id) return D.people[i];
    return D.family;
  };
  App.pstyle = function (p) {
    if (typeof p === 'string') p = App.person(p);
    return '--c:' + p.color + ';--c-rgb:' + p.rgb + ';--c-ink:' + p.ink;
  };
  App.avatar = function (p, size, cls) {
    if (typeof p === 'string') p = App.person(p);
    size = size || 48;
    return '<span class="avatar ' + (cls || '') + '" style="' + App.pstyle(p) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.46) + 'px">' + (p.id === 'family' ? '★' : p.name[0]) + '</span>';
  };
  App.dots = function (ids, size) {
    return '<span class="dots">' + ids.map(function (id) { return '<i style="' + App.pstyle(id) + (size ? ';width:' + size + 'px;height:' + size + 'px' : '') + '"></i>'; }).join('') + '</span>';
  };

  // ------------------------------------------------------------ calendar helpers
  App.events = function () {
    var list = D.events.slice();
    var today = App.dayStart(App.now());
    if (App.calMode === 'busy') list = list.concat(D.busyExtras);
    if (App.calMode === 'empty') list = list.filter(function (e) { return e.allDay || !App.sameDay(e.start, today); });
    return list;
  };
  App.isFamily = function (e) { return e.people.length >= D.people.length; };
  App.evColor = function (e) { return App.isFamily(e) ? D.family : App.person(e.people[0]); };
  App.timedOn = function (day, pid) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return !ev.allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    }).sort(function (a, b) { return a.start - b.start || b.end - a.end; });
  };
  App.allDayOn = function (day, pid) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return ev.allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    });
  };
  App.leaveBy = function (e) { return e.travel ? new Date(+e.start - e.travel * 60000) : e.start; };
  // The next thing someone needs to act on: earliest upcoming "leave by" today.
  App.nextEvent = function () {
    var now = App.now();
    var list = App.timedOn(now).filter(function (e) { return e.start > now; });
    list.sort(function (a, b) { return App.leaveBy(a) - App.leaveBy(b); });
    return list[0] || null;
  };
  App.findEvent = function (id) {
    return App.events().filter(function (e) { return e.id === id; })[0];
  };

  // ------------------------------------------------------------ chores + weather helpers
  App.currentRoutine = function () {
    var h = App.now().getHours();
    for (var i = 0; i < D.routines.length; i++) if (h >= D.routines[i].from && h < D.routines[i].to) return D.routines[i];
    return D.routines[2];
  };
  // Weather description from frame-hub's detailed forecast (WMO codes, rain chance and amount,
  // feels-like, gusts, UV). The demo data has none of that and keeps the simple wording.
  var WMO = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Storms with hail', 99: 'Storms with hail'
  };
  function wmoLabel(code, day) {
    if (day && code === 0) return 'Sunny';
    if (day && code === 1) return 'Mostly sunny';
    return WMO[code] || 'Cloudy';
  }
  function precipKind(code) {
    if (code >= 95) return 'storms';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 80) return 'showers';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 61) return 'rain';
    return null;
  }
  function detailedWeather(W, h) {
    var F = function (t) { return D.units === 'F' ? t : t * 9 / 5 + 32; }; // thresholds below are in °F
    var gustMph = function (g) { return D.units === 'F' ? g : g / 1.609; };
    var end = Math.min(W.wc.length, h + 12), hrs = [];
    for (var i = h; i < end; i++) hrs.push(i);
    var hourName = function (i) { return App.fmt.hour(new Date(2000, 0, 1, i % 24)); };
    var wet = function (i) { return !!precipKind(W.wc[i]) || (W.p[i] >= 50 && W.mm[i] > 0.1); };
    var kindAt = function (i) { return precipKind(W.wc[i]) || 'rain'; };
    var now = W.now || { t: W.t[h], feels: W.f[h], code: W.wc[h], day: !!W.day[h], gust: W.g[h] };

    var summary;
    var firstWet = hrs.filter(wet)[0];
    if (wet(h) || precipKind(now.code)) {
      var stop = h; while (stop < end && wet(stop)) stop++;
      var k = precipKind(now.code) || kindAt(h);
      var K = k.charAt(0).toUpperCase() + k.slice(1);
      summary = stop >= end ? K + ' through ' + (h + 12 >= 24 ? 'tonight' : 'the day') : K + ' until ' + hourName(stop);
    } else if (firstWet != null) {
      var chance = Math.max.apply(null, hrs.filter(function (i) { return i >= firstWet && i < firstWet + 3; }).map(function (i) { return W.p[i]; }));
      var kw = kindAt(firstWet), Kw = kw.charAt(0).toUpperCase() + kw.slice(1);
      summary = Kw + (chance >= 60 ? ' likely' : ' possible') + (firstWet - h <= 1 ? ' soon' : ' around ' + hourName(firstWet));
    } else {
      var cloudy = function (i) { return W.wc[i] >= 3; };
      var nowCloudy = cloudy(h), laterClear = hrs.slice(3).some(function (i) { return !cloudy(i); });
      var allCloudy = hrs.every(cloudy), allClear = hrs.every(function (i) { return W.wc[i] <= 1; });
      if (W.wc[h] === 45 || W.wc[h] === 48) summary = 'Foggy, dry later';
      else if (allClear) summary = now.day ? 'Sunny and dry' : 'Clear and dry';
      else if (allCloudy) summary = 'Cloudy and dry';
      else if (nowCloudy && laterClear) summary = 'Clearing later';
      else summary = 'Dry, some clouds';
    }
    // Temperature trend over the next few hours.
    var ahead = hrs.slice(1, 9), peak = ahead.length ? Math.max.apply(null, ahead.map(function (i) { return W.t[i]; })) : now.t;
    var low = ahead.length ? Math.min.apply(null, ahead.map(function (i) { return W.t[i]; })) : now.t;
    var trend = '';
    if (F(peak) - F(now.t) >= 4) trend = ', warming to ' + peak + '°';
    else if (F(now.t) - F(low) >= 6) trend = ', cooling to ' + low + '°';

    var feels = F(now.feels), gust = Math.max.apply(null, hrs.slice(0, 6).map(function (i) { return gustMph(W.g[i]); }));
    var uv = Math.max.apply(null, hrs.slice(0, 6).map(function (i) { return W.uv[i]; }));
    var wetSoon = hrs.slice(0, 6).filter(wet), soonKind = wetSoon.length ? kindAt(wetSoon[0]) : null;
    var advice;
    if (soonKind === 'storms') advice = 'Stay in during storms';
    else if (soonKind === 'snow' || feels <= 32) advice = 'Bundle up';
    else if (wetSoon.length) advice = Math.max.apply(null, wetSoon.map(function (i) { return W.p[i]; })) >= 60 ? 'Bring an umbrella' : 'Pack a rain jacket';
    else if (feels <= 45) advice = 'Coat weather';
    else if (feels <= 58) advice = 'Jacket weather';
    else if (gust >= 28) advice = 'Windy out';
    else if (feels >= 90) advice = 'Hot, drink water';
    else if (uv >= 7 && now.day) advice = 'Wear sunscreen';
    else if (feels >= 75) advice = 'T-shirt weather';
    else advice = 'Light layers';

    return { temp: now.t, cond: W.c[h], label: wmoLabel(now.code, now.day), hi: W.hi, lo: W.lo, summary: summary + trend, advice: advice, hour: h };
  }

  App.weatherNow = function () {
    var W = D.weather, h = App.now().getHours();
    if (W.wc && W.wc.length > h) return detailedWeather(W, h);
    var rainAt = -1;
    function wet(i) { return W.p[i] >= 50 || W.c[i] === 'rain' || W.c[i] === 'snow'; }
    for (var i = h; i < 24; i++) if (wet(i)) { rainAt = i; break; }
    var summary, advice;
    if (rainAt === h) {
      var stop = h; while (stop < 24 && wet(stop)) stop++;
      summary = 'Rain until ' + App.fmt.hour(new Date(2000, 0, 1, stop));
      advice = 'Umbrella weather';
    } else if (rainAt > -1) {
      summary = 'Rain from ' + App.fmt.hour(new Date(2000, 0, 1, rainAt));
      var soccer = App.timedOn(App.now()).filter(function (e) { return /soccer/i.test(e.title) && e.start > App.now(); })[0];
      advice = soccer ? 'Pack a rain jacket for soccer' : 'Grab a rain jacket';
    } else {
      var cool = W.t[h] < (D.units === 'F' ? 54 : 12);
      summary = cool ? 'Clear and cool' : 'Dry all day';
      advice = cool ? 'Jacket weather' : 'Light layers';
    }
    var labels = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain', snow: 'Snow', fog: 'Fog', storm: 'Storms' };
    return { temp: W.t[h], cond: W.c[h], label: labels[W.c[h]], hi: W.hi, lo: W.lo, summary: summary, advice: advice, hour: h };
  };
  App.hourly = function (count) {
    var W = D.weather, h = App.now().getHours(), out = [];
    for (var i = 0; i < count; i++) {
      var k = h + i < W.t.length ? h + i : (h + i) % 24, x = (h + i) % 24; // hub sends 48 h (today + tomorrow)
      out.push({ h: x, t: W.t[k], c: W.c[k], p: W.p[k], label: i === 0 ? 'Now' : ((x % 12 || 12) + (x >= 12 ? 'p' : 'a')) });
    }
    return out;
  };

  // ------------------------------------------------------------ router
  App.register = function (name, view) { App.views[name] = view; };
  // Views are built once and kept laid out (hidden with content-visibility), so switching tabs
  // only has to paint. A view is rebuilt when its data changed ('data'/'time' events) or, for
  // time-sensitive views (minutely: true), when the minute has rolled over since it was built.
  function minuteKey() { return Math.floor(App.now().getTime() / 60000); }
  function build(name, opts) {
    var view = App.views[name];
    view.show($('#view-' + name), opts || {});
    view._built = true; view._dirty = false; view._min = minuteKey();
  }
  App.go = function (name, opts) {
    opts = opts || {};
    if (!App.views[name]) name = 'home';
    if (App.current && App.current !== name && App.views[App.current].hide) App.views[App.current].hide();
    App.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === name); });
    App.$$('.rail-item').forEach(function (b) { b.classList.toggle('is-active', b.dataset.go === name); });
    App.current = name;
    var view = App.views[name];
    if (!view._built || view._dirty || opts.rerender || (view.minutely && view._min !== minuteKey())) build(name, opts);
    else if (view.resume) view.resume($('#view-' + name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  };
  // Build a hidden view and lay it out now (cached by content-visibility; no paint happens).
  function prebuild(name) {
    var el = $('#view-' + name), view = App.views[name];
    build(name);
    if (view.hide) view.hide();
    el.classList.add('is-warming');
    el.offsetHeight;
    el.classList.remove('is-warming');
  }
  // Pre-build (startup) and re-build (after data changes) hidden views in the background, one per
  // slot, so navigating to them never pays the rebuild cost.
  var refreshTimer = null;
  function refreshStale(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function next() {
      var name = Object.keys(App.views).filter(function (k) {
        var v = App.views[k];
        return k !== App.current && (!v._built || v._dirty);
      })[0];
      if (!name) return;
      prebuild(name);
      refreshTimer = setTimeout(next, 400);
    }, delay);
  }
  function markStale() {
    Object.keys(App.views).forEach(function (k) { if (k !== App.current) App.views[k]._dirty = true; });
    refreshStale(1500);
  }
  App.on('data', markStale);
  App.on('time', markStale);
  App.rerender = function () {
    if (App.current) App.views[App.current].show($('#view-' + App.current), { rerender: true });
  };

  // ------------------------------------------------------------ toasts (single, with undo)
  var toastTimer;
  App.toast = function (html, opts) {
    opts = opts || {};
    var box = $('#toasts');
    box.innerHTML = '';
    clearTimeout(toastTimer);
    var ms = opts.ms || 5000;
    var t = document.createElement('div');
    t.className = 'toast' + (opts.tone ? ' toast--' + opts.tone : '');
    t.style.setProperty('--ms', ms + 'ms');
    t.innerHTML = (opts.icon ? App.icon(opts.icon, 26) : '') + '<span class="toast-msg">' + html + '</span>' +
      (opts.undo ? '<button class="toast-undo">' + App.icon('undo', 22) + 'Undo</button>' : '');
    box.appendChild(t);
    t.classList.add('is-in');
    function kill() { t.remove(); }
    toastTimer = setTimeout(kill, ms);
    if (opts.undo) t.querySelector('.toast-undo').addEventListener('click', function () { clearTimeout(toastTimer); opts.undo(); kill(); });
  };

  // ------------------------------------------------------------ sheets (modal cards)
  App.sheet = function (html, opts) {
    opts = opts || {};
    var layer = $('#sheetLayer');
    layer.innerHTML = '<div class="sheet-scrim"></div><div class="sheet ' + (opts.cls || '') + '">' +
      '<button class="sheet-x" data-close aria-label="Close">' + App.icon('x', 28) + '</button>' + html + '</div>';
    layer.classList.add('is-open');
    function close() {
      if (!layer.classList.contains('is-open')) return;
      layer.classList.remove('is-open');
      if (opts.onClose) opts.onClose();
      layer.innerHTML = '';
    }
    App.closeSheet = close;
    layer.querySelector('.sheet-scrim').addEventListener('click', close);
    App.$$('[data-close]', layer).forEach(function (b) { b.addEventListener('click', close); });
    if (opts.onMount) opts.onMount(layer.querySelector('.sheet'), close);
    return close;
  };
  App.closeSheet = function () {};

  // Stage-local coordinates for an element's center (stage may be scaled on desktop)
  App.centerOf = function (el) {
    var stage = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect(), k = stage.width / 1280;
    return { x: (r.left + r.width / 2 - stage.left) / k, y: (r.top + r.height / 2 - stage.top) / k };
  };

  // ------------------------------------------------------------ press-and-hold
  App.hold = function (el, ms, cb) {
    var t = null;
    el.style.setProperty('--hold', ms + 'ms');
    el.addEventListener('pointerdown', function () {
      if (cb.enabled && !cb.enabled()) return;
      el.classList.add('is-holding');
      t = setTimeout(function () { t = null; el.classList.remove('is-holding'); cb.done(); }, ms);
    });
    function cancel(e) {
      if (!t) return;
      clearTimeout(t); t = null;
      el.classList.remove('is-holding');
      if (cb.cancel && e.type === 'pointerup') cb.cancel();
    }
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
  };

  // ------------------------------------------------------------ modes: day / ambient / night
  App.setMode = function (m) {
    var stage = $('#stage');
    App.mode = m;
    stage.dataset.mode = m;
    App.emit('mode', m);
  };

  // ------------------------------------------------------------ idle
  App.idle = { home: 60, ambient: 120 };
  var idleSec = 0;
  function onIdleTick() {
    idleSec++;
    var blocked = $('#takeover').classList.contains('is-open');
    if (App.mode === 'nightdash' && idleSec >= 20) { App.setMode('night'); return; }
    // Idle screens follow the clock: photos by day, the dim night clock from 10 PM to 6 AM.
    if (App.mode === 'night' && !App.isNight()) { App.setMode('ambient'); return; }
    if (App.mode === 'ambient' && App.isNight()) { App.setMode('night'); return; }
    if (App.mode !== 'day' || blocked) return;
    if (idleSec === App.idle.home && App.current !== 'home') { App.closeSheet(); App.go('home'); }
    if (idleSec >= App.idle.ambient) {
      App.closeSheet();
      App.go('home');
      App.setMode(App.isNight() ? 'night' : 'ambient');
    }
  }
  App.resetIdle = function () { idleSec = 0; };

  // ------------------------------------------------------------ stage scaling (desktop preview only)
  function fit() {
    var s = Math.min(window.innerWidth / 1280, window.innerHeight / 800);
    $('#stage').style.transform = Math.abs(s - 1) < 0.01 ? '' : 'scale(' + s + ')';
  }

  // ------------------------------------------------------------ clock tick
  var lastMin = -1;
  function tick() {
    var n = App.now();
    App.emit('second', n);
    if (n.getMinutes() !== lastMin) {
      lastMin = n.getMinutes();
      $('#railClock').innerHTML = '<b>' + App.fmt.time(n, false) + '</b><span>' + App.fmt.ampm(n) + '</span>';
      App.emit('minute', n);
    }
    onIdleTick();
  }

  // ------------------------------------------------------------ boot
  App.start = function () {
    fit();
    window.addEventListener('resize', fit);
    // Switch tabs the instant a finger lands (pointerdown), not on release. Keyboard "clicks"
    // (detail === 0) still work.
    $('#rail').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.button === 0) App.go(b.dataset.go);
    });
    $('#rail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.detail === 0) App.go(b.dataset.go);
    });
    document.addEventListener('pointerdown', App.resetIdle, true);
    window.addEventListener('hashchange', function () { App.go(location.hash.slice(1)); });
    App.go(location.hash.slice(1) || 'home');
    tick();
    setInterval(tick, 1000);
    App.emit('ready');
    refreshStale(1500);
  };
  document.addEventListener('DOMContentLoaded', function () { App.start(); });
})();
