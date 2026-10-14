// Ambient (idle photo frame) and Night (dim red clock) overlays.
(function () {
  'use strict';
  var D = window.DATA, $ = App.$;
  var amb = { show: null }, shiftTimer = null;

  // Corner caption: time, then date and weather on one line, in the bottom-left only.
  function ambientInfo() {
    var n = App.now(), w = App.weatherNow();
    return '<div class="amb-cap">' +
      '<div class="amb-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="amb-line"><span>' + App.fmt.dayShort(n) + ', ' + App.fmt.monthShort(n) + ' ' + n.getDate() + '</span>' +
      '<i class="amb-dot"></i>' + App.icon(w.cond, 40) + '<span class="num">' + w.temp + '°</span><em>' + w.summary + '</em></div>' +
      '</div>';
  }
  // Bottom-right: when and where the current photo was taken ("October 2021" / "Tofino, BC").
  function photoCaption(slide) {
    var el = $('#ambient .amb-photo'), p = slide && slide.photos[0];
    if (!el) return;
    if (!p || !p.date) { el.innerHTML = ''; return; }
    var m = App.photoMeta(p);
    el.innerHTML = '<div class="amb-photo-when">' + m.monthYear + '</div>' + (m.place ? '<div class="amb-photo-where">' + App.esc(m.place) + '</div>' : '');
  }
  function nightInfo() {
    var n = App.now(), tomorrow = App.addDays(n, n.getHours() < 6 ? 0 : 1);
    var first = App.timedOn(tomorrow)[0], w = App.weatherNow();
    return '<div class="nt-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="nt-line">' + App.icon(w.cond, 26) + ' ' + w.temp + '° · ' + (first ? 'First up ' + App.fmt.rel(first.start).toLowerCase() + ': <b>' + App.esc(first.title) + '</b> ' + App.fmt.time(first.start) + ' · ' + App.person(first.people[0]).name : 'Nothing early tomorrow') + '</div>' +
      (App.haLive ? '' : '<div class="nt-lock">' + App.icon('lock', 20) + ' House locked · alarm armed</div>'); // demo-only line
  }

  function paint() {
    if (App.mode === 'ambient') $('#ambient .amb-info').innerHTML = ambientInfo();
    if (App.mode === 'night') $('#night .nt-inner').innerHTML = nightInfo();
  }

  // Nudge static content a few px every minute so nothing sits still for hours (image retention)
  function pixelShift() {
    var x = Math.round(Math.random() * 8 - 4), y = Math.round(Math.random() * 8 - 4);
    App.$$('.amb-info, .amb-photo, .nt-inner').forEach(function (el) { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; });
  }

  App.on('ready', function () {
    $('#ambient').innerHTML = '<div class="amb-stage"></div><div class="amb-scrim"></div><div class="amb-scrim amb-scrim--right"></div><div class="amb-info"></div><div class="amb-photo"></div>';
    $('#night').innerHTML = '<div class="nt-inner"></div>';
    amb.show = new App.Slideshow($('#ambient .amb-stage'), { layout: 'cover', captions: false, interval: 30000, fillPortrait: true, boxAr: 1280 / 800, onChange: photoCaption });
    // Swipe right: previous photo. Swipe left: next photo. Tap: back to the dashboard.
    var sx = null, sy = 0, swiped = false;
    $('#ambient').addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; swiped = false; });
    $('#ambient').addEventListener('pointerup', function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped = true;
        if (dx > 0) amb.show.prev(); else amb.show.next();
      }
    });
    $('#ambient').addEventListener('pointercancel', function () { sx = null; });
    $('#ambient').addEventListener('click', function () {
      if (swiped) { swiped = false; return; }
      App.setMode('day'); App.go('home');
    });
    $('#night').addEventListener('click', function () { App.setMode('nightdash'); });
  });

  App.on('settings', function (st) {
    if (!amb.show) return;
    var ms = st.photoSeconds * 1000;
    if (amb.show.o.interval !== ms) { amb.show.o.interval = ms; if (amb.show.timer) amb.show.restart(); }
    $('#ambient').classList.toggle('no-clock', !st.showClock);
    $('#ambient').classList.toggle('no-photo-info', !st.showPhotoInfo);
    $('#night').classList.toggle('is-black', st.nightScreen === 'black');
  });

  App.on('mode', function (m) {
    clearInterval(shiftTimer);
    if (m === 'ambient') { amb.show.start(); paint(); shiftTimer = setInterval(pixelShift, 60000); }
    else amb.show.stop();
    if (m === 'night') { paint(); shiftTimer = setInterval(pixelShift, 60000); }
    App.resetIdle();
  });
  App.on('minute', paint);
})();
