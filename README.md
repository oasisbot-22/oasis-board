# Oasis Board

Shared Kanban board (plain HTML/CSS/JS + Node API) with Railway Postgres persistence.

## Features

- 3-column board: **To Do**, **Doing**, **Done**
- Tabs: **Board**, **Backlog**, **Historial**
- Cards with title, optional description, checklist items
- Desktop drag-and-drop + mobile touch drag-and-drop
- Auto-rule: if checklist is not empty and all items are checked, card auto-moves to **Done**
- **Backlog** = cards currently in **To Do**
- **Historial** = done cards older than 2 days
- Single source of truth via API + Postgres (no per-device divergence)
- PWA assets kept (manifest + service worker)

## API routes

- `GET /api/health` — health check
- `GET /api/cards` — list cards
- `POST /api/cards` — create card
- `PATCH /api/cards/:id` — update title/description/checklist/column
- `PATCH /api/cards/:id/column` — move between `backlog|todo|doing|done|history`
- `PATCH /api/cards/:id/checklist` — replace checklist and apply auto-done rule
- `DELETE /api/cards/:id` — delete card

## Seeded initial tasks

On first DB init (empty DB), these cards are inserted in **To Do**:

1. Fix mobile UX touch drag + vertical columns
2. Deploy live verified
3. Validate Backlog+Historial in prod
4. Share final link

## Railway deploy

This app expects `DATABASE_URL` to be set (Railway Postgres service/plugin).

Start command:

```bash
npm start
```
