const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const VERSION_PARTS = [
  process.env.APP_VERSION,
  process.env.RAILWAY_GIT_COMMIT_SHA,
  process.env.SOURCE_VERSION,
  String(Date.now()),
].filter(Boolean);
const APP_VERSION = VERSION_PARTS.join('-');
const INDEX_TEMPLATE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Add a PostgreSQL plugin/service in Railway and expose DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());

function renderIndexHtml() {
  return INDEX_TEMPLATE.replaceAll('__APP_VERSION__', APP_VERSION);
}

app.use(
  express.static(ROOT, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('service-worker.js') || filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return;
      }
      if (filePath.endsWith('.css') || filePath.endsWith('.js') || filePath.endsWith('.webmanifest')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

const ALLOWED_COLUMNS = new Set(['backlog', 'todo', 'doing', 'done', 'history']);
const ALLOWED_COMPANIES = new Set(['otc', 'vault', 'otros']);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeChecklist(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      id: item?.id || uid(),
      text: String(item?.text || '').trim(),
      checked: Boolean(item?.checked),
    }))
    .filter((i) => i.text.length > 0);
}

function normalizeCompany(company, fallback = 'otros') {
  const value = String(company || '').trim().toLowerCase();
  if (ALLOWED_COMPANIES.has(value)) return value;
  return ALLOWED_COMPANIES.has(fallback) ? fallback : 'otros';
}

function applyChecklistRule(column, checklist, doneAt) {
  let nextColumn = column;
  let nextDoneAt = doneAt || null;

  if (nextColumn === 'history') {
    return { column: 'history', doneAt: Number(nextDoneAt) || Date.now() };
  }

  if (checklist.length > 0 && checklist.every((i) => i.checked)) {
    nextColumn = 'done';
  }

  if (nextColumn === 'done') {
    nextDoneAt = Number(nextDoneAt) || Date.now();
  } else {
    nextDoneAt = null;
  }

  return { column: nextColumn, doneAt: nextDoneAt };
}

function toCard(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    company: normalizeCompany(row.company, 'otros'),
    column: row.card_column,
    doneAt: row.done_at ? Number(row.done_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function autoArchiveDoneCards() {
  const cutoff = Date.now() - TWO_DAYS_MS;
  await pool.query(
    `UPDATE cards
     SET card_column = 'history', updated_at = $2
     WHERE card_column = 'done' AND done_at IS NOT NULL AND done_at <= $1`,
    [cutoff, Date.now()],
  );
}

async function migrateTodoIntoBacklog() {
  await pool.query(
    `UPDATE cards
     SET card_column = 'backlog', updated_at = $1
     WHERE card_column = 'todo'
       AND COALESCE(BTRIM(description), '') = ''
       AND COALESCE(jsonb_array_length(checklist), 0) = 0`,
    [Date.now()],
  );
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
      card_column TEXT NOT NULL,
      done_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT 'otros';
  `);

  await pool.query(`
    UPDATE cards
    SET company = CASE
      WHEN LOWER(title || ' ' || description) ~ '(oasis vault|\mvault\M|oasisboard|oasis board|\moasis\M)' THEN 'vault'
      WHEN LOWER(title || ' ' || description) ~ '(the otc desk|otc desk|\motc\M|ficein|rail|provider)' THEN 'otc'
      ELSE 'otros'
    END
    WHERE company IS NULL OR company NOT IN ('otc', 'vault', 'otros');
  `);

  await pool.query(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'cards'::regclass
          AND c.contype = 'c'
          AND a.attname = 'card_column'
      LOOP
        EXECUTE format('ALTER TABLE cards DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE cards
    ADD CONSTRAINT cards_card_column_check
    CHECK (card_column IN ('backlog', 'todo', 'doing', 'done', 'history'));
  `);

  await pool.query(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'cards'::regclass
          AND c.contype = 'c'
          AND a.attname = 'company'
      LOOP
        EXECUTE format('ALTER TABLE cards DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE cards
    ADD CONSTRAINT cards_company_check
    CHECK (company IN ('otc', 'vault', 'otros'));
  `);

  const existing = await pool.query('SELECT COUNT(*)::int AS count FROM cards');
  if (existing.rows[0].count === 0) {
    const seedTitles = [
      'Fix mobile UX touch drag + vertical columns',
      'Deploy live verified',
      'Validate Backlog+Historial in prod',
      'Share final link',
    ];

    const now = Date.now();
    for (const title of seedTitles) {
      await pool.query(
        `INSERT INTO cards (id, title, description, checklist, company, card_column, done_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uid(), title, '', JSON.stringify([]), 'otros', 'backlog', null, now, now],
      );
    }
  }

  await migrateTodoIntoBacklog();
  await autoArchiveDoneCards();
}

app.get('/__version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    appVersion: APP_VERSION,
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    sourceVersion: process.env.SOURCE_VERSION || null,
  });
});

app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('html').send(renderIndexHtml());
});

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.get('/api/cards', async (_req, res) => {
  await autoArchiveDoneCards();
  const rows = await pool.query('SELECT * FROM cards ORDER BY created_at ASC');
  res.json({ cards: rows.rows.map(toCard) });
});

app.post('/api/cards', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });

  const description = String(req.body?.description || '').trim();
  const checklist = normalizeChecklist(req.body?.checklist);
  const company = normalizeCompany(req.body?.company, 'otros');
  const requestedColumn = String(req.body?.column || 'backlog');
  const baseColumn = ALLOWED_COLUMNS.has(requestedColumn) ? requestedColumn : 'backlog';
  const { column, doneAt } = applyChecklistRule(baseColumn, checklist, null);

  const card = {
    id: uid(),
    title,
    description,
    checklist,
    company,
    column,
    doneAt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await pool.query(
    `INSERT INTO cards (id, title, description, checklist, company, card_column, done_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      card.id,
      card.title,
      card.description,
      JSON.stringify(card.checklist),
      card.company,
      card.column,
      card.doneAt,
      card.createdAt,
      card.updatedAt,
    ],
  );

  res.status(201).json({ card });
});

app.patch('/api/cards/:id', async (req, res) => {
  const current = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not found' });

  const row = current.rows[0];
  const title = req.body?.title != null ? String(req.body.title).trim() : row.title;
  if (!title) return res.status(400).json({ error: 'title cannot be empty' });

  const description = req.body?.description != null ? String(req.body.description).trim() : row.description;
  const checklist = req.body?.checklist != null ? normalizeChecklist(req.body.checklist) : row.checklist;
  const company = req.body?.company != null ? normalizeCompany(req.body.company, row.company) : normalizeCompany(row.company, 'otros');
  const requestedColumn = req.body?.column != null ? String(req.body.column) : row.card_column;
  const baseColumn = ALLOWED_COLUMNS.has(requestedColumn) ? requestedColumn : row.card_column;
  const { column, doneAt } = applyChecklistRule(baseColumn, checklist, row.done_at);
  const updatedAt = Date.now();

  const updated = await pool.query(
    `UPDATE cards
     SET title = $2, description = $3, checklist = $4, company = $5, card_column = $6, done_at = $7, updated_at = $8
     WHERE id = $1
     RETURNING *`,
    [req.params.id, title, description, JSON.stringify(checklist), company, column, doneAt, updatedAt],
  );

  res.json({ card: toCard(updated.rows[0]) });
});

app.patch('/api/cards/:id/column', async (req, res) => {
  const column = String(req.body?.column || '');
  if (!ALLOWED_COLUMNS.has(column)) return res.status(400).json({ error: 'invalid column' });

  const current = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not found' });

  const row = current.rows[0];
  const { column: finalColumn, doneAt } = applyChecklistRule(column, row.checklist, row.done_at);

  const updated = await pool.query(
    `UPDATE cards SET card_column = $2, done_at = $3, updated_at = $4 WHERE id = $1 RETURNING *`,
    [req.params.id, finalColumn, doneAt, Date.now()],
  );

  res.json({ card: toCard(updated.rows[0]) });
});

app.patch('/api/cards/:id/checklist', async (req, res) => {
  const checklist = normalizeChecklist(req.body?.checklist);

  const current = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not found' });

  const row = current.rows[0];
  const { column, doneAt } = applyChecklistRule(row.card_column, checklist, row.done_at);

  const updated = await pool.query(
    `UPDATE cards SET checklist = $2, card_column = $3, done_at = $4, updated_at = $5 WHERE id = $1 RETURNING *`,
    [req.params.id, JSON.stringify(checklist), column, doneAt, Date.now()],
  );

  res.json({ card: toCard(updated.rows[0]) });
});

app.delete('/api/cards/:id', async (req, res) => {
  const deleted = await pool.query('DELETE FROM cards WHERE id = $1', [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('html').send(renderIndexHtml());
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_server_error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`oasis-board listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
