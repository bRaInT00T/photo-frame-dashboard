// frame-hub: serves the dashboard and its live data on the LAN.
//   GET /api/state         people, units, calendar events, weather, photo list
//   GET /api/photo/:id     Immich preview/thumbnail, proxied so the API key stays here
//   GET /healthz
// Everything else is the built dashboard (DIST, default ../dashboard/dist).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import IcalExpander from 'ical-expander';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(process.env.CONFIG || path.join(HERE, 'config.json'), 'utf8'));
const DIST = path.resolve(process.env.DIST || path.join(HERE, '../dashboard/dist'));
const PORT = +(process.env.PORT || 8430);
const TZ = CONFIG.timezone || 'America/New_York';
const BUILD = (() => { try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(DIST, 'index.html'))).digest('hex').slice(0, 12); } catch { return 'dev'; } })();

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Small time-based cache so the frame can poll every minute without hammering upstreams.
function cached(ms, fn) {
  let value, at = 0, inflight = null;
  return async () => {
    if (value !== undefined && Date.now() - at < ms) return value;
    if (inflight) return inflight;
    inflight = fn().then((v) => { value = v; at = Date.now(); return v; })
      .catch((e) => { log('refresh failed:', e.message); if (value !== undefined) return value; throw e; })
      .finally(() => { inflight = null; });
    return inflight;
  };
}

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

// ------------------------------------------------------------------ weather (Open-Meteo)
// WMO weather codes → the dashboard's icon names.
function cond(code, isDay) {
  if (code <= 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return isDay ? 'partly' : 'moon';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if (code === 3) return 'cloud';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain'; // drizzle, rain, showers, thunderstorms
}

const weather = cached(15 * 60e3, async () => {
  const { latitude, longitude } = CONFIG.location;
  const f = CONFIG.units === 'F';
  const q = new URLSearchParams({
    latitude, longitude, timezone: TZ, forecast_days: '7',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,is_day,wind_gusts_10m,uv_index',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code,is_day',
    temperature_unit: f ? 'fahrenheit' : 'celsius',
    wind_speed_unit: f ? 'mph' : 'kmh',
  });
  const w = await getJSON('https://api.open-meteo.com/v1/forecast?' + q);
  const H = w.hourly;
  // 48 hourly values starting at local midnight today; index = hour of day (24+ = tomorrow).
  return {
    hi: Math.round(w.daily.temperature_2m_max[0]),
    lo: Math.round(w.daily.temperature_2m_min[0]),
    feels: Math.round(w.current.apparent_temperature),
    humidity: Math.round(w.current.relative_humidity_2m),
    wind: Math.round(w.current.wind_speed_10m),
    t: H.temperature_2m.map(Math.round),
    c: H.weather_code.map((code, i) => cond(code, H.is_day[i])),
    p: H.precipitation_probability.map((v) => v ?? 0),
    // Detail for the description: raw WMO codes, precipitation amount, feels-like, gusts, UV.
    wc: H.weather_code,
    mm: H.precipitation.map((v) => v ?? 0),
    f: H.apparent_temperature.map(Math.round),
    g: H.wind_gusts_10m.map(Math.round),
    uv: H.uv_index.map((v) => v ?? 0),
    day: H.is_day,
    now: {
      t: Math.round(w.current.temperature_2m), feels: Math.round(w.current.apparent_temperature),
      code: w.current.weather_code, day: !!w.current.is_day, gust: Math.round(w.current.wind_gusts_10m),
    },
    // 7-day forecast, today first.
    days: w.daily.time.map((date, i) => ({
      date, icon: cond(w.daily.weather_code[i], 1), hi: Math.round(w.daily.temperature_2m_max[i]),
      lo: Math.round(w.daily.temperature_2m_min[i]), p: w.daily.precipitation_probability_max[i] ?? 0,
    })),
    place: CONFIG.location.name,
  };
});

// ------------------------------------------------------------------ calendar (Google iCal)
function peopleFor(cal, title) {
  if (Array.isArray(cal.people)) return cal.people;
  const hit = CONFIG.people.filter((p) =>
    [p.name, ...(p.aliases || [])].some((n) => new RegExp('\\b' + escapeRe(n) + '\\b', 'i').test(title)));
  return hit.length ? hit.map((p) => p.id) : CONFIG.people.map((p) => p.id); // no name → whole family
}

// "Sam - Soccer", "Soccer - Alex", "Soccer - (Sam)", "Soccer (Mom)", "Sam soccer" → "Soccer". The name has
// already done its job (assigning the event); the person's colour and column show who it's for.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function stripNames(title) {
  const names = CONFIG.people.flatMap((p) => [p.name, ...(p.aliases || [])]).map(escapeRe).join('|');
  if (!names) return title;
  const one = `(?:${names})`, many = `${one}(?:\\s*(?:&|and|\\+|/|,)\\s*${one})*`;
  const out = title
    .replace(new RegExp(`^\\s*\\(?${many}\\)?\\s*[-–—:]\\s*`, 'i'), '')       // "Sam - …", "Mom: …"
    .replace(new RegExp(`\\s*[-–—]\\s*\\(?${many}\\)?\\s*$`, 'i'), '')         // "… - Alex", "… - (Sam)"
    .replace(new RegExp(`\\s*\\(${many}\\)\\s*$`, 'i'), '')                    // "… (Dad)"
    .replace(new RegExp(`^\\s*${many}\\s+(?=\\S)`, 'i'), '')                    // "Sam piano lesson"
    .trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : title;
}
const eventTitle = (cal, raw) => { const t = stripNames(raw); return cal.label ? cal.label + ': ' + t : t; }; // e.g. "Flag Football: Chiefs @ Cardinals"

function toEvent(cal, uid, start, end, item) {
  const raw = item.summary || '(busy)';
  const e = { id: uid + '@' + start.toString(), title: eventTitle(cal, raw), people: peopleFor(cal, raw) };
  if (start.isDate) {
    e.allDay = true;
    e.startDate = start.toString(); // YYYY-MM-DD, built as local midnight on the frame
    e.endDate = (end || start).toString();
  } else {
    e.start = start.toJSDate().toISOString();
    e.end = (end || start).toJSDate().toISOString();
  }
  if (item.location) e.loc = item.location;
  if (item.description) e.notes = item.description.slice(0, 280);
  return e;
}

// A calendar that Home Assistant already reads (e.g. a Google calendar shared with you, where you
// can't get the secret iCal address): { "ha": "calendar.x", "people": [...] | "match" }.
async function haCalendarEvents(cal, from, to) {
  const ha = CONFIG.homeAssistant;
  if (!ha || !process.env.HA_TOKEN) return [];
  const r = await fetch(`${ha.url}/api/calendars/${cal.ha}?start=${from.toISOString()}&end=${to.toISOString()}`,
    { headers: { authorization: 'Bearer ' + process.env.HA_TOKEN }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`calendar ${cal.ha}: ${r.status}`);
  return (await r.json()).map((ev) => {
    const raw = ev.summary || '(busy)';
    const e = { id: (ev.uid || raw) + '@' + (ev.start.dateTime || ev.start.date), title: eventTitle(cal, raw), people: peopleFor(cal, raw) };
    if (ev.start.date) { e.allDay = true; e.startDate = ev.start.date; e.endDate = ev.end.date || ev.start.date; }
    else { e.start = new Date(ev.start.dateTime).toISOString(); e.end = new Date(ev.end.dateTime || ev.start.dateTime).toISOString(); }
    if (ev.location) e.loc = ev.location;
    if (ev.description) e.notes = ev.description.slice(0, 280);
    return e;
  });
}

// The same event on two calendars (e.g. an invite on the family calendar and a personal one)
// becomes one event for everyone involved.
function mergeEvents(list) {
  const byKey = new Map();
  for (const e of list) {
    const key = e.title.trim().toLowerCase() + '|' + (e.start || e.startDate) + '|' + (e.end || e.endDate);
    const seen = byKey.get(key);
    if (seen) seen.people = [...new Set([...seen.people, ...e.people])];
    else byKey.set(key, e);
  }
  return [...byKey.values()];
}

const calendar = cached(5 * 60e3, async () => {
  const from = new Date(Date.now() - (CONFIG.calendarDaysBack ?? 1) * 864e5);
  const to = new Date(Date.now() + (CONFIG.calendarDaysAhead ?? 14) * 864e5);
  const out = [];
  for (const cal of CONFIG.calendars) {
    if (cal.ha) {
      out.push(...await haCalendarEvents(cal, from, to).catch((e) => { log(e.message); return []; }));
      continue;
    }
    // "url" for public feeds (league/school schedules); "env" names a secret address kept in .env.
    const url = (cal.url || process.env[cal.env] || '').replace(/^webcal:\/\//i, 'https://');
    if (!url) continue;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`calendar ${cal.env || cal.url}: ${res.status}`);
    const ics = await res.text();
    const { events, occurrences } = new IcalExpander({ ics, maxIterations: 2000 }).between(from, to);
    for (const ev of events) out.push(toEvent(cal, ev.uid, ev.startDate, ev.endDate, ev));
    for (const o of occurrences) out.push(toEvent(cal, o.item.uid, o.startDate, o.endDate, o.item));
  }
  return mergeEvents(out);
});

// ------------------------------------------------------------------ photos (Immich)
// source "library": a fresh random sample of the whole library every refresh, with today's
// "On this day" memories first. source "album": every photo in one album.
const IMMICH = (process.env.IMMICH_URL || '').replace(/\/$/, '');
const immichHeaders = () => ({ 'x-api-key': process.env.IMMICH_API_KEY, accept: 'application/json' });
const immich = (p, body) => getJSON(IMMICH + '/api' + p, body === undefined ? { headers: immichHeaders() } : {
  method: 'POST', headers: { ...immichHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function toPhoto(a) {
  const x = a.exifInfo || {};
  let w = x.exifImageWidth || a.width, h = x.exifImageHeight || a.height;
  if (['5', '6', '7', '8', 5, 6, 7, 8].includes(x.orientation)) [w, h] = [h, w];
  const date = String(a.localDateTime || x.dateTimeOriginal || a.fileCreatedAt || '').slice(0, 10);
  const photo = {
    id: a.id,
    o: w && h && h > w ? 'p' : 'l',
    ar: w && h ? +(w / h).toFixed(3) : null,
    date,
    tag: date, // photos from the same day pair up in the slideshow
    place: [x.city, x.state].filter(Boolean).join(', ') || '',
    fav: !!a.isFavorite,
  };
  const f = faceCache.get(a.id);
  if (f) { photo.fx = f.fx; photo.fy = f.fy; }
  return photo;
}

// Face boxes (needs the face.read permission). The centre of the named people's faces becomes the
// crop focus when a portrait photo is zoomed to fill the landscape screen. Cached per photo.
const faceCache = new Map();
let facesAllowed = true;
async function loadFaces(id) {
  if (!facesAllowed || faceCache.has(id)) return;
  const res = await fetch(`${IMMICH}/api/faces?id=${id}`, { headers: immichHeaders(), signal: AbortSignal.timeout(10000) });
  if (res.status === 401 || res.status === 403) {
    if (facesAllowed) log('photos: no face.read permission; portraits crop to the upper middle');
    facesAllowed = false;
    return;
  }
  if (!res.ok) return;
  const faces = await res.json();
  const use = faces.filter((x) => x.person && x.person.name).length ? faces.filter((x) => x.person && x.person.name) : faces;
  if (!use.length) { faceCache.set(id, null); return; }
  const cx = use.reduce((t, x) => t + (x.boundingBoxX1 + x.boundingBoxX2) / 2 / x.imageWidth, 0) / use.length;
  const cy = use.reduce((t, x) => t + (x.boundingBoxY1 + x.boundingBoxY2) / 2 / x.imageHeight, 0) / use.length;
  faceCache.set(id, { fx: +cx.toFixed(3), fy: +cy.toFixed(3) });
}
const hasKnownPerson = (a) => (a.people || []).some((x) => x.name && !x.isHidden);

// "people": ["Alex Smith", ...] keeps only photos with at least one of those Immich people.
// Their person ids are learned from photos as they turn up, then each one is sampled directly.
const familyIds = new Map(); // lower-case name → Immich person id
const familyNames = () => new Set((CONFIG.immich.people || []).map((n) => n.trim().toLowerCase()));
function learnFamily(assets) {
  const want = familyNames();
  for (const a of assets) for (const x of a.people || []) if (x.name && want.has(x.name.toLowerCase())) familyIds.set(x.name.toLowerCase(), x.id);
}
const hasFamily = (a) => { const want = familyNames(); return (a.people || []).some((x) => x.name && want.has(x.name.toLowerCase())); };
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

async function albumAssets(name) {
  const album = (await immich('/albums')).find((a) => a.albumName === name);
  if (!album) throw new Error(`Immich album "${name}" not found`);
  return (await immich('/search/metadata', { albumIds: [album.id], withExif: true, withPeople: true, type: 'IMAGE', visibility: 'timeline', size: 1000 })).assets.items;
}

async function onThisDayAssets() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const out = [];
  for (const m of await immich(`/memories?for=${today}&type=on_this_day`)) out.push(...m.assets);
  // Memory assets may come without EXIF; fetch it so the camera filter can judge them.
  return Promise.all(out.slice(0, 40).map((a) => (a.exifInfo && a.people ? a : immich('/assets/' + a.id).catch(() => a))));
}

// Camera photos still include pictures of passports, cards and paperwork. Each day, ask Immich's
// smart (CLIP) search for document-like images and never show the top matches. Some real photos
// get excluded too; anything that slips through can be archived in Immich.
const DEFAULT_EXCLUDE = [
  'passport', "driver's license or ID card", 'credit card or bank card', 'receipt',
  'document or paper with printed text', 'handwritten note or form', 'screenshot of a phone or computer screen',
  'medical prescription or pill bottle label', 'whiteboard', 'barcode or QR code',
];
const excludedPhotos = cached(24 * 3600e3, async () => {
  const im = CONFIG.immich, ids = new Set();
  for (const query of im.excludeQueries || DEFAULT_EXCLUDE) {
    const r = await immich('/search/smart', { query, type: 'IMAGE', size: im.excludePerQuery || 60 });
    r.assets.items.forEach((a) => ids.add(a.id));
  }
  log(`photos: ${ids.size} document-like photos excluded`);
  return ids;
});

const knownPhotos = new Set(); // ids the frame may still ask for, across refreshes

const photos = cached(30 * 60e3, async () => {
  if (!IMMICH || !process.env.IMMICH_API_KEY) return null;
  const im = CONFIG.immich;
  let assets = [];
  if (im.source === 'album') {
    assets = await albumAssets(im.album);
  } else {
    if (im.onThisDay !== false) assets.push(...await onThisDayAssets().catch((e) => { log('memories:', e.message); return []; }));
    const sample = [];
    const query = { type: 'IMAGE', visibility: 'timeline', withExif: true, withPeople: true };
    const wanted = familyNames();
    if (wanted.size) {
      learnFamily(assets);
      // Find each family member's Immich id in general samples, then sample each of them directly.
      for (let round = 0; round < 3 && familyIds.size < wanted.size; round++) {
        const r = await immich('/search/random', { ...query, size: 1000 });
        learnFamily(r);
        sample.push(...r);
      }
      const per = Math.ceil((im.maxPhotos * 2) / Math.max(1, familyIds.size));
      for (const id of familyIds.values()) sample.push(...await immich('/search/random', { ...query, size: Math.min(1000, per), personIds: [id] }));
      const missing = [...wanted].filter((n) => !familyIds.has(n));
      if (missing.length) log(`photos: no Immich person named ${missing.map((n) => `"${n}"`).join(', ')} found yet`);
    } else {
      // Filters can reject most of a sample, so draw up to four samples until enough remain.
      for (let round = 0; round < 4; round++) {
        sample.push(...await immich('/search/random', { ...query, size: 1000 }));
        if (sample.filter((a) => (!im.cameraOnly || (a.exifInfo && a.exifInfo.make)) && (!im.knownPeopleOnly || hasKnownPerson(a))).length >= im.maxPhotos * 1.3) break;
      }
    }
    assets.push(...shuffle(sample)); // memories stay first; the rest mixed so no one person dominates
  }
  // Fail closed: without the exclusion list, show no library photos (the frame falls back to demo ones).
  const excluded = im.excludeDocuments === false ? new Set() : await excludedPhotos();
  const seen = new Set();
  const picked = assets.filter((a) => {
    if (excluded.has(a.id)) return false;
    if (seen.has(a.id) || a.type !== 'IMAGE' || a.isTrashed || a.isArchived || (a.visibility && a.visibility !== 'timeline')) return false;
    if (im.cameraOnly && !(a.exifInfo && a.exifInfo.make)) return false; // drops most screenshots and saved images
    if (im.knownPeopleOnly && !hasKnownPerson(a)) return false; // someone named in Immich is in it
    if ((im.people || []).length && !hasFamily(a)) return false; // one of the listed people is in it
    seen.add(a.id);
    return true;
  }).slice(0, im.maxPhotos);
  for (let i = 0; i < picked.length; i += 8) await Promise.all(picked.slice(i, i + 8).map((a) => loadFaces(a.id).catch(() => {})));
  const list = picked.map(toPhoto);
  if (knownPhotos.size > 5000) knownPhotos.clear();
  list.forEach((p) => knownPhotos.add(p.id));
  log(`photos: ${list.length} from ${im.source === 'album' ? 'album ' + im.album : 'library'} (${assets.length} candidates, ${list.filter((x) => x.fx != null).length} with face focus)`);
  return list;
});

async function proxyPhoto(id, size, res) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !IMMICH) return send(res, 404, 'not found');
  await photos().catch(() => null);
  if (!knownPhotos.has(id)) return send(res, 404, 'not found'); // only photos the hub handed out
  const up = await fetch(`${IMMICH}/api/assets/${id}/thumbnail?size=${size === 'thumbnail' ? 'thumbnail' : 'preview'}`,
    { headers: { 'x-api-key': process.env.IMMICH_API_KEY }, signal: AbortSignal.timeout(20000) });
  if (!up.ok) return send(res, 502, 'immich ' + up.status);
  res.writeHead(200, { 'content-type': up.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=86400' });
  res.end(Buffer.from(await up.arrayBuffer()));
}

// ------------------------------------------------------------------ Home Assistant
// Only entities listed in config.json "homeAssistant" are read or controlled, and only with the
// actions in ALLOWED. The token never leaves the hub.
const HA = CONFIG.homeAssistant;
const haHeaders = () => ({ authorization: 'Bearer ' + process.env.HA_TOKEN, 'content-type': 'application/json' });
const ALLOWED = {
  light: ['turn_on', 'turn_off'],
  switch: ['turn_on', 'turn_off'],
  scene: ['turn_on'],
  vacuum: ['start', 'pause', 'return_to_base', 'locate'],
  climate: ['set_temperature', 'set_hvac_mode'],
  todo: ['add_item', 'update_item'],
};
const haDevices = () => (HA ? HA.rooms.flatMap((r) => r.devices.map((d) => ({ ...d, room: r.id }))) : []);
function haEntities() {
  if (!HA) return new Set();
  const v = HA.vacuum || {};
  return new Set([...haDevices().map((d) => d.entity), ...(HA.scenes || []), v.entity, v.battery, v.binFull,
    HA.climate, HA.todo, ...(HA.cameras || []).map((c) => c.entity), ...Object.values(HA.presence || {})].filter(Boolean));
}

const SCENE_ICONS = [[/night|sleep|bed/i, 'moon'], [/away|idle|leave/i, 'away'], [/home|morning|arrive/i, 'sunrise'], [/movie|tv/i, 'film'], [/dinner|eat/i, 'utensils']];
const sceneIcon = (name) => (SCENE_ICONS.find(([re]) => re.test(name)) || [0, 'bolt'])[1];
const VAC_LABEL = { cleaning: 'Cleaning', docked: 'Docked', idle: 'Idle', paused: 'Paused', returning: 'Returning to dock', error: 'Needs help', unavailable: 'Offline' };

async function haFetchStates() {
  const ids = [...haEntities()];
  const got = await Promise.all(ids.map((id) => fetch(`${HA.url}/api/states/${id}`, { headers: haHeaders(), signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  return Object.fromEntries(ids.map((id, i) => [id, got[i]]));
}

let todoCache = null, todoAt = 0;
async function todoItems(fresh) {
  if (!fresh && todoCache && Date.now() - todoAt < 30e3) return todoCache;
  const r = await fetch(`${HA.url}/api/services/todo/get_items?return_response`, { method: 'POST', headers: haHeaders(), body: JSON.stringify({ entity_id: HA.todo }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('get_items ' + r.status);
  const items = ((await r.json()).service_response[HA.todo] || {}).items || [];
  todoCache = items.map((i) => ({ uid: i.uid, title: i.summary, done: i.status === 'completed', due: i.due || null }));
  todoAt = Date.now();
  return todoCache;
}

let haCache = null, haAt = 0;
async function haState(fresh) {
  if (!HA || !process.env.HA_TOKEN) return null;
  if (!fresh && haCache && Date.now() - haAt < 2000) return haCache;
  const st = await haFetchStates();
  const name = (e, fallback) => fallback || (st[e] && st[e].attributes.friendly_name) || e;
  const devices = haDevices().map((d) => {
    const s = st[d.entity], domain = d.entity.split('.')[0];
    const dimmable = domain === 'light' && !!s && (s.attributes.supported_color_modes || []).some((m) => m !== 'onoff');
    const b = s && s.attributes.brightness;
    return {
      id: d.entity, room: d.room, type: 'light', name: name(d.entity, d.name), ha: true, dimmable,
      on: !!s && s.state === 'on', level: dimmable && b ? Math.max(1, Math.round(b / 2.55)) : 100,
      available: !!s && s.state !== 'unavailable',
    };
  });
  const v = HA.vacuum, vs = v && st[v.entity];
  const c = st[HA.climate];
  const presence = {};
  for (const [pid, ent] of Object.entries(HA.presence || {})) {
    const s = st[ent];
    if (!s || s.state === 'unknown' || s.state === 'unavailable') continue;
    presence[pid] = { home: s.state === 'home', status: s.state === 'home' ? 'Home' : s.state === 'not_home' ? 'Away' : s.state };
  }
  haCache = {
    rooms: HA.rooms.map(({ id, name }) => ({ id, name })),
    devices,
    scenes: (HA.scenes || []).filter((e) => st[e]).map((e) => ({ id: e, name: name(e), icon: sceneIcon(name(e)), ha: true })),
    vacuum: vs ? {
      id: v.entity, name: v.name || name(v.entity), state: vs.state, label: VAC_LABEL[vs.state] || vs.state,
      battery: st[v.battery] ? Math.round(+st[v.battery].state) : null,
      binFull: st[v.binFull] ? st[v.binFull].state === 'on' : !!vs.attributes.bin_full,
    } : null,
    climate: c ? {
      current: c.attributes.current_temperature, humidity: c.attributes.current_humidity ?? null, mode: c.state,
      set: c.attributes.temperature, low: c.attributes.target_temp_low, high: c.attributes.target_temp_high,
      action: c.attributes.hvac_action || null, readOnly: false, id: HA.climate,
      modes: c.attributes.hvac_modes || [], min: c.attributes.min_temp, max: c.attributes.max_temp,
      step: c.attributes.target_temp_step || 1,
    } : null,
    cameras: (HA.cameras || []).filter((x) => st[x.entity] && st[x.entity].state !== 'unavailable')
      .map((x) => ({ id: x.entity, name: x.name || name(x.entity), url: '/api/ha/camera/' + x.entity })),
    todo: HA.todo && st[HA.todo] ? { id: HA.todo, name: HA.todoName || name(HA.todo), items: await todoItems().catch((e) => { log('todo:', e.message); return null; }) } : null,
    presence,
  };
  haAt = Date.now();
  return haCache;
}

async function haCall(body) {
  const { entity, action } = body || {};
  if (!haEntities().has(entity)) return [403, 'entity not allowed'];
  const domain = String(entity).split('.')[0];
  if (!(ALLOWED[domain] || []).includes(action)) return [403, 'action not allowed'];
  const data = { entity_id: entity };
  if (domain === 'light' && action === 'turn_on' && Number.isFinite(body.level)) data.brightness_pct = Math.max(1, Math.min(100, Math.round(body.level)));
  if (domain === 'climate') {
    const c = (haCache && haCache.climate) || {};
    const lo = c.min ?? 50, hi = c.max ?? 90;
    const temp = (v) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 2) / 2 : NaN);
    if (action === 'set_hvac_mode') {
      if (!(c.modes || []).includes(body.mode)) return [400, 'bad mode'];
      data.hvac_mode = body.mode;
    } else if (body.low != null || body.high != null) {
      data.target_temp_low = temp(body.low); data.target_temp_high = temp(body.high);
      if (!(data.target_temp_high - data.target_temp_low >= 2)) return [400, 'bad range'];
    } else {
      data.temperature = temp(body.temperature);
      if (Number.isNaN(data.temperature)) return [400, 'bad temperature'];
    }
  }
  if (domain === 'todo') {
    if (action === 'add_item') {
      const item = String(body.item || '').trim().slice(0, 120);
      if (!item) return [400, 'empty item'];
      data.item = item;
    } else {
      if (!(todoCache || []).some((i) => i.uid === body.uid) || !['completed', 'needs_action'].includes(body.status)) return [400, 'bad item'];
      data.item = body.uid; data.status = body.status;
    }
  }
  const r = await fetch(`${HA.url}/api/services/${domain}/${action}`, { method: 'POST', headers: haHeaders(), body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  if (!r.ok) return [502, 'home assistant ' + r.status];
  log(`ha: ${domain}.${action} ${entity}${data.brightness_pct ? ' ' + data.brightness_pct + '%' : ''}`);
  if (domain === 'todo') await todoItems(true).catch(() => {});
  await new Promise((ok) => setTimeout(ok, 700)); // let the device report its new state
  return [200, JSON.stringify(await haState(true))];
}

async function haCamera(entity, res) {
  if (!HA || !(HA.cameras || []).some((c) => c.entity === entity)) return send(res, 404, 'not found');
  const up = await fetch(`${HA.url}/api/camera_proxy/${entity}`, { headers: haHeaders(), signal: AbortSignal.timeout(15000) });
  if (!up.ok) return send(res, 502, 'camera ' + up.status);
  res.writeHead(200, { 'content-type': up.headers.get('content-type') || 'image/jpeg', 'cache-control': 'no-store' });
  res.end(Buffer.from(await up.arrayBuffer()));
}

function readJSON(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > limit) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
  });
}

// ------------------------------------------------------------------ frame settings
// Changed from the dashboard's Settings tab; kept in DATA_DIR/settings.json so they survive
// restarts. Only these keys and values are accepted.
const DATA_DIR = process.env.DATA_DIR || path.join(HERE, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SETTINGS_RULES = {
  screensaverAfter: [60, 120, 300, 600, 900, 0],   // seconds idle before the screensaver; 0 = never
  photoSeconds: [10, 20, 30, 60, 120],
  showClock: [true, false],                        // time, date and weather on the screensaver
  showPhotoInfo: [true, false],                    // photo month/year and place
  returnHomeAfter: [30, 60, 120, 300, 0],          // seconds idle before going back to Today; 0 = never
  nightMode: [true, false],
  nightStart: [20, 21, 22, 23],
  nightEnd: [5, 6, 7, 8],
  nightScreen: ['clock', 'black'],
};
const SETTINGS_DEFAULTS = {
  screensaverAfter: 120, photoSeconds: 30, showClock: true, showPhotoInfo: true,
  returnHomeAfter: 60, nightMode: true, nightStart: 22, nightEnd: 6, nightScreen: 'clock',
};
let settings = { ...SETTINGS_DEFAULTS };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch {}

function updateSettings(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SETTINGS_RULES[k] || !SETTINGS_RULES[k].includes(v)) return [400, `bad setting ${k}`];
  }
  settings = { ...settings, ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE + '.tmp', JSON.stringify(settings, null, 2));
  fs.renameSync(SETTINGS_FILE + '.tmp', SETTINGS_FILE);
  log('settings:', JSON.stringify(patch));
  return [200, JSON.stringify(settings)];
}

// ------------------------------------------------------------------ http
function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const settle = (p) => p.then((v) => v, (e) => { log(e.message); return null; });

async function state() {
  const [events, w, ph] = await Promise.all([settle(calendar()), settle(weather()), settle(photos())]);
  return {
    updated: new Date().toISOString(),
    build: BUILD,
    settings,
    timezone: TZ,
    units: CONFIG.units,
    people: CONFIG.people.map(({ id, name, color, ink }) => ({ id, name, color, ink })),
    events, weather: w, photos: ph,
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function serveStatic(urlPath, res) {
  let file = path.join(DIST, path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const immutable = file.includes(path.sep + 'assets' + path.sep);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (url.pathname === '/api/state') return send(res, 200, JSON.stringify(await state()), 'application/json');
    if (url.pathname === '/api/ha' && req.method === 'GET') return send(res, 200, JSON.stringify(await haState().catch((e) => { log('ha:', e.message); return null; })), 'application/json');
    const cam = url.pathname.match(/^\/api\/ha\/camera\/([a-z0-9_.]+)$/);
    if (cam) return await haCamera(cam[1], res);
    if (url.pathname === '/api/settings' && req.method === 'POST') { const [code, body] = updateSettings(await readJSON(req)); return send(res, code, body, code === 200 ? 'application/json' : 'text/plain; charset=utf-8'); }
    if (url.pathname === '/api/ha/call' && req.method === 'POST') { const [code, body] = await haCall(await readJSON(req)); return send(res, code, body, code === 200 ? 'application/json' : 'text/plain; charset=utf-8'); }
    const m = url.pathname.match(/^\/api\/photo\/([^/]+)$/);
    if (m) return await proxyPhoto(m[1], url.searchParams.get('size'), res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    serveStatic(url.pathname, res);
  } catch (e) {
    log('error', url.pathname, e.message);
    if (!res.headersSent) send(res, 500, 'error');
  }
}).listen(PORT, () => log(`frame-hub on :${PORT}, dashboard from ${DIST}`));
