// Home / Today: the glanceable overview. Never scrolls.
(function () {
  'use strict';
  var D = window.DATA, V = {};

  function clock() {
    var n = App.now();
    return '<div class="h-time num">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="h-date"><b>' + App.fmt.day(n) + '</b> ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>';
  }

  function weather() {
    var w = App.weatherNow();
    var hours = App.hourly(7);
    var tmin = Math.min.apply(null, hours.map(function (h) { return h.t; }));
    var tmax = Math.max.apply(null, hours.map(function (h) { return h.t; }));
    return '<div class="h-wx-top">' +
      '<span class="h-wx-icon">' + App.icon(w.cond, 70) + '</span>' +
      '<span class="h-wx-temp num">' + w.temp + '°</span>' +
      '<span class="h-wx-meta"><b>' + w.label + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span></span>' +
      '</div>' +
      '<div class="h-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' +
      '<div class="h-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.t - tmin) / (tmax - tmin) * 8);
        return '<div class="h-hr' + (h.p >= 50 ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.c, 22) + '</span><b>' + h.t + '°</b></div>';
      }).join('') + '</div>';
  }

  function presence() {
    return D.people.map(function (p) {
      var sub = p.unknown ? '' : p.home ? 'Home' : (p.eta ? '<b>ETA ' + p.eta + ' min</b>' : p.status);
      return '<div class="h-who' + (p.home ? ' is-home' : '') + '" style="' + App.pstyle(p) + '">' +
        App.avatar(p, 36, p.home ? '' : 'avatar--away') +
        '<span><b>' + p.name + '</b><small>' + sub + '</small></span></div>';
    }).join('');
  }

  // "Riverside Park 100 Main St, Springfield, IL 62701, United States" →
  // ["Riverside Park", "100 Main St", "Springfield, IL  62701"]. No country.
  App.addressLines = function (loc) {
    loc = String(loc || '').trim();
    if (!loc) return [];
    if (/^https?:\/\//i.test(loc)) return ['Online meeting'];
    var parts = loc.split(/\s*,\s*/).filter(Boolean);
    if (parts.length > 1 && /^(united states( of america)?|usa|us)$/i.test(parts[parts.length - 1])) parts.pop();
    var out = [];
    var last = parts[parts.length - 1] || '', sz = last.match(/^([A-Z]{2})[\s-]*(\d{5}(?:-\d{4})?)$/);
    var cityLine = null;
    if (sz && parts.length >= 2) {
      parts.pop();
      cityLine = parts.pop() + ', ' + sz[1] + '  ' + sz[2];
    }
    parts.forEach(function (p, i) {
      var m = i === 0 && p.match(/^(.*?[^\d\s])\s+(\d+[A-Za-z]?\s+.+)$/); // "Park Name 1200 Street"
      if (m) out.push(m[1], m[2]); else out.push(p);
    });
    if (cityLine) out.push(cityLine);
    return out;
  };

  // Shrink the Next Up title until it fits on one line; if it still doesn't, allow up to three lines.
  // Skipped while the view is hidden (no layout); re-run when the view is shown again.
  function fitHero() {
    var t = V.el && V.el.querySelector('.h-hero-title'), box = V.el && V.el.querySelector('.h-hero');
    if (!t || !t.clientWidth) return;
    var empty = box.classList.contains('h-hero--empty');
    function fits() {
      var wrapped = t.classList.contains('is-wrap');
      var main = box.querySelector('.h-hero-main') || box;
      return t.scrollWidth <= t.clientWidth + 1 && (!wrapped || t.scrollHeight <= t.clientHeight + 4) && box.scrollHeight <= box.clientHeight + 1 && main.scrollHeight <= main.clientHeight + 1;
    }
    t.classList.remove('is-wrap');
    var size = empty ? 56 : 72;
    t.style.fontSize = size + 'px';
    while (!fits() && size > (empty ? 34 : 44)) { size -= 2; t.style.fontSize = size + 'px'; }
    if (fits() || empty) return;
    t.classList.add('is-wrap');
    while (!fits() && size > 26) { size -= 2; t.style.fontSize = size + "px"; }
  }
  function hero() {
    var e = App.nextEvent(), now = App.now();
    if (!e) {
      var tomorrow = App.timedOn(App.addDays(now, 1))[0];
      return '<div class="h-hero h-hero--empty" data-go="calendar">' +
        '<div class="label label--light">Rest of today</div>' +
        '<div class="h-hero-title serif">Nothing else scheduled.<br><i>Enjoy the quiet.</i></div>' +
        (tomorrow ? '<div class="h-hero-meta">Tomorrow starts with <b>' + App.esc(tomorrow.title) + '</b> at ' + App.fmt.time(tomorrow.start) + '</div>' : '') +
        '</div>';
    }
    var p = App.evColor(e);
    var mins = (e.start - now) / 60000;
    var leave = (App.leaveBy(e) - now) / 60000;
    var who = e.people.map(function (id) { return App.person(id).name; });
    var whoText = App.isFamily(e) ? 'Everyone' : who.join(' + ');
    var big = mins < 100
      ? '<div class="h-hero-count num">' + Math.round(mins) + '<small>min</small></div>'
      : '<div class="h-hero-count num">' + App.fmt.time(e.start, false) + '<small>' + App.fmt.ampm(e.start) + '</small></div>';
    var leavePill = '';
    if (e.travel) {
      leavePill = leave <= 0
        ? '<span class="pill pill--alert"><i class="pulse"></i>Leave now</span>'
        : '<span class="pill' + (leave <= 15 ? ' pill--soon' : '') + '">' + App.icon('car', 20) + 'Leave in ' + App.fmt.mins(leave) + '</span>';
    }
    return '<button class="h-hero" style="' + App.pstyle(p) + '" data-ev="' + e.id + '">' +
      '<div class="h-hero-main">' +
      '  <div class="label label--on h-hero-who">Next up · ' + App.esc(whoText) + (e.people.length > 1 ? App.dots(e.people, 16) : '') + '</div>' +
      '  <div class="h-hero-title serif">' + App.esc(e.title) + '</div>' +
      '  <div class="h-hero-meta">' + App.fmt.range(e.start, e.end) + '</div>' +
      (e.loc ? '  <div class="h-hero-loc">' + App.addressLines(e.loc).map(App.esc).join('<br>') + '</div>' : '') +
      (leavePill ? '  <div class="h-hero-foot">' + leavePill + '</div>' : '') +
      '</div>' + big + '</button>';
  }

  function lanes() {
    var now = App.now();
    return D.people.map(function (p) {
      var list = App.timedOn(now, p.id).filter(function (e) { return e.end > now; });
      var shown = list.slice(0, 3), more = list.length - shown.length;
      return '<div class="h-lane" style="' + App.pstyle(p) + '">' +
        '<div class="h-lane-head">' + App.avatar(p, 30) + '<b>' + p.name + '</b></div>' +
        (list.length ? shown.map(function (e) {
          var cur = e.start <= now;
          return '<button class="h-ev' + (cur ? ' is-now' : '') + '" data-ev="' + e.id + '">' +
            '<span class="h-ev-t">' + (cur ? 'Now' : App.fmt.time(e.start, false)) + '</span>' +
            '<span class="h-ev-n">' + App.esc(e.title) + '</span></button>';
        }).join('') : '<div class="h-free serif"><i>Free</i> the rest of the day</div>') +
        (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '') +
        '</div>';
    }).join('');
  }

  function ring(done, total, size) {
    var r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }
  App.ring = ring;

  function chores() {
    var r = App.currentRoutine();
    var who = D.people.map(function (p) { return p.id; }).concat(['any']);
    return '<div class="label">Chores · ' + r.name + '</div><div class="h-rings">' + who.map(function (id) {
      var list = D.chores.filter(function (c) { return c.r === r.id && c.who === id; });
      if (!list.length) return '';
      var done = list.filter(function (c) { return c.done; }).length;
      var p = App.person(id);
      return '<div class="h-ring' + (done === list.length ? ' is-done' : '') + '" style="' + App.pstyle(p) + '">' + ring(done, list.length, 64) +
        '<b class="num">' + (done === list.length ? '✓' : done + '/' + list.length) + '</b><span>' + (id === 'any' ? 'Anyone' : p.name) + '</span></div>';
    }).join('') + '</div>';
  }

  function shopping() {
    if (D.todo && D.todo.items) {
      var todo = D.todo.items.filter(function (i) { return !i.done; });
      return '<div class="label">' + App.esc(D.todo.name) + '</div>' +
        '<div class="h-stat"><span class="num">' + todo.length + '</span><small>to do</small></div>' +
        '<ul class="h-recent">' + todo.slice(0, 3).map(function (i) { return '<li><i></i>' + App.esc(i.title) + '</li>'; }).join('') + '</ul>';
    }
    var open = D.groceries.filter(function (g) { return !g.done; });
    var recent = open.slice(-3).reverse();
    return '<div class="label">Shopping</div>' +
      '<div class="h-stat"><span class="num">' + open.length + '</span><small>items to get</small></div>' +
      '<ul class="h-recent">' + recent.map(function (g) {
        return '<li><i></i>' + App.esc(g.name) + '</li>';
      }).join('') + '</ul>';
  }

  function status() {
    var lights = D.devices.filter(function (d) { return d.type === 'light' && d.on; }).length;
    var unlocked = D.devices.filter(function (d) { return d.type === 'lock' && !d.locked; });
    var garage = D.devices.filter(function (d) { return d.type === 'garage'; })[0] || { state: 'closed' };
    var hasSecurity = D.devices.some(function (d) { return d.type === 'garage' || d.type === 'lock'; });
    var secure = !unlocked.length && garage.state === 'closed';
    var secText = secure ? 'All locked' : (garage.state !== 'closed' ? 'Garage open' : unlocked[0].name + ' unlocked');
    var v = D.vacuum;
    var second = !hasSecurity && v
      ? '<div class="h-st-row' + (v.state === 'error' || v.binFull ? ' is-warn' : '') + '">' + App.icon('home', 24) + '<span>' + App.esc(v.name) + ' · ' + (v.binFull ? 'bin full' : v.label.toLowerCase()) + '</span></div>'
      : '<div class="h-st-row' + (secure ? '' : ' is-warn') + '">' + App.icon(secure ? 'lock' : 'unlock', 24) + '<span>' + secText + '</span></div>';
    return '<div class="label">Home</div>' +
      '<div class="h-st-row">' + App.icon('bulb', 24) + '<b class="num">' + lights + '</b><span>lights on</span></div>' + second +
      '<div class="h-st-row">' + App.icon('thermo', 24) + '<b class="num">' + Math.round(D.climate.current) + '°</b><span>inside</span></div>';
  }

  function paint() {
    var el = V.el;
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.h-weather').innerHTML = weather();
    el.querySelector('.h-presence').innerHTML = presence();
    el.querySelector('.h-hero-slot').innerHTML = hero();
    fitHero();
    el.querySelector('.h-lanes').innerHTML = lanes();
    el.querySelector('.h-chores').innerHTML = chores();
    el.querySelector('.h-shop').innerHTML = shopping();
    el.querySelector('.h-shop').dataset.go = D.todo && D.todo.items ? 'todo' : 'shopping';
    el.querySelector('.h-status').innerHTML = status();
  }

  function photoCaption(s) {
    var m = App.photoMeta(s.photos[0]);
    V.el.querySelector('.h-photo-cap').innerHTML = '<b>' + (m.onThisDay ? 'On this day · ' : '') + m.kicker + '</b><span>' + App.esc(m.place) + '</span>';
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="home">' +
          '<div class="h-clock" data-go="calendar"></div>' +
          '<div class="h-weather"></div>' +
          '<div class="h-presence"></div>' +
          '<div class="h-main"><div class="h-hero-slot"></div><div class="h-lanes" ></div>' +
          '<button class="h-ss" data-screensaver>' + App.icon('photo', 22) + '<span>Screensaver</span></button></div>' +
          '<div class="h-side">' +
          '  <button class="h-photo" data-go="photos"><div class="h-photo-stage"></div><div class="h-photo-cap"></div></button>' +
          '  <button class="h-chores card" data-go="tasks"></button>' +
          '  <div class="h-duo"><button class="h-shop card" data-go="shopping"></button><button class="h-status card" data-go="control"></button></div>' +
          '</div></div>';
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-screensaver]')) { App.closeSheet(); App.setMode(App.isNight() ? 'night' : 'ambient'); return; } // tap the screen to come back
          var ev = e.target.closest('[data-ev]');
          if (ev) { App.eventSheet(App.findEvent(ev.dataset.ev)); return; }
          var g = e.target.closest('[data-go]');
          if (g) App.go(g.dataset.go);
        });
        var stage = el.querySelector('.h-photo-stage');
        V.slides = new App.Slideshow(stage, { layout: 'cover', captions: false, interval: 12000, onChange: photoCaption,
          fillPortrait: true, boxAr: stage.clientHeight ? stage.clientWidth / stage.clientHeight : 2 });
      }
      paint();
      V.slides.start();
    },
    resume: function () { V.slides.start(); fitHero(); },
    hide: function () { if (V.slides) V.slides.stop(); }
  });
  // Every minute: just the clock and next-up countdown (cheap, even while hidden). Weather on the hour.
  App.on('minute', function (n) {
    if (!V.el || !V.el.firstChild) return;
    V.el.querySelector('.h-clock').innerHTML = clock();
    V.el.querySelector('.h-hero-slot').innerHTML = hero();
    fitHero();
    if (n.getMinutes() === 0) { V.el.querySelector('.h-weather').innerHTML = weather(); V.el.querySelector('.h-lanes').innerHTML = lanes(); }
  });
  App.on('data', function () { if (App.current === 'home') paint(); });
})();
