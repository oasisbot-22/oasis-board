# Oasis Board

Mobile-first Kanban board (plain HTML/CSS/JS, no build step) with:

- Default 3-column board: **To Do**, **Doing**, **Done**
- Top view tabs: **Board**, **Backlog**, **Historial**
- Cards with title, optional description, checklist items
- Create cards in **To Do**
- Edit cards
- Add/remove checklist items
- Check/uncheck checklist items
- Desktop drag-and-drop between columns
- Mobile touch drag-and-drop with finger between columns (pointer events)
- Auto-rule: when checklist is not empty and all items are checked, card moves to **Done**
- Done cards older than 2 days move out of the main board and appear in **Historial**
- **Backlog** view shows all current **To Do** cards in one place
- Persistence with `localStorage`
- PWA support: manifest, service worker cache, installable app metadata/icons

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open:

- http://localhost:8000

## Test on phone (same Wi-Fi)

1. Find your computer local IP (example `192.168.1.20`)
2. Start server: `python3 -m http.server 8000`
3. On phone open `http://192.168.1.20:8000`
4. For install prompt/A2HS, use browser menu → **Add to Home Screen**

## Files

- `index.html` – app structure + PWA tags
- `styles.css` – mobile-first responsive UI styles
- `app.js` – app logic + persistence + service worker registration
- `manifest.webmanifest` – install metadata and icons
- `service-worker.js` – offline cache behavior
- `icons/icon-192.png` and `icons/icon-512.png` – placeholder app icons
