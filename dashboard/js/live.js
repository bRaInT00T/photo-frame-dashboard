// Live data from frame-hub (hub/server.mjs): family, calendar, weather and photos replace the
// matching parts of window.DATA, and Home Assistant devices from /api/ha replace the demo home
// controls. Without a hub (e.g. the hosted demo) the demo data and the demo clock stay. Chores,
// shopping and agents are still demo data.
(function () {
  'use strict';
  var D = window.DATA;
  var REFRESH_MS = 60 * 1000;
  var HA_REFRESH_MS = 5 * 1000;
  var SLOTS = D.people.map(function (p) { return p.id; }); // demo ids that chores etc. point at
  var idMap = {};
  var live = null; // null = not tried yet, true = hub answered, false = demo
  var build = null; // the hub build this page was loaded from

  function replace(arr, items) { arr.length = 0; Array.prototype.push.apply(arr, items); }
  function localDay(s) { var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return (n >> 16 & 255) + ' ' + (n >> 8 & 255) + ' ' + (n & 255);
  }

  // Hub people take over the demo "slots" in order, so demo-only data (chores, stars) still resolves.
  function applyPeople(list) {
    D.people.length = Math.min(D.people.length, list.length);
    list.slice(0, SLOTS.length).forEach(function (p, i) {
      var slot = D.people[i];
      idMap[p.id] = SLOTS[i];
      slot.name = p.name;
      slot.color = p.color;
      slot.rgb = rgb(p.color);
      slot.ink = p.ink || '#FFFFFF';
      slot.home = true;
      slot.status = '';
      slot.unknown = true; // until Home Assistant presence says otherwise
      delete slot.eta;
    });
  }

  function applyEvents(list) {
    replace(D.busyExtras, []);
    replace(D.events, list.map(function (e) {
      var x = {
        id: e.id, title: e.title,
        people: e.people.map(function (id) { return idMap[id]; }).filter(Boolean)
      };
      if (e.loc) x.loc = e.loc;
      if (e.notes) x.notes = e.notes;
      if (e.allDay) { x.allDay = true; x.start = localDay(e.startDate); x.end = localDay(e.endDate); }
      else { x.start = new Date(e.start); x.end = new Date(e.end); }
      return x;
    }));
  }

  var photoSig = '';
  function applyPhotos(list) {
    if (!list || !list.length) return;
    var sig = list.map(function (p) { return p.id; }).join();
    if (sig === photoSig) return;
    photoSig = sig;
    replace(D.photos, list.map(function (p) {
      return { seed: p.id, url: '/api/photo/' + p.id, o: p.o, ar: p.ar, fx: p.fx, fy: p.fy, date: p.date, place: p.place, tag: p.tag, fav: p.fav, from: 'family' };
    }));
    App.resetSlideshows();
  }

  function apply(s) {
    applyPeople(s.people);
    D.units = s.units;
    if (s.events) applyEvents(s.events);
    if (s.weather) Object.keys(s.weather).forEach(function (k) { D.weather[k] = s.weather[k]; });
    applyPhotos(s.photos);
  }

  // ---------------------------------------------------------------- Home Assistant
  var haSig = '', touching = false;
  App.haLive = false;
  App.haBusy = 0;
  document.addEventListener('pointerdown', function () { touching = true; }, true);
  document.addEventListener('pointerup', function () { touching = false; }, true);
  document.addEventListener('pointercancel', function () { touching = false; }, true);

  // Update objects in place so tiles and sheets holding a reference stay current.
  function merge(arr, items) {
    var byId = {};
    arr.forEach(function (x) { byId[x.id] = x; });
    replace(arr, items.map(function (n) { return byId[n.id] ? Object.assign(byId[n.id], n) : n; }));
  }

  function applyHA(h, force) {
    if (!h) return;
    var sig = JSON.stringify(h);
    if (sig === haSig || (!force && (touching || App.haBusy))) return;
    haSig = sig;
    App.haLive = true;
    replace(D.rooms, h.rooms);
    merge(D.devices, h.devices);
    merge(D.scenes, h.scenes.map(function (x) { return Object.assign({ set: {} }, x); }));
    D.vacuum = h.vacuum;
    if (h.cameras) replace(D.cameras, h.cameras);
    D.todo = h.todo;
    if (h.climate) Object.keys(h.climate).forEach(function (k) { D.climate[k] = h.climate[k]; });
    Object.keys(h.presence || {}).forEach(function (pid) {
      var slot = App.person(idMap[pid]);
      if (!slot || slot.id === 'family') return;
      slot.home = h.presence[pid].home;
      slot.status = h.presence[pid].status;
      slot.unknown = false;
    });
    if (['control', 'home', 'todo'].indexOf(App.current) > -1) App.rerender();
    App.emit('data');
  }

  App.haCall = function (entity, action, extra, cb) {
    App.haBusy++;
    fetch('/api/ha/call', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ entity: entity, action: action }, extra || {}))
    })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (h) { App.haBusy--; if (cb) cb(true); applyHA(h, true); })
      .catch(function (err) { App.haBusy--; console.warn('ha call failed:', err.message); if (cb) cb(false); });
  };

  App.haRefresh = function () { haSig = ''; loadHA(); };

  function loadHA() {
    fetch('/api/ha', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) { applyHA(h); })
      .catch(function () {});
  }

  function load() {
    fetch('/api/state', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (s) {
        if (build && s.build && s.build !== build) return location.reload(); // new dashboard deployed
        build = build || s.build;
        apply(s);
        haSig = ''; // people were reset; re-apply presence on the next Home Assistant poll
        if (live !== true) { live = true; App.setTime(null); loadHA(); } // real clock; also re-renders
        else App.rerender();
      })
      .catch(function (err) {
        console.warn('frame-hub unavailable:', err.message);
        if (live === null) {
          live = false;
          App.setTime(15, 18); // demo default: a busy weekday afternoon
          App.toast('Tip: press and hold the <b>clock</b> in the sidebar for demo controls', { ms: 6000, icon: 'bolt' });
        }
      });
  }

  App.on('ready', function () {
    load();
    setInterval(function () { if (live !== false) load(); }, REFRESH_MS);
    setInterval(function () { if (live === true) loadHA(); }, HA_REFRESH_MS);
  });
})();
