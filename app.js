const lists = {
  todo: document.getElementById('todoList'),
  doing: document.getElementById('doingList'),
  done: document.getElementById('doneList'),
  backlog: document.getElementById('backlogList'),
  history: document.getElementById('historyList'),
};

const tabButtons = {
  board: document.getElementById('boardTab'),
  backlog: document.getElementById('backlogTab'),
  history: document.getElementById('historyTab'),
};

const views = {
  board: document.getElementById('boardView'),
  backlog: document.getElementById('backlogView'),
  history: document.getElementById('historyView'),
};

const boardEl = document.getElementById('board');
const pullRefreshEl = document.getElementById('pullRefresh');
const dialog = document.getElementById('cardDialog');
const form = document.getElementById('cardForm');
const dialogTitle = document.getElementById('dialogTitle');
const titleInput = document.getElementById('titleInput');
const descInput = document.getElementById('descInput');
const columnInput = document.getElementById('columnInput');
const companyInput = document.getElementById('companyInput');
const addItemBtn = document.getElementById('addItemBtn');
const editChecklist = document.getElementById('editChecklist');
const cancelBtn = document.getElementById('cancelBtn');
const cardTemplate = document.getElementById('cardTemplate');
const versionBadgeEl = document.getElementById('runtimeVersion');
const companyFilterButtons = Array.from(document.querySelectorAll('[data-company-filter]'));

const APP_VERSION = window.APP_VERSION || window.__APP_VERSION__ || 'dev';
const COLUMN_ORDER = ['backlog', 'todo', 'doing', 'done', 'history'];
const VIEW_ORDER = ['backlog', 'board', 'history'];
const addCardButtons = Array.from(document.querySelectorAll('.add-card-btn'));

let state = { cards: [] };
let editingId = null;
let draftChecklist = [];
let activeView = 'board';
let activeCompanyFilter = 'all';
let touchDrag = null;
let latestLoadRequestId = 0;
const moveQueues = new Map();

const PULL_THRESHOLD = 86;
const PULL_MAX = 140;
const PULL_START_ZONE_PX = 96;
const TOUCH_DRAG_LONG_PRESS_MS = 380;
const TOUCH_DRAG_START_DISTANCE_PX = 24;
const TOUCH_DRAG_SCROLL_CANCEL_PX = 12;
const TOUCH_DRAG_AXIS_BIAS_PX = 8;
const pullState = {
  active: false,
  startX: 0,
  startY: 0,
  distance: 0,
  refreshing: false,
  armed: false,
};

const SWIPE_MIN_DISTANCE = 72;
const swipeState = {
  active: false,
  tracking: false,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
};

const dragLockClass = 'drag-mode-lock';
let dragLockHolders = 0;

const COMPANY_OPTIONS = new Set(['otc', 'vault', 'otros']);
const COMPANY_LABELS = {
  otc: 'The OTC Desk',
  vault: 'Oasis Vault',
  otros: 'Otros',
};
const COMPANY_FILTER_OPTIONS = new Set(['all', 'vault', 'otc']);
const COMPANY_FILTER_STORAGE_KEY = 'oasisBoard.companyFilter';

const OASIS_VAULT_KEYWORDS = [
  'oasis vault',
  'vault',
  'oasisboard',
  'oasis board',
  'oasis',
];

const OTC_DESK_KEYWORDS = [
  'the otc desk',
  'otc desk',
  'otc',
  'ficein',
  'rail',
  'provider',
];

function isDragModeLocked() {
  return dragLockHolders > 0;
}

function setDragModeLock(active) {
  document.documentElement.classList.toggle(dragLockClass, active);
  document.body.classList.toggle(dragLockClass, active);
  boardEl?.classList.toggle('touch-drag-active', active);
}

function beginDragModeLock() {
  dragLockHolders += 1;
  if (dragLockHolders === 1) {
    setDragModeLock(true);
    clearTextSelection();
  }
}

function endDragModeLock() {
  if (dragLockHolders === 0) return;
  dragLockHolders -= 1;
  if (dragLockHolders === 0) {
    setDragModeLock(false);
    clearTextSelection();
  }
}

function clearTextSelection() {
  const selection = window.getSelection?.();
  if (selection && selection.rangeCount) selection.removeAllRanges();
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function inferCompanyFromContent(card) {
  const haystack = `${card.title || ''} ${card.description || ''}`.toLowerCase();

  if (OASIS_VAULT_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'vault';
  }

  if (OTC_DESK_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'otc';
  }

  return 'otros';
}

function normalizeCardCompany(card) {
  const rawCompany = String(card?.company || '').trim().toLowerCase();
  if (COMPANY_OPTIONS.has(rawCompany)) return rawCompany;
  return inferCompanyFromContent(card);
}

function loadCompanyFilter() {
  try {
    const saved = localStorage.getItem(COMPANY_FILTER_STORAGE_KEY);
    if (COMPANY_FILTER_OPTIONS.has(saved)) return saved;
  } catch {}
  return 'all';
}

function persistCompanyFilter(value) {
  try {
    localStorage.setItem(COMPANY_FILTER_STORAGE_KEY, value);
  } catch {}
}

function cardMatchesCompanyFilter(company, filter = activeCompanyFilter) {
  if (filter === 'all') return true;
  return company === filter;
}

function setCompanyFilter(nextFilter, { persist = true } = {}) {
  if (!COMPANY_FILTER_OPTIONS.has(nextFilter)) return;
  activeCompanyFilter = nextFilter;

  for (const btn of companyFilterButtons) {
    const isActive = btn.dataset.companyFilter === nextFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }

  if (persist) persistCompanyFilter(nextFilter);
  render();
}

function buildCompactLinkLabel(index) {
  return `Link ${index}`;
}

function renderTextWithLinks(container, text) {
  container.textContent = '';
  if (!text) return;

  const regex = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  const trailingPunctuationRegex = /[),.;!?]+$/;
  let lastIndex = 0;
  let linkIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index;
    const rawMatch = match[0];
    const trailing = rawMatch.match(trailingPunctuationRegex)?.[0] || '';
    const value = trailing ? rawMatch.slice(0, -trailing.length) : rawMatch;

    if (!value) continue;

    if (matchStart > lastIndex) {
      container.append(document.createTextNode(text.slice(lastIndex, matchStart)));
    }

    linkIndex += 1;
    const href = value.startsWith('www.') ? `https://${value}` : value;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = buildCompactLinkLabel(linkIndex);
    container.append(anchor);

    if (trailing) {
      container.append(document.createTextNode(trailing));
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    container.append(document.createTextNode(text.slice(lastIndex)));
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function upsertCard(nextCard) {
  const idx = state.cards.findIndex((c) => c.id === nextCard.id);
  if (idx >= 0) state.cards[idx] = nextCard;
  else state.cards.push(nextCard);
}

function applyOptimisticColumn(cardId, targetColumn) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.column = targetColumn;
  card.doneAt = targetColumn === 'done' || targetColumn === 'history' ? Number(card.doneAt) || Date.now() : null;
}

async function loadCards() {
  const requestId = ++latestLoadRequestId;
  const data = await api('/api/cards');
  if (requestId !== latestLoadRequestId) return;

  state.cards = Array.isArray(data.cards) ? data.cards : [];

  for (const [cardId, queue] of moveQueues) {
    const optimisticColumn = queue.pendingColumn || (queue.processing ? queue.activeColumn : null);
    if (optimisticColumn) applyOptimisticColumn(cardId, optimisticColumn);
  }

  render();
}

function setPullUi(distance = 0, { visible = false, refreshing = false, pulling = false } = {}) {
  if (!pullRefreshEl) return;
  const y = -72 + Math.min(distance, PULL_MAX);
  const progress = Math.min(1, distance / PULL_THRESHOLD);

  pullRefreshEl.style.setProperty('--pull-progress', String(progress));
  pullRefreshEl.style.transform = `translate(-50%, ${y}px)`;
  pullRefreshEl.classList.toggle('visible', visible || refreshing);
  pullRefreshEl.classList.toggle('refreshing', refreshing);
  pullRefreshEl.classList.toggle('is-pulling', pulling && !refreshing);
}

function atTopForPull() {
  return window.scrollY <= 2;
}

function getScrollableAncestor(node) {
  let current = node instanceof Element ? node : null;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollY && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

function shouldStartPullRefresh(target, startY) {
  if (pullState.refreshing || touchDrag?.active) return false;
  if (!['board', 'backlog', 'history'].includes(activeView)) return false;
  if (!atTopForPull()) return false;
  if (typeof startY === 'number' && startY > PULL_START_ZONE_PX) return false;
  if (!(target instanceof Element)) return false;
  if (target.closest('button, input, textarea, select, label, a, dialog')) return false;

  const scrollAncestor = getScrollableAncestor(target);
  if (scrollAncestor && scrollAncestor.scrollTop > 0) return false;

  if (activeView === 'board' && target.closest('.card')) return false;
  return true;
}

function resetPullState() {
  pullState.active = false;
  pullState.distance = 0;
  pullState.armed = false;
  setPullUi(0, { visible: false, refreshing: pullState.refreshing, pulling: false });
}

async function triggerPullRefresh() {
  if (pullState.refreshing) return;
  pullState.refreshing = true;
  setPullUi(PULL_THRESHOLD, { visible: true, refreshing: true });

  try {
    await loadCards();
  } catch (err) {
    console.error(err);
    alert('Could not refresh cards from API.');
  } finally {
    pullState.refreshing = false;
    setPullUi(0, { visible: false, refreshing: false });
  }
}

function renderEmpty(listEl, text) {
  const note = document.createElement('p');
  note.className = 'empty-note';
  note.textContent = text;
  listEl.append(note);
}

function getNextColumn(column) {
  const idx = COLUMN_ORDER.indexOf(column);
  if (idx < 0 || idx >= COLUMN_ORDER.length - 1) return null;
  return COLUMN_ORDER[idx + 1];
}

function createCardNode(card, { draggable = false } = {}) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = card.id;

  const company = normalizeCardCompany(card);
  node.dataset.company = company;
  node.classList.add(`card-company-${company}`);

  if (!draggable) node.draggable = false;

  node.querySelector('.card-title').textContent = card.title;

  const companyLabel = node.querySelector('.card-company-label');
  if (companyLabel) companyLabel.textContent = COMPANY_LABELS[company] || COMPANY_LABELS.otros;

  const descEl = node.querySelector('.card-desc');
  renderTextWithLinks(descEl, card.description || '');

  const advanceBtn = node.querySelector('.advance-btn');
  const nextColumn = getNextColumn(card.column);
  if (advanceBtn) {
    advanceBtn.disabled = !nextColumn;
    advanceBtn.addEventListener('click', async () => {
      if (!nextColumn) return;
      try {
        await moveCardToColumn(card.id, nextColumn);
      } catch (err) {
        alert(`Could not advance card: ${err.message}`);
        await loadCards();
      }
    });
  }

  const checklistEl = node.querySelector('.checklist');
  card.checklist.forEach((item) => {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.checked;
    cb.addEventListener('change', async () => {
      try {
        const nextChecklist = card.checklist.map((i) =>
          i.id === item.id ? { ...i, checked: cb.checked } : i,
        );
        const data = await api(`/api/cards/${card.id}/checklist`, {
          method: 'PATCH',
          body: JSON.stringify({ checklist: nextChecklist }),
        });
        if (data?.card) {
          upsertCard(data.card);
          render();
          return;
        }
        await loadCards();
      } catch (err) {
        alert(`Could not update checklist: ${err.message}`);
        await loadCards();
      }
    });

    const span = document.createElement('span');
    span.textContent = item.text;
    if (item.checked) span.classList.add('done');

    li.append(cb, span);
    checklistEl.append(li);
  });

  node.querySelector('.edit-btn').addEventListener('click', () => openEditor(card.id));

  if (draggable) {
    node.addEventListener('dragstart', () => {
      node.classList.add('dragging');
      beginDragModeLock();
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      endDragModeLock();
    });
    node.addEventListener('pointerdown', onTouchPointerDown);
  }

  return node;
}

function render() {
  const fragments = {
    todo: document.createDocumentFragment(),
    doing: document.createDocumentFragment(),
    done: document.createDocumentFragment(),
    backlog: document.createDocumentFragment(),
    history: document.createDocumentFragment(),
  };

  const historyCards = [];
  let backlogCount = 0;

  for (const card of state.cards) {
    const company = normalizeCardCompany(card);
    if (!cardMatchesCompanyFilter(company)) continue;

    if (card.column === 'history') {
      historyCards.push(card);
      continue;
    }

    if (card.column === 'backlog') {
      fragments.backlog.append(createCardNode(card));
      backlogCount += 1;
      continue;
    }

    if (card.column === 'todo' || card.column === 'doing' || card.column === 'done') {
      fragments[card.column].append(createCardNode(card, { draggable: true }));
    }
  }

  historyCards
    .sort((a, b) => Number(b.doneAt || 0) - Number(a.doneAt || 0))
    .forEach((card) => fragments.history.append(createCardNode(card)));

  if (!backlogCount) {
    const backlogMsg = activeCompanyFilter === 'all'
      ? 'Backlog is empty.'
      : 'No backlog cards for this company filter.';
    renderEmpty(fragments.backlog, backlogMsg);
  }

  if (!historyCards.length) {
    const historyMsg = activeCompanyFilter === 'all'
      ? 'No archived cards yet.'
      : 'No archived cards for this company filter.';
    renderEmpty(fragments.history, historyMsg);
  }

  lists.todo.replaceChildren(fragments.todo);
  lists.doing.replaceChildren(fragments.doing);
  lists.done.replaceChildren(fragments.done);
  lists.backlog.replaceChildren(fragments.backlog);
  lists.history.replaceChildren(fragments.history);
}

function setView(viewName) {
  if (!VIEW_ORDER.includes(viewName)) return;
  activeView = viewName;
  if (!pullState.refreshing) resetPullState();

  Object.entries(tabButtons).forEach(([name, btn]) => {
    btn.classList.toggle('active', name === viewName);
    btn.setAttribute('aria-selected', String(name === viewName));
  });

  Object.entries(views).forEach(([name, panel]) => {
    panel.classList.toggle('active', name === viewName);
  });
}

function openEditor(cardId = null, preferredColumn = null) {
  editingId = cardId;
  const card = state.cards.find((c) => c.id === cardId);

  dialogTitle.textContent = card ? 'Edit Card' : 'New Card';
  titleInput.value = card?.title || '';
  descInput.value = card?.description || '';
  columnInput.value = card?.column || preferredColumn || 'backlog';
  companyInput.value = normalizeCardCompany(card || {});
  draftChecklist = card ? card.checklist.map((i) => ({ ...i })) : [];
  renderChecklistEditor();

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    requestAnimationFrame(() => {
      if (!dialog.open) return;
      const active = document.activeElement;
      if (active && dialog.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
        active.blur();
      }
      try {
        dialog.focus({ preventScroll: true });
      } catch {
        dialog.focus();
      }
    });
  }
}

function closeEditor() {
  form.reset();
  editChecklist.innerHTML = '';
  editingId = null;
  draftChecklist = [];
  dialog.close();
}

function renderChecklistEditor() {
  editChecklist.innerHTML = '';
  draftChecklist.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'edit-item';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.text;
    input.placeholder = 'Checklist item';
    input.addEventListener('input', () => {
      draftChecklist[idx].text = input.value;
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      draftChecklist.splice(idx, 1);
      renderChecklistEditor();
    });

    row.append(input, remove);
    editChecklist.append(row);
  });
}

function findColumnFromPoint(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  return hit.closest('.column');
}

function updateTouchDropTarget(column) {
  if (!touchDrag) return;
  if (touchDrag.currentDropColumnEl === column) return;
  touchDrag.currentDropColumnEl?.classList.remove('drop-target');
  if (column) column.classList.add('drop-target');
  touchDrag.currentDropColumnEl = column || null;
}

function cleanupTouchDrag() {
  if (!touchDrag) return;
  if (touchDrag.pressTimer) clearTimeout(touchDrag.pressTimer);
  if (touchDrag.moveRaf) cancelAnimationFrame(touchDrag.moveRaf);
  if (touchDrag.ghost?.parentNode) touchDrag.ghost.remove();
  touchDrag.node.classList.remove('touch-drag-source');
  touchDrag.node.style.userSelect = '';
  touchDrag.node.style.webkitUserSelect = '';
  if (touchDrag.lockApplied) endDragModeLock();
  updateTouchDropTarget(null);
  touchDrag = null;
}

function startTouchDrag(clientX, clientY) {
  if (!touchDrag || touchDrag.active || touchDrag.cancelled) return;
  touchDrag.active = true;
  if (touchDrag.node.setPointerCapture) {
    touchDrag.node.setPointerCapture(touchDrag.pointerId);
  }
  touchDrag.node.classList.add('touch-drag-source');
  touchDrag.node.style.userSelect = 'none';
  touchDrag.node.style.webkitUserSelect = 'none';
  beginDragModeLock();
  touchDrag.lockApplied = true;
  clearTextSelection();

  const ghost = touchDrag.node.cloneNode(true);
  ghost.classList.add('touch-drag-ghost');
  ghost.removeAttribute('draggable');
  ghost.style.userSelect = 'none';
  ghost.style.webkitUserSelect = 'none';
  document.body.append(ghost);
  touchDrag.ghost = ghost;

  touchDrag.ghost.style.transform = `translate3d(${clientX}px, ${clientY}px, 0) translate(-50%, -50%)`;
}

function paintTouchDrag() {
  if (!touchDrag?.active || !touchDrag.ghost) return;

  touchDrag.ghost.style.transform = `translate3d(${touchDrag.lastX}px, ${touchDrag.lastY}px, 0) translate(-50%, -50%)`;

  const column = findColumnFromPoint(touchDrag.lastX, touchDrag.lastY);
  touchDrag.targetColumn = column?.dataset.column || null;
  updateTouchDropTarget(column);
  touchDrag.moveRaf = null;
}

function onTouchPointerDown(e) {
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  if (e.button !== 0) return;
  if (e.target.closest('button, input, textarea, select, label, a')) return;

  const node = e.currentTarget;
  touchDrag = {
    pointerId: e.pointerId,
    cardId: node.dataset.id,
    node,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    active: false,
    cancelled: false,
    lockApplied: false,
    ghost: null,
    targetColumn: null,
    pressTimer: null,
    currentDropColumnEl: null,
    moveRaf: null,
  };

  touchDrag.pressTimer = setTimeout(() => {
    if (!touchDrag || touchDrag.pointerId !== e.pointerId || touchDrag.cancelled || touchDrag.active) return;
    startTouchDrag(touchDrag.lastX, touchDrag.lastY);
  }, TOUCH_DRAG_LONG_PRESS_MS);

  node.addEventListener('pointermove', onTouchPointerMove);
  node.addEventListener('pointerup', onTouchPointerUp);
  node.addEventListener('pointercancel', onTouchPointerCancel);
  node.addEventListener('lostpointercapture', onTouchPointerCancel);
}

function onTouchPointerMove(e) {
  if (!touchDrag || touchDrag.pointerId !== e.pointerId) return;

  const dx = e.clientX - touchDrag.startX;
  const dy = e.clientY - touchDrag.startY;
  const distance = Math.hypot(dx, dy);
  touchDrag.lastX = e.clientX;
  touchDrag.lastY = e.clientY;

  if (!touchDrag.active) {
    const verticalIntent = Math.abs(dy) > Math.abs(dx) + TOUCH_DRAG_AXIS_BIAS_PX;
    if (verticalIntent && distance > TOUCH_DRAG_SCROLL_CANCEL_PX) {
      cancelPendingTouchDrag();
      return;
    }

    const horizontalIntent = Math.abs(dx) > Math.abs(dy) + TOUCH_DRAG_AXIS_BIAS_PX;
    if (horizontalIntent && distance >= TOUCH_DRAG_START_DISTANCE_PX) {
      startTouchDrag(e.clientX, e.clientY);
    }
  }

  if (!touchDrag.active) return;
  e.preventDefault();

  if (!touchDrag.moveRaf) {
    touchDrag.moveRaf = requestAnimationFrame(paintTouchDrag);
  }
}

function finishTouchPointer(node) {
  if (touchDrag?.pointerId != null && node.hasPointerCapture?.(touchDrag.pointerId)) {
    node.releasePointerCapture(touchDrag.pointerId);
  }
  node.removeEventListener('pointermove', onTouchPointerMove);
  node.removeEventListener('pointerup', onTouchPointerUp);
  node.removeEventListener('pointercancel', onTouchPointerCancel);
  node.removeEventListener('lostpointercapture', onTouchPointerCancel);
}

function cancelPendingTouchDrag() {
  if (!touchDrag || touchDrag.active) return;
  touchDrag.cancelled = true;
  if (touchDrag.pressTimer) {
    clearTimeout(touchDrag.pressTimer);
    touchDrag.pressTimer = null;
  }
  finishTouchPointer(touchDrag.node);
  touchDrag = null;
}

function ensureMoveQueue(cardId) {
  if (!moveQueues.has(cardId)) {
    moveQueues.set(cardId, {
      processing: false,
      pendingColumn: null,
      activeColumn: null,
    });
  }
  return moveQueues.get(cardId);
}

function clearMoveQueueIfIdle(cardId) {
  const queue = moveQueues.get(cardId);
  if (!queue) return;
  if (!queue.processing && !queue.pendingColumn) moveQueues.delete(cardId);
}

async function processMoveQueue(cardId) {
  const queue = ensureMoveQueue(cardId);
  if (queue.processing) return;

  queue.processing = true;
  try {
    while (queue.pendingColumn) {
      const nextColumn = queue.pendingColumn;
      queue.pendingColumn = null;
      queue.activeColumn = nextColumn;

      const data = await api(`/api/cards/${cardId}/column`, {
        method: 'PATCH',
        body: JSON.stringify({ column: nextColumn }),
      });

      if (data?.card) upsertCard(data.card);
      render();
    }
  } finally {
    queue.processing = false;
    queue.activeColumn = null;
    clearMoveQueueIfIdle(cardId);
  }
}

async function moveCardToColumn(cardId, targetColumn) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || card.column === targetColumn) return;

  const queue = ensureMoveQueue(cardId);
  queue.pendingColumn = targetColumn;

  applyOptimisticColumn(cardId, targetColumn);
  render();

  await processMoveQueue(cardId);
}

async function onTouchPointerUp(e) {
  if (!touchDrag || touchDrag.pointerId !== e.pointerId) return;

  const { cardId, targetColumn, active, node } = touchDrag;
  if (active) e.preventDefault();
  finishTouchPointer(node);

  try {
    if (active && targetColumn) {
      await moveCardToColumn(cardId, targetColumn);
    }
  } catch (err) {
    alert(`Could not move card: ${err.message}`);
    await loadCards();
  }

  cleanupTouchDrag();
}

function onTouchPointerCancel(e) {
  if (!touchDrag || touchDrag.pointerId !== e.pointerId) return;
  finishTouchPointer(touchDrag.node);
  cleanupTouchDrag();
}

for (const btn of addCardButtons) {
  btn.addEventListener('click', () => openEditor(null, btn.dataset.column || 'backlog'));
}

tabButtons.board.addEventListener('click', () => setView('board'));
tabButtons.backlog.addEventListener('click', () => setView('backlog'));
tabButtons.history.addEventListener('click', () => setView('history'));

for (const btn of companyFilterButtons) {
  btn.addEventListener('click', () => setCompanyFilter(btn.dataset.companyFilter || 'all'));
}

function resetSwipeState() {
  swipeState.active = false;
  swipeState.tracking = false;
  swipeState.dx = 0;
  swipeState.dy = 0;
}

function shouldTrackSwipe(target) {
  if (!(target instanceof Element)) return false;
  if (pullState.active || pullState.refreshing || touchDrag?.active) return false;
  if (dialog.open) return false;
  if (target.closest('button, input, textarea, select, label, a, dialog')) return false;
  if (activeView === 'board' && target.closest('.card')) return false;
  return true;
}

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) {
    resetSwipeState();
    return;
  }
  if (!shouldTrackSwipe(e.target)) {
    resetSwipeState();
    return;
  }
  const t = e.touches[0];
  swipeState.active = true;
  swipeState.tracking = false;
  swipeState.startX = t.clientX;
  swipeState.startY = t.clientY;
  swipeState.dx = 0;
  swipeState.dy = 0;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!swipeState.active || pullState.active || touchDrag?.active) return;
  if (e.touches.length !== 1) {
    resetSwipeState();
    return;
  }

  const t = e.touches[0];
  swipeState.dx = t.clientX - swipeState.startX;
  swipeState.dy = t.clientY - swipeState.startY;

  if (!swipeState.tracking) {
    const horizontalIntent = Math.abs(swipeState.dx) > Math.abs(swipeState.dy) + TOUCH_DRAG_AXIS_BIAS_PX;
    if (!horizontalIntent) {
      if (Math.abs(swipeState.dy) > TOUCH_DRAG_SCROLL_CANCEL_PX) resetSwipeState();
      return;
    }
    swipeState.tracking = true;
  }

  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!swipeState.active || !swipeState.tracking) {
    resetSwipeState();
    return;
  }

  const distance = swipeState.dx;
  const currentIndex = VIEW_ORDER.indexOf(activeView);
  if (distance <= -SWIPE_MIN_DISTANCE && currentIndex < VIEW_ORDER.length - 1) {
    setView(VIEW_ORDER[currentIndex + 1]);
  } else if (distance >= SWIPE_MIN_DISTANCE && currentIndex > 0) {
    setView(VIEW_ORDER[currentIndex - 1]);
  }

  resetSwipeState();
}, { passive: true });

document.addEventListener('touchcancel', resetSwipeState, { passive: true });

addItemBtn.addEventListener('click', () => {
  draftChecklist.push({ id: uid(), text: '', checked: false });
  renderChecklistEditor();
});

cancelBtn.addEventListener('click', closeEditor);

dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEditor();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  const description = descInput.value.trim();
  const column = columnInput.value;
  const company = normalizeCardCompany({ company: companyInput.value });
  const checklist = draftChecklist
    .map((i) => ({ ...i, text: (i.text || '').trim() }))
    .filter((i) => i.text.length > 0);

  try {
    if (editingId) {
      await api(`/api/cards/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description, checklist, column, company }),
      });
    } else {
      await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({ title, description, checklist, column, company }),
      });
    }

    await loadCards();
    closeEditor();
  } catch (err) {
    alert(`Could not save card: ${err.message}`);
  }
});

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const touch = e.touches[0];
  if (!shouldStartPullRefresh(e.target, touch.clientY)) return;

  pullState.active = true;
  pullState.startX = touch.clientX;
  pullState.startY = touch.clientY;
  pullState.distance = 0;
  pullState.armed = false;
  setPullUi(0, { visible: false, refreshing: pullState.refreshing, pulling: false });
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (touchDrag?.active) {
    e.preventDefault();
    return;
  }

  if (!pullState.active || pullState.refreshing) return;
  if (e.touches.length !== 1) {
    resetPullState();
    return;
  }

  if (!atTopForPull()) {
    resetPullState();
    return;
  }

  const dy = e.touches[0].clientY - pullState.startY;
  const dx = e.touches[0].clientX - pullState.startX;
  if (Math.abs(dx) > Math.abs(dy) + TOUCH_DRAG_AXIS_BIAS_PX) {
    resetPullState();
    return;
  }

  if (dy <= 0) {
    resetPullState();
    return;
  }

  const easedDistance = Math.min(PULL_MAX, dy * 0.55);
  pullState.distance = easedDistance;
  pullState.armed = easedDistance >= PULL_THRESHOLD;
  setPullUi(easedDistance, { visible: true, refreshing: false, pulling: true });
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', async () => {
  if (!pullState.active) return;

  const shouldRefresh = pullState.armed;
  resetPullState();

  if (shouldRefresh) await triggerPullRefresh();
}, { passive: true });

document.addEventListener('touchcancel', () => {
  if (!pullState.active) return;
  resetPullState();
}, { passive: true });

document.addEventListener('selectstart', (e) => {
  if (!isDragModeLocked()) return;
  e.preventDefault();
  clearTextSelection();
});

document.addEventListener('selectionchange', () => {
  if (!isDragModeLocked()) return;
  clearTextSelection();
});

document.addEventListener('contextmenu', (e) => {
  if (!isDragModeLocked()) return;
  e.preventDefault();
});

document.addEventListener('dragend', () => {
  if (isDragModeLocked() && !touchDrag?.active) endDragModeLock();
});

for (const column of document.querySelectorAll('.column')) {
  const targetColumn = column.dataset.column;
  column.addEventListener('dragover', (e) => {
    e.preventDefault();
    column.classList.add('drop-target');
  });
  column.addEventListener('dragleave', () => column.classList.remove('drop-target'));
  column.addEventListener('drop', async (e) => {
    e.preventDefault();
    column.classList.remove('drop-target');
    const draggingNode = document.querySelector('.card.dragging');
    if (!draggingNode) return;

    try {
      await moveCardToColumn(draggingNode.dataset.id, targetColumn);
    } catch (err) {
      alert(`Could not move card: ${err.message}`);
      await loadCards();
    }
  });
}

function renderRuntimeVersion() {
  if (versionBadgeEl) versionBadgeEl.textContent = `v${APP_VERSION}`;
  console.info(`[oasis-board] runtime ${APP_VERSION}`);
}

if ('serviceWorker' in navigator) {
  let reloadingForSw = false;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_ACTIVATED') {
      console.info(`[oasis-board] service worker active ${event.data.version}`);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForSw) return;
    reloadingForSw = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(APP_VERSION)}`);
      registration.update().catch(() => {});
    } catch {}
  });
}

activeCompanyFilter = loadCompanyFilter();
setCompanyFilter(activeCompanyFilter, { persist: false });

renderRuntimeVersion();
setView(activeView);
loadCards().catch((err) => {
  console.error(err);
  alert('Could not load board data from API.');
});
