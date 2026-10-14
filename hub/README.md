# frame-hub

A small LAN service that serves the dashboard with live data instead of the demo content.
The frame's kiosk opens `http://<server>:8430/`.

| Source | What it feeds |
| --- | --- |
| Google Calendar (secret iCal address) | Calendar and Today. An event belongs to a person when their name is in the title; otherwise it is a family event |
| Public calendar feeds | League or school schedules via `{ "url": "https://…ics" or "webcal://…", "people": ["id"], "label": "Flag Football" }` (the optional label prefixes each title) |
| Home Assistant calendars | Calendars shared with you (no secret address needed) via `{ "ha": "calendar.x", "people": ["id"] }` in `calendars`. The same event on two calendars shows once, for everyone involved |
| Open-Meteo (no key) | Weather, clock area and hourly strip, in your units and time zone |
| Immich | Photos: a random sample of the whole library (or one album), camera photos with named people only (or only the people listed in `immich.people`), "On this day" first, portraits cropped around faces. Document-like photos (IDs, receipts, screenshots) are excluded with Immich's smart search, and the hub fails closed if that search fails |
| Home Assistant | Lights and switches, scenes, thermostat, vacuum, one camera, a to-do list and presence. Only entities listed in `config.json` are read or controlled, with fixed actions per domain |

Without a hub (for example the hosted demo) the dashboard keeps its demo data. The dashboard reloads
itself when the hub serves a new build.

## Setup

```sh
cp hub/config.example.json hub/config.json   # family, location, calendars, Immich, Home Assistant
cp hub/.env.example hub/.env                 # secrets: iCal address, Immich key, Home Assistant token
docker compose -f hub/compose.yaml up -d --build
```

- `config.json` is mounted into the container: after editing it, `docker compose -f hub/compose.yaml restart`.
- `.env` is read when the container is created: after editing it, `docker compose -f hub/compose.yaml up -d --force-recreate`.
  A plain `restart` keeps the old values.
- Both files are git-ignored. Keep them private.

### Keys and permissions

- **Immich API key:** `asset.read`, `asset.view`, `memory.read`, `face.read` (add `album.read` for `"source": "album"`).
- **Home Assistant:** create a non-admin user for the frame and use its long-lived access token as `HA_TOKEN`.
  The hub never needs admin APIs.
- **Google Calendar:** Settings → the calendar → Integrate calendar → "Secret address in iCal format". Anyone with
  this address can read the calendar.

## Notes

- The hub has no login. Run it on your LAN only; do not expose it through a tunnel or port forward.
- Photos: about 1440 px previews from Immich keep the frame's 1 GB of RAM happy.
- WebView 106 on the frame lacks `oklch()`, `color-mix()`, CSS nesting and `:has()`; the dashboard avoids them.
