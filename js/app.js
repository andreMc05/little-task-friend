(() => {
  'use strict';

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));
  const now = () => Date.now();
  const clampStr = (s, max=12000) => (typeof s === 'string' ? s.slice(0,max) : '');
  const parseTags = (s) => clampStr(s, 600).split(',').map(x => x.trim()).filter(Boolean).slice(0, 30);
  const fmtDate = (ts) => { if (!ts) return '—'; try { return new Date(ts).toLocaleString(); } catch { return '—'; } };
  const fmtHMS = (ms) => {
    ms = Math.max(0, ms|0);
    const s = Math.floor(ms/1000);
    const hh = Math.floor(s/3600);
    const mm = Math.floor((s%3600)/60);
    const ss = s%60;
    const pad = (n) => String(n).padStart(2,'0');
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  };
  const parseTimeEstimate = (s) => {
    if (!s || typeof s !== 'string') return null;
    s = s.trim();
    if (!s) return null;
    // Try HH:MM:SS or MM:SS format
    const timeMatch = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
    if (timeMatch) {
      const hh = parseInt(timeMatch[1] || '0', 10);
      const mm = parseInt(timeMatch[2] || '0', 10);
      const ss = parseInt(timeMatch[3] || '0', 10);
      return (hh * 3600 + mm * 60 + ss) * 1000;
    }
    // Try "30m", "2h", "1.5h" format
    const unitMatch = s.match(/^(\d+(?:\.\d+)?)\s*([hm])$/i);
    if (unitMatch) {
      const val = parseFloat(unitMatch[1]);
      const unit = unitMatch[2].toLowerCase();
      if (unit === 'h') return val * 3600 * 1000;
      if (unit === 'm') return val * 60 * 1000;
    }
    // Try just a number (assume minutes)
    const numMatch = s.match(/^(\d+(?:\.\d+)?)$/);
    if (numMatch) {
      return parseFloat(numMatch[1]) * 60 * 1000;
    }
    return null;
  };
  const fmtTimeEstimate = (ms) => {
    if (!ms || !Number.isFinite(ms)) return '';
    const s = Math.floor(ms/1000);
    const hh = Math.floor(s/3600);
    const mm = Math.floor((s%3600)/60);
    if (hh > 0) return `${hh}:${String(mm).padStart(2,'0')}`;
    return `${mm}m`;
  };
  const getTimeIndicator = (elapsedMs, estimateMs) => {
    if (!estimateMs || !Number.isFinite(estimateMs)) return null;
    const ratio = elapsedMs / estimateMs;
    if (ratio < 0.8) return { color: 'var(--color-accent-2)', label: 'under', ratio }; // Green - under estimate
    if (ratio >= 1.0) return { color: 'var(--color-danger)', label: 'over', ratio }; // Red - over estimate
    
    // Gradual transition from blue to red as elapsed approaches estimate (0.8 to 1.0)
    // Interpolate between accent (blue) and danger (red)
    const progress = (ratio - 0.8) / 0.2; // 0 to 1 as ratio goes from 0.8 to 1.0
    // Use color-mix to blend blue and red
    const redMix = Math.round(progress * 100);
    return { 
      color: `color-mix(in oklab, var(--color-danger) ${redMix}%, var(--color-accent))`, 
      label: 'approaching',
      ratio 
    };
  };
  const isOverEstimate = (elapsedMs, estimateMs) => {
    if (!estimateMs || !Number.isFinite(estimateMs)) return false;
    return elapsedMs > estimateMs;
  };
  const safeText = (s) => (s == null ? '' : String(s));
  const announce = (msg) => {
    const el = $('#live');
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 10);
  };

  // IndexedDB wrapper
  const DB_NAME = 'dev-task-hub';
  const DB_VER = 1;

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;

        const tasks = db.createObjectStore('tasks', { keyPath:'id' });
        tasks.createIndex('status', 'status', { unique:false });
        tasks.createIndex('createdAt', 'createdAt', { unique:false });

        const notes = db.createObjectStore('notes', { keyPath:'id' });
        notes.createIndex('category', 'category', { unique:false });
        notes.createIndex('updatedAt', 'updatedAt', { unique:false });

        const ideas = db.createObjectStore('ideas', { keyPath:'id' });
        ideas.createIndex('status', 'status', { unique:false });
        ideas.createIndex('updatedAt', 'updatedAt', { unique:false });

        db.createObjectStore('meta', { keyPath:'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }

  const idb = {
    db: null,
    async init(){
      this.db = await openDB();
      const s = await this.getMeta('settings');
      if (!s){
        await this.setMeta('settings', { key:'settings', oneActiveTask: true, autoStopOnComplete: true });
      }
    },
    getAll(store){
      return new Promise((resolve, reject) => {
        const req = tx(this.db, store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    put(store, obj){
      return new Promise((resolve, reject) => {
        const req = tx(this.db, store, 'readwrite').put(obj);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
    del(store, id){
      return new Promise((resolve, reject) => {
        const req = tx(this.db, store, 'readwrite').delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
    clear(store){
      return new Promise((resolve, reject) => {
        const req = tx(this.db, store, 'readwrite').clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
    getMeta(key){
      return new Promise((resolve, reject) => {
        const req = tx(this.db, 'meta').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },
    setMeta(key, value){
      return new Promise((resolve, reject) => {
        const req = tx(this.db, 'meta', 'readwrite').put({ key, ...value });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }
  };

  // State
  const state = {
    view: 'tasks',
    q: '',
    tasks: [],
    notes: [],
    ideas: [],
    settings: { oneActiveTask: true, autoStopOnComplete: true },
    tickMs: 1000,
    _interval: null,
  };

  const el = {
    panel: $('#panel'),
    q: $('#q'),
    pillTasks: $('#pillTasks'),
    pillNotes: $('#pillNotes'),
    pillIdeas: $('#pillIdeas'),

    btnAddTask: $('#btnAddTask'),
    btnAddNote: $('#btnAddNote'),
    btnAddIdea: $('#btnAddIdea'),

    btnExport: $('#btnExport'),
    btnImport: $('#btnImport'),
    fileImport: $('#fileImport'),

    dlgTask: $('#dlgTask'),
    formTask: $('#formTask'),
    btnDeleteTask: $('#btnDeleteTask'),
    btnCancelTask: $('#btnCancelTask'),

    dlgNote: $('#dlgNote'),
    formNote: $('#formNote'),
    btnDeleteNote: $('#btnDeleteNote'),
    btnCancelNote: $('#btnCancelNote'),

    dlgIdea: $('#dlgIdea'),
    formIdea: $('#formIdea'),
    btnDeleteIdea: $('#btnDeleteIdea'),
    btnCancelIdea: $('#btnCancelIdea'),
  };

  function currentElapsed(task){
    if (!task) return 0;
    let ms = task.elapsedMs || 0;
    if (task.status === 'active' && task.activeSince) ms += (now() - task.activeSince);
    return ms;
  }

  function normalizeTask(t){
    const createdAt = t.createdAt || now();
    const status = t.status || 'todo';
    const estimateMs = t.estimateMs != null ? (Number.isFinite(t.estimateMs) ? Math.max(0, t.estimateMs) : null) : null;
    return {
      id: t.id || uid(),
      title: clampStr(t.title, 140),
      description: clampStr(t.description, 6000),
      category: clampStr(t.category, 80),
      subcategory: clampStr(t.subcategory, 80),
      tags: Array.isArray(t.tags) ? t.tags.slice(0,30) : parseTags(t.tags || ''),
      taskLink: clampStr(t.taskLink, 500),
      repoLink: clampStr(t.repoLink, 500),
      estimateMs,
      createdAt,
      completedAt: t.completedAt || null,
      status,
      activeSince: t.activeSince || null,
      elapsedMs: Number.isFinite(t.elapsedMs) ? Math.max(0, t.elapsedMs) : 0,
      sessions: Array.isArray(t.sessions) ? t.sessions.slice(0, 500) : [],
      noteIds: Array.isArray(t.noteIds) ? t.noteIds.slice(0, 200) : [],
    };
  }

  function normalizeNote(n){
    return {
      id: n.id || uid(),
      title: clampStr(n.title, 140),
      body: clampStr(n.body, 12000),
      category: clampStr(n.category, 80),
      subcategory: clampStr(n.subcategory, 80),
      tags: Array.isArray(n.tags) ? n.tags.slice(0,30) : parseTags(n.tags || ''),
      linkedTaskIds: Array.isArray(n.linkedTaskIds) ? n.linkedTaskIds.slice(0, 200) :
        clampStr(n.linkedTaskIds || '', 400).split(',').map(x => x.trim()).filter(Boolean).slice(0,200),
      createdAt: n.createdAt || now(),
      updatedAt: now(),
    };
  }

  function normalizeIdea(i){
    return {
      id: i.id || uid(),
      title: clampStr(i.title, 140),
      problem: clampStr(i.problem, 6000),
      approach: clampStr(i.approach, 6000),
      nextStep: clampStr(i.nextStep, 220),
      status: (i.status || 'seed'),
      tags: Array.isArray(i.tags) ? i.tags.slice(0,30) : parseTags(i.tags || ''),
      links: Array.isArray(i.links) ? i.links.slice(0,60) :
        clampStr(i.links || '', 600).split(',').map(x => x.trim()).filter(Boolean).slice(0,60),
      createdAt: i.createdAt || now(),
      updatedAt: now(),
    };
  }

  function byUpdatedDesc(a,b){ return (b.updatedAt||0) - (a.updatedAt||0); }
  function byCreatedDesc(a,b){ return (b.createdAt||0) - (a.createdAt||0); }

  function matchesQuery(obj){
    const q = state.q.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      obj.title, obj.description, obj.body, obj.problem, obj.approach, obj.nextStep,
      obj.category, obj.subcategory,
      obj.taskLink, obj.repoLink,
      ...(obj.tags || []),
      ...(obj.links || []),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  function escapeHTML(s){
    s = safeText(s);
    return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s){ return escapeHTML(s).replace(/`/g, '&#96;'); }
  function shorten(s, n){ s = safeText(s); return s.length <= n ? s : (s.slice(0, n-1) + '…'); }
  function titleCase(s){ return safeText(s).replace(/\b\w/g, (m)=>m.toUpperCase()); }

  function setNav(view){
    state.view = view;
    $$('.navbtn').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    render();
  }

  function render(){
    el.pillTasks.textContent = String(state.tasks.length);
    el.pillNotes.textContent = String(state.notes.length);
    el.pillIdeas.textContent = String(state.ideas.length);

    if (state.view === 'tasks') renderTasks();
    else if (state.view === 'notes') renderNotes();
    else if (state.view === 'ideas') renderIdeas();
    else renderSettings();
  }

  function renderTasks(){
    const tasks = state.tasks.filter(matchesQuery).slice().sort((a,b) => {
      const rank = (t) => t.status === 'active' ? 0 : (t.status === 'done' ? 2 : 1);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return byCreatedDesc(a,b);
    });

    const activeCount = state.tasks.filter(t => t.status === 'active').length;

    el.panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `
      <div>
        <h1>Tasks</h1>
        <p>Start/stop timers. Track total time from first start to completion.</p>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Task actions">
        <span class="pill" title="Active tasks">${activeCount} active</span>
        <button class="btn primary" type="button" data-action="openAddTask">+ Add task</button>
      </div>
    `;
    el.panel.appendChild(head);

    const filterRow = document.createElement('div');
    filterRow.className = 'row';
    filterRow.innerHTML = `
      <div class="field">
        <label for="taskFilter">Filter</label>
        <select id="taskFilter">
          <option value="all">All</option>
          <option value="todo">To do</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div class="field">
        <label for="taskSort">Sort</label>
        <select id="taskSort">
          <option value="smart">Smart (active → newest)</option>
          <option value="createdDesc">Created (newest)</option>
          <option value="createdAsc">Created (oldest)</option>
          <option value="timeDesc">Elapsed (most)</option>
        </select>
      </div>
      <div class="field">
        <label for="taskWip">WIP limit</label>
        <select id="taskWip">
          <option value="on">1 active at a time (recommended)</option>
          <option value="off">Allow multiple active tasks</option>
        </select>
      </div>
    `;
    el.panel.appendChild(filterRow);

    $('#taskWip').value = state.settings.oneActiveTask ? 'on' : 'off';

    const list = document.createElement('div');
    list.className = 'list';
    list.id = 'taskList';
    el.panel.appendChild(list);

    const filterSel = $('#taskFilter');
    const sortSel = $('#taskSort');

    const paint = () => {
      const filter = filterSel.value;
      const sort = sortSel.value;

      let items = tasks.filter(t => filter === 'all' ? true : t.status === filter);

      if (sort === 'createdDesc') items.sort(byCreatedDesc);
      if (sort === 'createdAsc') items.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
      if (sort === 'timeDesc') items.sort((a,b) => currentElapsed(b) - currentElapsed(a));
      if (sort === 'smart'){
        items.sort((a,b) => {
          const rank = (t) => t.status === 'active' ? 0 : (t.status === 'done' ? 2 : 1);
          const r = rank(a) - rank(b);
          if (r !== 0) return r;
          return byCreatedDesc(a,b);
        });
      }

      list.innerHTML = '';
      if (items.length === 0){
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = `<b>No tasks yet.</b><div style="margin-top:.35rem;">Add one, then start/stop to track how long it takes.</div>`;
        list.appendChild(empty);
        return;
      }

      const frag = document.createDocumentFragment();
      for (const t of items) frag.appendChild(taskCard(t));
      list.appendChild(frag);
    };

    filterSel.addEventListener('change', paint, { passive:true });
    sortSel.addEventListener('change', paint, { passive:true });
    $('#taskWip').addEventListener('change', async (e) => {
      state.settings.oneActiveTask = (e.target.value === 'on');
      await idb.setMeta('settings', { ...state.settings });
      announce(state.settings.oneActiveTask ? 'WIP limit enabled' : 'WIP limit disabled');
    }, { passive:true });

    paint();
  }

  function taskCard(t){
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.kind = 'task';
    card.dataset.id = t.id;

    const statusLabel = t.status === 'todo' ? 'todo' : t.status;
    const statusClass = t.status === 'active' ? 'active' : (t.status === 'done' ? 'done' : 'paused');

    const elapsed = currentElapsed(t);
    const indicator = getTimeIndicator(elapsed, t.estimateMs);
    const overEstimate = isOverEstimate(elapsed, t.estimateMs);
    
    // Apply card styling if over estimate (508 compliant - uses border, background, and visual indicators)
    if (overEstimate) {
      card.style.borderLeft = '4px solid var(--color-danger)';
      card.style.borderColor = 'color-mix(in oklab, var(--color-danger) 40%, var(--color-border))';
      card.style.background = 'color-mix(in oklab, var(--color-danger) 8%, var(--color-surface-2))';
      card.setAttribute('aria-label', `${escapeAttr(t.title)} - Over time estimate`);
    }
    
    const elapsedDisplay = `<span class="mono" data-elapsed="1">${escapeHTML(fmtHMS(elapsed))}</span>`;
    const elapsedWithIndicator = indicator 
      ? `<span style="display: inline-flex; align-items: center; gap: .3rem;">${elapsedDisplay}<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${indicator.color};" title="${escapeAttr(indicator.label)}" aria-label="${escapeAttr(indicator.label)}"></span></span>`
      : elapsedDisplay;

    const meta = [];
    meta.push(`<span class="status ${statusClass}">${statusLabel}</span>`);
    if (t.category) meta.push(`<span class="tag">${escapeHTML(t.category)}${t.subcategory ? ' • ' + escapeHTML(t.subcategory) : ''}</span>`);
    meta.push(`<span>Created: ${escapeHTML(fmtDate(t.createdAt))}</span>`);
    if (t.completedAt) meta.push(`<span>Done: ${escapeHTML(fmtDate(t.completedAt))}</span>`);
    meta.push(`<span>Elapsed: ${elapsedWithIndicator}</span>`);
    if (t.estimateMs) meta.push(`<span>Estimate: <span class="mono">${escapeHTML(fmtHMS(t.estimateMs))}</span></span>`);
    if ((t.tags||[]).length) meta.push(`<span>${t.tags.slice(0,4).map(x => `<span class="tag">#${escapeHTML(x)}</span>`).join(' ')}</span>`);

    const canStart = t.status !== 'done' && t.status !== 'active';
    const canStop = t.status === 'active';
    const canDone = t.status !== 'done';

    const links = [];
    if (t.taskLink) links.push(`<a href="${escapeAttr(t.taskLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-accent); text-decoration: underline;">Task Link</a>`);
    if (t.repoLink) links.push(`<a href="${escapeAttr(t.repoLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-accent); text-decoration: underline;">Repo Link</a>`);

    card.innerHTML = `
      <div class="card-main">
        <div class="titleline"><b title="${escapeAttr(t.title)}">${escapeHTML(t.title)}</b></div>
        <div class="meta">${meta.join(' ')}</div>
        ${t.description ? `<div style="margin-top:.35rem; color: var(--color-muted); font-size: var(--fs-0); white-space: pre-wrap;">${escapeHTML(shorten(t.description, 220))}</div>` : ''}
        ${links.length ? `<div style="margin-top:.35rem; font-size: var(--fs-0); display: flex; gap: var(--space-3); flex-wrap: wrap;">${links.join(' • ')}</div>` : ''}
        <div style="margin-top:.35rem; color: var(--color-muted); font-size: var(--fs-0);">
          <span class="mono">ID: ${escapeHTML(t.id)}</span>
          ${t.noteIds?.length ? ` • Linked notes: ${t.noteIds.length}` : ''}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn" type="button" data-action="editTask">Edit</button>
        <button class="btn primary" type="button" data-action="startTask" ${canStart ? '' : 'disabled'}>Start</button>
        <button class="btn" type="button" data-action="stopTask" ${canStop ? '' : 'disabled'}>Stop</button>
        <button class="btn" type="button" data-action="completeTask" ${canDone ? '' : 'disabled'}>Complete</button>
      </div>
    `;
    return card;
  }

  function renderNotes(){
    el.panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `
      <div>
        <h1>Notes</h1>
        <p>Group by category → subcategory. Store steps, commands, and checklists.</p>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Note actions">
        <button class="btn primary" type="button" data-action="openAddNote">+ Add note</button>
      </div>
    `;
    el.panel.appendChild(head);

    const notes = state.notes.filter(matchesQuery).slice().sort(byUpdatedDesc);

    if (notes.length === 0){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `<b>No notes yet.</b><div style="margin-top:.35rem;">Add process steps like pre-commit checks or terminal commands.</div>`;
      el.panel.appendChild(empty);
      return;
    }

    const groups = new Map();
    for (const n of notes){
      const cat = n.category?.trim() || 'Uncategorized';
      const sub = n.subcategory?.trim() || 'General';
      const key = cat + '||' + sub;
      if (!groups.has(key)) groups.set(key, { cat, sub, items: [] });
      groups.get(key).items.push(n);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'split';

    for (const g of groups.values()){
      const group = document.createElement('section');
      group.className = 'group';
      group.innerHTML = `
        <div class="group-head">
          <div>
            <b>${escapeHTML(g.cat)}</b>
            <div style="color: var(--color-muted); font-size: var(--fs-0); margin-top:.2rem;">
              ${escapeHTML(g.sub)} • ${g.items.length} note(s)
            </div>
          </div>
          <button class="btn" type="button" data-action="openAddNote" data-prefill-cat="${escapeAttr(g.cat)}" data-prefill-sub="${escapeAttr(g.sub)}">+ Note</button>
        </div>
        <div class="group-body"></div>
      `;
      const body = group.querySelector('.group-body');

      for (const n of g.items){
        const card = document.createElement('article');
        card.className = 'card';
        card.dataset.kind = 'note';
        card.dataset.id = n.id;

        const tags = (n.tags||[]).slice(0,4).map(x => `<span class="tag">#${escapeHTML(x)}</span>`).join(' ');
        const linked = (n.linkedTaskIds||[]).length ? `<span class="tag">${(n.linkedTaskIds||[]).length} linked task(s)</span>` : '';
        card.innerHTML = `
          <div class="card-main">
            <div class="titleline"><b title="${escapeAttr(n.title)}">${escapeHTML(n.title)}</b></div>
            <div class="meta">
              <span>Updated: ${escapeHTML(fmtDate(n.updatedAt))}</span>
              ${linked}
              ${tags ? `<span>${tags}</span>` : ''}
              <span class="mono">ID: ${escapeHTML(n.id)}</span>
            </div>
            ${n.body ? `<div class="codeblock mono" style="white-space: pre-wrap;">${escapeHTML(shorten(n.body, 420))}</div>` : ''}
          </div>
          <div class="card-actions">
            <button class="btn" type="button" data-action="copyNote">Copy</button>
            <button class="btn" type="button" data-action="editNote">Edit</button>
          </div>
        `;
        body.appendChild(card);
      }

      wrapper.appendChild(group);
    }

    el.panel.appendChild(wrapper);
  }

  function renderIdeas(){
    el.panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `
      <div>
        <h1>Ideas</h1>
        <p>Capture side projects and keep a "next step" so they stay alive.</p>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Idea actions">
        <button class="btn primary" type="button" data-action="openAddIdea">+ Add idea</button>
      </div>
    `;
    el.panel.appendChild(head);

    const ideas = state.ideas.filter(matchesQuery).slice().sort(byUpdatedDesc);

    if (ideas.length === 0){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `<b>No ideas yet.</b><div style="margin-top:.35rem;">Add "network log explorer", "devtools", etc.</div>`;
      el.panel.appendChild(empty);
      return;
    }

    const statuses = ['seed','researching','building','shipped'];
    const buckets = new Map(statuses.map(s => [s, []]));
    for (const i of ideas){
      const st = statuses.includes(i.status) ? i.status : 'seed';
      buckets.get(st).push(i);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'split';

    for (const st of statuses){
      const items = buckets.get(st);
      if (!items.length) continue;

      const group = document.createElement('section');
      group.className = 'group';
      group.innerHTML = `
        <div class="group-head">
          <div>
            <b>${escapeHTML(titleCase(st))}</b>
            <div style="color: var(--color-muted); font-size: var(--fs-0); margin-top:.2rem;">
              ${items.length} idea(s)
            </div>
          </div>
          <button class="btn" type="button" data-action="openAddIdea" data-prefill-status="${escapeAttr(st)}">+ Idea</button>
        </div>
        <div class="group-body"></div>
      `;
      const body = group.querySelector('.group-body');

      for (const i of items){
        const card = document.createElement('article');
        card.className = 'card';
        card.dataset.kind = 'idea';
        card.dataset.id = i.id;

        const tags = (i.tags||[]).slice(0,4).map(x => `<span class="tag">#${escapeHTML(x)}</span>`).join(' ');
        const links = (i.links||[]).slice(0,2).map(x => `<span class="tag">${escapeHTML(x)}</span>`).join(' ');

        card.innerHTML = `
          <div class="card-main">
            <div class="titleline"><b title="${escapeAttr(i.title)}">${escapeHTML(i.title)}</b></div>
            <div class="meta">
              <span>Updated: ${escapeHTML(fmtDate(i.updatedAt))}</span>
              ${i.nextStep ? `<span class="tag">Next: ${escapeHTML(shorten(i.nextStep, 60))}</span>` : ''}
              ${tags ? `<span>${tags}</span>` : ''}
              ${links ? `<span>${links}</span>` : ''}
              <span class="mono">ID: ${escapeHTML(i.id)}</span>
            </div>
            ${i.problem ? `<div style="margin-top:.25rem; color: var(--color-muted); font-size: var(--fs-0); white-space: pre-wrap;">${escapeHTML(shorten(i.problem, 220))}</div>` : ''}
          </div>
          <div class="card-actions">
            <button class="btn" type="button" data-action="editIdea">Edit</button>
          </div>
        `;
        body.appendChild(card);
      }

      wrapper.appendChild(group);
    }

    el.panel.appendChild(wrapper);
  }

  function renderSettings(){
    el.panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `
      <div>
        <h1>Settings</h1>
        <p>Controls that affect how time tracking behaves.</p>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Settings actions">
        <button class="btn danger" type="button" data-action="resetAll">Reset all data</button>
      </div>
    `;
    el.panel.appendChild(head);

    const wrap = document.createElement('div');
    wrap.className = 'list';

    wrap.appendChild(settingToggleCard(
      'One active task at a time (WIP limit)',
      'When enabled, starting a task automatically pauses any other active task.',
      'oneActiveTask'
    ));

    wrap.appendChild(settingToggleCard(
      'Auto-stop when completing a task',
      'If a task is active and you mark it complete, the timer will stop first.',
      'autoStopOnComplete'
    ));

    const help = document.createElement('div');
    help.className = 'empty';
    help.innerHTML = `
      <b>Tips</b>
      <ul style="margin: .6rem 0 0; padding-left: 1.1rem;">
        <li>Press <span class="kbd">/</span> to focus Search.</li>
        <li>Use Export/Import to back up your data as JSON.</li>
        <li>All content is stored locally in your browser (IndexedDB).</li>
      </ul>
    `;
    wrap.appendChild(help);

    el.panel.appendChild(wrap);
  }

  function settingToggleCard(title, desc, key){
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-main">
        <div class="titleline"><b>${escapeHTML(title)}</b></div>
        <div style="color: var(--color-muted); font-size: var(--fs-0); margin-top:.25rem;">${escapeHTML(desc)}</div>
      </div>
      <div class="card-actions">
        <label class="sr-only" for="toggle-${escapeAttr(key)}">${escapeHTML(title)}</label>
        <select id="toggle-${escapeAttr(key)}" data-setting="${escapeAttr(key)}">
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
    `;
    const sel = card.querySelector('select');
    sel.value = state.settings[key] ? 'on' : 'off';
    sel.addEventListener('change', async (e) => {
      const k = e.target.dataset.setting;
      state.settings[k] = (e.target.value === 'on');
      await idb.setMeta('settings', { ...state.settings });
      announce(`${title}: ${state.settings[k] ? 'On' : 'Off'}`);
    }, { passive:true });
    return card;
  }

  function openDialog(dlg){
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector('input, textarea, select, button');
    if (first) first.focus();
  }
  function closeDialog(dlg){ if (dlg.open) dlg.close(); }

  function fillForm(form, data){
    for (const [k,v] of Object.entries(data || {})){
      const el = form.elements.namedItem(k);
      if (!el) continue;
      el.value = Array.isArray(v) ? v.join(', ') : (v ?? '');
    }
  }

  // Tasks
  async function upsertTaskFromForm(){
    const fd = new FormData(el.formTask);
    const id = fd.get('id') || null;
    const existing = id ? state.tasks.find(t => t.id === id) : null;

    const estimateInput = fd.get('estimate') || '';
    const estimateMs = estimateInput ? parseTimeEstimate(estimateInput) : null;

    const t = normalizeTask({
      id: existing?.id || uid(),
      createdAt: existing?.createdAt || now(),
      completedAt: existing?.completedAt || null,
      status: existing?.status || 'todo',
      activeSince: existing?.activeSince || null,
      elapsedMs: existing?.elapsedMs || 0,
      sessions: existing?.sessions || [],
      noteIds: existing?.noteIds || [],
      title: fd.get('title'),
      description: fd.get('description'),
      category: fd.get('category'),
      subcategory: fd.get('subcategory'),
      tags: parseTags(fd.get('tags') || ''),
      taskLink: fd.get('taskLink'),
      repoLink: fd.get('repoLink'),
      estimateMs
    });

    await idb.put('tasks', t);
    await refreshAll();
    announce(existing ? 'Task updated' : 'Task added');
  }

  async function deleteTask(id){
    const t = state.tasks.find(x => x.id === id);
    if (t && t.status === 'active') await stopTask(id, { silent:true });

    await idb.del('tasks', id);

    for (const n of state.notes){
      if ((n.linkedTaskIds||[]).includes(id)){
        n.linkedTaskIds = (n.linkedTaskIds||[]).filter(x => x !== id);
        n.updatedAt = now();
        await idb.put('notes', n);
      }
    }
    await refreshAll();
    announce('Task deleted');
  }

  async function startTask(id){
    const t = state.tasks.find(x => x.id === id);
    if (!t || t.status === 'done') return;

    if (state.settings.oneActiveTask){
      const others = state.tasks.filter(x => x.status === 'active' && x.id !== id);
      for (const o of others) await stopTask(o.id, { silent:true });
    }

    if (t.status === 'active') return;

    t.status = 'active';
    t.activeSince = now();
    t.sessions = Array.isArray(t.sessions) ? t.sessions : [];
    t.sessions.push({ start: t.activeSince, end: null });

    await idb.put('tasks', t);
    await refreshAll();
    announce('Task started');
  }

  async function stopTask(id, { silent=false } = {}){
    const t = state.tasks.find(x => x.id === id);
    if (!t || t.status !== 'active' || !t.activeSince) return;

    const end = now();
    t.elapsedMs = (t.elapsedMs || 0) + (end - t.activeSince);
    t.activeSince = null;
    t.status = 'paused';

    const last = t.sessions && t.sessions.length ? t.sessions[t.sessions.length-1] : null;
    if (last && last.end == null) last.end = end;

    await idb.put('tasks', t);
    await refreshAll({ keepScroll:true });
    if (!silent) announce('Task stopped');
  }

  async function completeTask(id){
    const t = state.tasks.find(x => x.id === id);
    if (!t || t.status === 'done') return;

    if (state.settings.autoStopOnComplete && t.status === 'active'){
      await stopTask(id, { silent:true });
    }
    const fresh = state.tasks.find(x => x.id === id) || t;
    fresh.status = 'done';
    fresh.completedAt = now();
    fresh.activeSince = null;

    await idb.put('tasks', fresh);
    await refreshAll();
    announce('Task completed');
  }

  function openEditTask(id){
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;

    $('#dlgTaskTitle').textContent = 'Edit task';
    el.btnDeleteTask.style.display = '';
    fillForm(el.formTask, {
      id: t.id,
      title: t.title,
      tags: (t.tags||[]).join(', '),
      category: t.category,
      subcategory: t.subcategory,
      description: t.description,
      taskLink: t.taskLink,
      repoLink: t.repoLink,
      estimate: t.estimateMs ? fmtTimeEstimate(t.estimateMs) : ''
    });
    openDialog(el.dlgTask);
  }

  function openAddTask(){
    $('#dlgTaskTitle').textContent = 'Add task';
    el.btnDeleteTask.style.display = 'none';
    el.formTask.reset();
    el.formTask.elements.namedItem('id').value = '';
    openDialog(el.dlgTask);
  }

  // Notes
  async function upsertNoteFromForm(){
    const fd = new FormData(el.formNote);
    const id = fd.get('id') || null;
    const existing = id ? state.notes.find(n => n.id === id) : null;

    const note = normalizeNote({
      id: existing?.id || uid(),
      createdAt: existing?.createdAt || now(),
      title: fd.get('title'),
      body: fd.get('body'),
      category: fd.get('category'),
      subcategory: fd.get('subcategory'),
      tags: parseTags(fd.get('tags') || ''),
      linkedTaskIds: fd.get('linkedTaskIds') || ''
    });

    await idb.put('notes', note);

    for (const tid of note.linkedTaskIds || []){
      const t = state.tasks.find(x => x.id === tid);
      if (!t) continue;
      t.noteIds = Array.isArray(t.noteIds) ? t.noteIds : [];
      if (!t.noteIds.includes(note.id)) t.noteIds.push(note.id);
      await idb.put('tasks', t);
    }

    await refreshAll();
    announce(existing ? 'Note updated' : 'Note added');
  }

  async function deleteNote(id){
    await idb.del('notes', id);
    for (const t of state.tasks){
      if ((t.noteIds||[]).includes(id)){
        t.noteIds = (t.noteIds||[]).filter(x => x !== id);
        await idb.put('tasks', t);
      }
    }
    await refreshAll();
    announce('Note deleted');
  }

  function openEditNote(id){
    const n = state.notes.find(x => x.id === id);
    if (!n) return;
    $('#dlgNoteTitle').textContent = 'Edit note';
    el.btnDeleteNote.style.display = '';
    fillForm(el.formNote, {
      id: n.id,
      title: n.title,
      tags: (n.tags||[]).join(', '),
      category: n.category,
      subcategory: n.subcategory,
      body: n.body,
      linkedTaskIds: (n.linkedTaskIds||[]).join(', ')
    });
    openDialog(el.dlgNote);
  }

  function openAddNote(prefill = {}){
    $('#dlgNoteTitle').textContent = 'Add note';
    el.btnDeleteNote.style.display = 'none';
    el.formNote.reset();
    el.formNote.elements.namedItem('id').value = '';
    fillForm(el.formNote, prefill);
    openDialog(el.dlgNote);
  }

  async function copyNoteText(id){
    const n = state.notes.find(x => x.id === id);
    if (!n) return;
    const txt = `${n.title}\n\n${n.body || ''}`.trim();
    try{
      await navigator.clipboard.writeText(txt);
      announce('Note copied to clipboard');
    }catch{
      window.prompt('Copy note:', txt);
    }
  }

  // Ideas
  async function upsertIdeaFromForm(){
    const fd = new FormData(el.formIdea);
    const id = fd.get('id') || null;
    const existing = id ? state.ideas.find(i => i.id === id) : null;

    const idea = normalizeIdea({
      id: existing?.id || uid(),
      createdAt: existing?.createdAt || now(),
      title: fd.get('title'),
      status: fd.get('status'),
      tags: parseTags(fd.get('tags') || ''),
      links: fd.get('links') || '',
      problem: fd.get('problem'),
      approach: fd.get('approach'),
      nextStep: fd.get('nextStep')
    });

    await idb.put('ideas', idea);
    await refreshAll();
    announce(existing ? 'Idea updated' : 'Idea added');
  }

  async function deleteIdea(id){
    await idb.del('ideas', id);
    await refreshAll();
    announce('Idea deleted');
  }

  function openEditIdea(id){
    const i = state.ideas.find(x => x.id === id);
    if (!i) return;
    $('#dlgIdeaTitle').textContent = 'Edit idea';
    el.btnDeleteIdea.style.display = '';
    fillForm(el.formIdea, {
      id: i.id,
      title: i.title,
      status: i.status,
      tags: (i.tags||[]).join(', '),
      links: (i.links||[]).join(', '),
      problem: i.problem,
      approach: i.approach,
      nextStep: i.nextStep
    });
    openDialog(el.dlgIdea);
  }

  function openAddIdea(prefill = {}){
    $('#dlgIdeaTitle').textContent = 'Add idea';
    el.btnDeleteIdea.style.display = 'none';
    el.formIdea.reset();
    el.formIdea.elements.namedItem('id').value = '';
    fillForm(el.formIdea, prefill);
    openDialog(el.dlgIdea);
  }

  // Export / Import
  async function exportData(){
    const payload = { version: 1, exportedAt: now(), settings: state.settings, tasks: state.tasks, notes: state.notes, ideas: state.ideas };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dev-task-hub-export-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    announce('Export started');
  }

  async function importData(file){
    const text = await file.text();
    let data = null;
    try{ data = JSON.parse(text); } catch { announce('Import failed: invalid JSON'); return; }

    const tasks = Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [];
    const notes = Array.isArray(data.notes) ? data.notes.map(normalizeNote) : [];
    const ideas = Array.isArray(data.ideas) ? data.ideas.map(normalizeIdea) : [];
    const settings = data.settings && typeof data.settings === 'object' ? {
      oneActiveTask: !!data.settings.oneActiveTask,
      autoStopOnComplete: !!data.settings.autoStopOnComplete,
    } : state.settings;

    await idb.clear('tasks'); await idb.clear('notes'); await idb.clear('ideas');
    for (const t of tasks) await idb.put('tasks', t);
    for (const n of notes) await idb.put('notes', n);
    for (const i of ideas) await idb.put('ideas', i);

    state.settings = settings;
    await idb.setMeta('settings', { ...settings });

    await refreshAll();
    announce('Import complete');
  }

  async function refreshAll({ keepScroll=false } = {}){
    const y = keepScroll ? window.scrollY : 0;
    state.tasks = (await idb.getAll('tasks')).map(normalizeTask);
    state.notes = (await idb.getAll('notes')).map(normalizeNote);
    state.ideas = (await idb.getAll('ideas')).map(normalizeIdea);
    const s = await idb.getMeta('settings');
    if (s) state.settings = { oneActiveTask: !!s.oneActiveTask, autoStopOnComplete: !!s.autoStopOnComplete };
    render();
    if (keepScroll) window.scrollTo({ top: y, left: 0, behavior:'instant' });
  }

  function startTicker(){
    if (state._interval) return;
    state._interval = setInterval(() => {
      if (!state.tasks.some(t => t.status === 'active')) return;
      const activeById = new Map(state.tasks.filter(t => t.status === 'active').map(t => [t.id, t]));
      const cards = $$('.card[data-kind="task"]', el.panel);
      for (const c of cards){
        const id = c.dataset.id;
        const t = activeById.get(id);
        if (!t) continue;
        const elapsed = currentElapsed(t);
        const span = c.querySelector('[data-elapsed="1"]');
        if (span) {
          span.textContent = fmtHMS(elapsed);
          // Update indicator if present (indicator dot is next sibling)
          const indicatorDot = span.nextElementSibling;
          if (indicatorDot && indicatorDot.tagName === 'SPAN' && indicatorDot.hasAttribute('title') && t.estimateMs) {
            const indicator = getTimeIndicator(elapsed, t.estimateMs);
            if (indicator) {
              indicatorDot.style.background = indicator.color;
              indicatorDot.setAttribute('title', indicator.label);
              indicatorDot.setAttribute('aria-label', indicator.label);
            }
          }
        }
      }
    }, state.tickMs);
  }

  // Delegated events
  function bindEvents(){
    $$('.navbtn').forEach(btn => btn.addEventListener('click', () => setNav(btn.dataset.view), { passive:true }));

    el.btnAddTask.addEventListener('click', openAddTask);
    el.btnAddNote.addEventListener('click', () => openAddNote());
    el.btnAddIdea.addEventListener('click', () => openAddIdea());

    el.btnExport.addEventListener('click', exportData);
    el.btnImport.addEventListener('click', () => el.fileImport.click());
    el.fileImport.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      await importData(f);
    });

    el.panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === 'openAddTask') return openAddTask();
      if (action === 'openAddNote') {
        const pre = { category: btn.dataset.prefillCat || '', subcategory: btn.dataset.prefillSub || '' };
        return openAddNote(pre);
      }
      if (action === 'openAddIdea') {
        const pre = { status: btn.dataset.prefillStatus || 'seed' };
        return openAddIdea(pre);
      }

      if (action === 'resetAll'){
        const ok = confirm('Reset all data? This cannot be undone.');
        if (!ok) return;
        await idb.clear('tasks'); await idb.clear('notes'); await idb.clear('ideas');
        await refreshAll();
        announce('All data reset');
        return;
      }

      const card = e.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;

      if (action === 'editTask') return openEditTask(id);
      if (action === 'startTask') return startTask(id);
      if (action === 'stopTask') return stopTask(id);
      if (action === 'completeTask') return completeTask(id);

      if (action === 'editNote') return openEditNote(id);
      if (action === 'copyNote') return copyNoteText(id);

      if (action === 'editIdea') return openEditIdea(id);
    });

    el.formTask.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitter = e.submitter;
      if (submitter && submitter.value === 'cancel'){ closeDialog(el.dlgTask); return; }
      await upsertTaskFromForm();
      closeDialog(el.dlgTask);
    });
    el.btnDeleteTask.addEventListener('click', async () => {
      const id = el.formTask.elements.namedItem('id').value;
      if (!id) return;
      if (!confirm('Delete this task?')) return;
      await deleteTask(id);
      closeDialog(el.dlgTask);
    });
    el.btnCancelTask.addEventListener('click', () => {
      closeDialog(el.dlgTask);
    });

    el.formNote.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitter = e.submitter;
      if (submitter && submitter.value === 'cancel'){ closeDialog(el.dlgNote); return; }
      await upsertNoteFromForm();
      closeDialog(el.dlgNote);
    });
    el.btnDeleteNote.addEventListener('click', async () => {
      const id = el.formNote.elements.namedItem('id').value;
      if (!id) return;
      if (!confirm('Delete this note?')) return;
      await deleteNote(id);
      closeDialog(el.dlgNote);
    });
    el.btnCancelNote.addEventListener('click', () => {
      closeDialog(el.dlgNote);
    });

    el.formIdea.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitter = e.submitter;
      if (submitter && submitter.value === 'cancel'){ closeDialog(el.dlgIdea); return; }
      await upsertIdeaFromForm();
      closeDialog(el.dlgIdea);
    });
    el.btnDeleteIdea.addEventListener('click', async () => {
      const id = el.formIdea.elements.namedItem('id').value;
      if (!id) return;
      if (!confirm('Delete this idea?')) return;
      await deleteIdea(id);
      closeDialog(el.dlgIdea);
    });
    el.btnCancelIdea.addEventListener('click', () => {
      closeDialog(el.dlgIdea);
    });

    el.q.addEventListener('input', () => { state.q = el.q.value; render(); }, { passive:true });

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey){
        const t = e.target;
        const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (!inField){ e.preventDefault(); el.q.focus(); }
      }
      if (e.key === 'Escape'){
        const openDlg = $('dialog[open]');
        if (openDlg){
          closeDialog(openDlg);
          return;
        }
        if (state.q){
          state.q = ''; el.q.value = ''; render(); announce('Search cleared');
        }
      }
    });
  }

  async function boot(){
    try{
      await idb.init();
      await refreshAll();
      bindEvents();
      startTicker();
    }catch(err){
      console.error(err);
      el.panel.innerHTML = `
        <div class="empty">
          <b>Could not initialize storage.</b>
          <div style="margin-top:.35rem;">Your browser may block IndexedDB in this context.</div>
          <div style="margin-top:.6rem; font-size: var(--fs-0); color: var(--color-muted);">
            Try opening this file from a local folder in a modern browser.
          </div>
        </div>
      `;
    }
  }

  boot();
})();

