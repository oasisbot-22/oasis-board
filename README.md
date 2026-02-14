# Oasis Board

Minimal Kanban board (plain HTML/CSS/JS, no build step) with:

- 3 columns: **To Do**, **Doing**, **Done**
- Cards with title, optional description, checklist items
- Create cards in **To Do**
- Edit cards
- Add/remove checklist items
- Check/uncheck checklist items
- Drag and drop cards between columns
- Auto-rule: when checklist is not empty and all items are checked, card moves to **Done**
- Persistence with `localStorage`

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open:

- http://localhost:8000

## Files

- `index.html` – app structure
- `styles.css` – responsive UI styles
- `app.js` – app logic + persistence
