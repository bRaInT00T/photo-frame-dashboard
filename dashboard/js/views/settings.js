// Settings: frame behaviour, saved on frame-hub so it survives reloads and reboots.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null };

  var CHOICES = {
    screensaverAfter: [[60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min'], [0, 'Never']],
    photoSeconds: [[10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']],
    showClock: [[true, 'On'], [false, 'Off']],
    showPhotoInfo: [[true, 'On'], [false, 'Off']],
    returnHomeAfter: [[30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [0, 'Never']],
    nightMode: [[true, 'On'], [false, 'Off']],
    nightStart: [[20, '8 PM'], [21, '9 PM'], [22, '10 PM'], [23, '11 PM']],
    nightEnd: [[5, '5 AM'], [6, '6 AM'], [7, '7 AM'], [8, '8 AM']],
    nightScreen: [['clock', 'Clock'], ['black', 'Black']]
  };

  function seg(key) {
    var cur = App.settings[key];
    return '<div class="seg">' + CHOICES[key].map(function (c) {
      return '<button class="' + (c[0] === cur ? 'is-on' : '') + '" data-set="' + key + '" data-val="' + JSON.stringify(c[0]).replace(/"/g, '&quot;') + '">' + c[1] + '</button>';
    }).join('') + '</div>';
  }
  function row(label, key, hint) {
    return '<div class="st-row"><div class="st-label">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div>' + seg(key) + '</div>';
  }

  function status() {
    var n = App.now(), photos = D.photos.filter(function (p) { return p.url; }).length;
    return '<div class="st-status">' +
      '<span><b class="num">' + (App.haLive ? 'Connected' : '—') + '</b>Home Assistant</span>' +
      '<span><b class="num">' + photos + '</b>photos in rotation</span>' +
      '<span><b class="num">' + D.events.length + '</b>calendar events</span>' +
      '<span><b class="num">' + App.fmt.time(n) + '</b>checked</span></div>';
  }

  function paint() {
    var night = App.settings.nightMode;
    V.el.innerHTML = '<div class="st">' +
      '<div class="st-head"><h1 class="serif">Settings</h1>' +
      '<div class="st-actions"><button class="btn btn--solid" data-act="screensaver">' + App.icon('photo', 22) + ' Start screensaver</button>' +
      '<button class="btn" data-act="reload">Reload dashboard</button>' +
      (window.HomeHQ ? '<button class="btn" data-act="android">Android settings</button>' : '') + '</div></div>' +
      '<div class="st-grid">' +
      '<section class="st-card"><div class="label">Screensaver</div>' +
      row('Start after', 'screensaverAfter', 'Without a touch') +
      row('Each photo', 'photoSeconds') +
      row('Time & weather', 'showClock') +
      row('Photo date & place', 'showPhotoInfo') +
      '</section>' +
      '<section class="st-card"><div class="label">Night</div>' +
      row('Night mode', 'nightMode', 'Dim clock instead of photos') +
      (night ? row('From', 'nightStart') + row('Until', 'nightEnd') + row('Night screen', 'nightScreen') : '') +
      '</section>' +
      '<section class="st-card"><div class="label">Dashboard</div>' +
      row('Back to Today after', 'returnHomeAfter', 'Without a touch') +
      '<p class="st-note">' + (window.HomeHQ ? 'From Android settings, tap <b>Dashboard</b> on the floating bar to come back (Accessibility → Home HQ navigation), or unplug and replug the frame.' : 'Android settings is available on the frame itself.') + '</p>' +
      '</section>' +
      '<section class="st-card"><div class="label">Status</div>' + status() + '</section>' +
      '</div></div>';
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-set]'))) {
      var key = t.dataset.set, val = JSON.parse(t.dataset.val);
      if (App.settings[key] === val) return;
      App.saveSetting(key, val, function (ok) { if (!ok) App.toast('Couldn’t save that setting', { tone: 'error', icon: 'bolt' }); paint(); });
      return paint();
    }
    if ((t = e.target.closest('[data-act]'))) {
      if (t.dataset.act === 'screensaver') App.setMode(App.isNight() ? 'night' : 'ambient');
      if (t.dataset.act === 'reload') location.reload();
      if (t.dataset.act === 'android' && window.HomeHQ) window.HomeHQ.openSettings(); // kiosk app only
    }
  }

  App.on('settings', function () { if (V.el && App.current === 'settings') paint(); });

  App.register('settings', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      paint();
    }
  });
})();
