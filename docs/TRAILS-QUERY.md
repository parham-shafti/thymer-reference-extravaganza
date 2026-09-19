# Trails query API (`window.__refx.trails`)

Structured thinking trail: hover, click, and jump entries with optional `parent` and `dwellMs`.

## Entry shape

`{ id, guid, label, ts, how, kind, parent, dwellMs }` where `kind` is `hover` | `click` | `jump`.

## Calls

- **`recent(n = 20)`** — last *n* ring entries (newest last).
- **`query({ guid, kind, since, until, parent, limit = 100 })`** — filter the ring; returns up to `limit` matches.
- **`before(guid, { kind = 'click', windowMs = 300000 })`** — hover entries before the last click/jump on `guid` within the window, in order.
- **`days()`** — sorted local-day keys (`YYYY-MM-DD`) present in the ring.

## Example: what did I hover before clicking X?

```js
const commit = window.__refx.trails.query({ guid: 'TARGET_GUID', kind: 'click' }).at(-1);
const hovers = window.__refx.trails.before('TARGET_GUID', { windowMs: 5 * 60 * 1000 });
// hovers → [{ kind: 'hover', guid, parent, dwellMs, ... }, ...]
```

Persisted to the **RefX Trails** record in Settings (one line per day, meta `refx_trails`). Workbench strip shows `○` hovers / `●` commits; toggle commits-only with the `○/●` control.
