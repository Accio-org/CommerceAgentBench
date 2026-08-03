class AdminApp {
  constructor() {
    this.currentEntity = 'dashboard';
    this.state = null;
    this.workers = [];
    this._modalSaveHandler = null;

    this._bindNav();
    this._bindResetAll();
    this._bindModals();
    this._bindHamburger();
    this.navigate('dashboard');
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  _bindNav() {
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const entity = item.dataset.entity;
        if (entity) this.navigate(entity);
        // close sidebar on mobile
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('active');
      });
    });
  }

  _bindHamburger() {
    const btn = document.getElementById('hamburger-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (btn) {
      btn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });
    }
  }

  _bindResetAll() {
    const btn = document.getElementById('btn-reset-all');
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!confirm('Reset ALL mock data to seed defaults? This cannot be undone.')) return;
        try {
          await this.resetAll();
          this.showToast('All data reset to defaults', 'success');
          this.navigate(this.currentEntity);
        } catch (err) {
          this.showToast('Reset failed: ' + err.message, 'error');
        }
      });
    }
  }

  _bindModals() {
    // Edit/create modal
    const backdrop = document.getElementById('modal-backdrop');
    const closeBtn = document.getElementById('modal-close');
    const cancelBtn = document.getElementById('modal-cancel');
    const close = () => { backdrop.classList.remove('active'); };
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    // Logs modal
    const logsBackdrop = document.getElementById('logs-modal-backdrop');
    const logsClose = document.getElementById('logs-modal-close');
    const logsDone = document.getElementById('logs-modal-done');
    const closeLogs = () => { logsBackdrop.classList.remove('active'); };
    logsClose.addEventListener('click', closeLogs);
    logsDone.addEventListener('click', closeLogs);
    logsBackdrop.addEventListener('click', (e) => { if (e.target === logsBackdrop) closeLogs(); });
  }

  async navigate(entityType) {
    this.currentEntity = entityType;

    // Update sidebar active state
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.toggle('active', item.dataset.entity === entityType);
    });

    const main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading">Loading...</div>';

    try {
      if (entityType === 'dashboard') {
        await this._loadDashboard();
      } else if (entityType === 'account') {
        await this._loadAccount();
      } else if (entityType === 'events') {
        await this._loadEvents();
      } else {
        await this._loadEntityList(entityType);
      }
    } catch (err) {
      main.innerHTML = '<div class="table-empty">Error loading data: ' + this._esc(err.message) + '</div>';
      this.showToast('Failed to load: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // API calls
  // ---------------------------------------------------------------------------

  async _fetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async fetchState() {
    return this._fetch('/api/state');
  }

  async resetAll() {
    return this._fetch('/api/state/reset', { method: 'POST' });
  }

  async _loadWorkers() {
    const data = await this._fetch('/api/workers');
    this.workers = data.results || [];
    return this.workers;
  }

  // Load sub-entities for all workers and merge
  async _loadWorkerSubEntities(subPath, entityType) {
    if (!this.workers.length) await this._loadWorkers();
    const all = [];
    for (const w of this.workers) {
      try {
        const data = await this._fetch(`/api/workers/${w.id}/${subPath}`);
        const items = data.results || [];
        items.forEach(item => { item._workerName = w.name; item._workerId = w.id; });
        all.push(...items);
      } catch { /* skip workers that error */ }
    }
    return all;
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async _loadDashboard() {
    const state = await this.fetchState();
    this.state = state;
    const entities = state.entities || {};
    const events = state.events || [];

    const count = (type) => {
      const c = entities[type];
      if (!c) return 0;
      return Array.isArray(c) ? c.length : Object.keys(c).length;
    };

    const main = document.getElementById('main-content');
    main.innerHTML = '';

    // Cards
    const cardsHtml = `
      <div class="content-header"><h2>Dashboard</h2></div>
      <div class="dashboard-cards">
        <div class="dash-card">
          <div class="dash-card-label">Workers</div>
          <div class="dash-card-value">${count('workers')}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-label">Pages</div>
          <div class="dash-card-value">${count('pages')}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-label">Files</div>
          <div class="dash-card-value">${count('files')}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-label">Runs</div>
          <div class="dash-card-value">${count('runs')}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-label">Events</div>
          <div class="dash-card-value">${events.length}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-label">Server</div>
          <div class="dash-card-value" style="font-size:16px;color:#059669;">Online</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-label">Account</div>
          <div class="dash-card-value" style="font-size:16px;color:${state.account?.isLoggedIn ? '#059669' : '#dc2626'};">
            ${state.account?.isLoggedIn ? 'Logged In' : 'Logged Out'}
          </div>
          <div class="dash-card-sub">${this._esc(state.account?.email || '')}</div>
        </div>
      </div>
    `;

    // Recent events
    const recent = events.slice(-10).reverse();
    let eventsHtml = '<div class="events-section"><h3>Recent Events</h3><div class="table-container">';
    if (recent.length === 0) {
      eventsHtml += '<div class="table-empty">No events recorded yet.</div>';
    } else {
      recent.forEach(evt => {
        eventsHtml += `
          <div class="event-item">
            <span class="event-time">${this._formatTime(evt.timestamp)}</span>
            <span class="event-action">${this._esc(evt.action)}</span>
            <span class="event-entity">${this._esc(evt.entityType)}:${this._esc(evt.entityId)}</span>
          </div>`;
      });
    }
    eventsHtml += '</div></div>';

    main.innerHTML = cardsHtml + eventsHtml;
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  async _loadAccount() {
    const account = await this._fetch('/api/account');
    const main = document.getElementById('main-content');

    const fields = [
      ['User ID', account.userId],
      ['Name', account.name],
      ['Email', account.email],
      ['Workspace', account.workspaceName],
      ['Workspace ID', account.workspaceId],
      ['Auth Method', account.authMethod],
      ['Status', account.isLoggedIn ? 'Logged In' : 'Logged Out'],
      ['Login Time', account.loginTime ? this._formatDate(account.loginTime) : '--'],
    ];

    let html = `
      <div class="content-header">
        <h2>Account</h2>
        <div class="content-header-actions">
          <button class="btn ${account.isLoggedIn ? 'btn-danger' : 'btn-primary'}" id="btn-toggle-login">
            ${account.isLoggedIn ? 'Logout' : 'Login'}
          </button>
          <button class="btn btn-outline" id="btn-refresh-account">Refresh</button>
        </div>
      </div>
      <div class="account-card">`;

    fields.forEach(([label, value]) => {
      html += `
        <div class="account-field">
          <div class="account-field-label">${label}</div>
          <div class="account-field-value">${this._esc(String(value ?? ''))}</div>
        </div>`;
    });

    html += '</div>';
    main.innerHTML = html;

    document.getElementById('btn-toggle-login').addEventListener('click', async () => {
      try {
        if (account.isLoggedIn) {
          await this._fetch('/api/account/logout', { method: 'POST' });
          this.showToast('Logged out', 'success');
        } else {
          await this._fetch('/api/account/login', { method: 'POST' });
          this.showToast('Logged in', 'success');
        }
        this.navigate('account');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-refresh-account').addEventListener('click', () => this.navigate('account'));
  }

  // ---------------------------------------------------------------------------
  // Events (full list)
  // ---------------------------------------------------------------------------

  async _loadEvents() {
    const state = await this.fetchState();
    const events = (state.events || []).slice().reverse();

    const columns = [
      { key: 'timestamp', label: 'Timestamp', render: v => this._formatDate(v) },
      { key: 'action', label: 'Action' },
      { key: 'entityType', label: 'Entity Type' },
      { key: 'entityId', label: 'Entity ID', render: v => `<code>${this._esc(v)}</code>` },
    ];

    this._renderEntityPage('Events', events, columns, {
      entityType: 'events',
      canAdd: false,
      canDelete: false,
      canEdit: false,
      canRefresh: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Entity List (generic)
  // ---------------------------------------------------------------------------

  async _loadEntityList(entityType) {
    let data = [];
    let config = this._getEntityConfig(entityType);

    switch (entityType) {
      case 'workers': {
        const res = await this._fetch('/api/workers');
        data = res.results || [];
        break;
      }
      case 'capabilities':
        data = await this._loadWorkerSubEntities('capabilities', entityType);
        break;
      case 'envVars':
        data = await this._loadWorkerSubEntities('env', entityType);
        break;
      case 'syncs':
        data = await this._loadWorkerSubEntities('syncs', entityType);
        break;
      case 'oauthTokens': {
        if (!this.workers.length) await this._loadWorkers();
        const all = [];
        for (const w of this.workers) {
          // OAuth tokens need to be loaded per capability
          try {
            const caps = await this._fetch(`/api/workers/${w.id}/capabilities`);
            for (const cap of (caps.results || [])) {
              try {
                const token = await this._fetch(`/api/workers/${w.id}/oauth/${cap.key}/token`);
                token._workerName = w.name;
                token._workerId = w.id;
                all.push(token);
              } catch { /* no token for this capability */ }
            }
          } catch { /* skip */ }
        }
        data = all;
        break;
      }
      case 'runs':
        data = await this._loadWorkerSubEntities('runs', entityType);
        break;
      case 'webhooks':
        data = await this._loadWorkerSubEntities('webhooks', entityType);
        break;
      case 'pages': {
        const res = await this._fetch('/api/pages');
        data = res.results || [];
        break;
      }
      case 'datasources': {
        const res = await this._fetch('/api/datasources');
        data = res.results || [];
        break;
      }
      case 'files': {
        const res = await this._fetch('/api/files');
        data = res.results || [];
        break;
      }
    }

    this._renderEntityPage(config.title, data, config.columns, {
      entityType,
      canAdd: config.canAdd,
      canDelete: config.canDelete,
      canEdit: config.canEdit,
      canRefresh: true,
      editSchema: config.editSchema,
      createSchema: config.createSchema,
    });
  }

  // ---------------------------------------------------------------------------
  // Entity configuration
  // ---------------------------------------------------------------------------

  _getEntityConfig(entityType) {
    const configs = {
      workers: {
        title: 'Workers',
        canAdd: true,
        canDelete: true,
        canEdit: true,
        columns: [
          { key: 'id', label: 'ID', render: v => `<code>${this._esc(v)}</code>` },
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', render: v => this._statusBadge(v) },
          { key: 'deployCount', label: 'Deploys' },
          { key: 'updatedAt', label: 'Updated', render: v => this._formatDate(v) },
        ],
        editSchema: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'status', label: 'Status', type: 'select', options: ['active', 'error', 'paused'] },
        ],
        createSchema: [
          { key: 'name', label: 'Name', type: 'text', required: true },
        ],
      },

      capabilities: {
        title: 'Capabilities',
        canAdd: false,
        canDelete: false,
        canEdit: false,
        columns: [
          { key: 'key', label: 'Key' },
          { key: 'type', label: 'Type', render: v => this._statusBadge(v) },
          { key: '_workerName', label: 'Worker' },
          { key: 'title', label: 'Title' },
          { key: 'description', label: 'Description' },
        ],
      },

      envVars: {
        title: 'Env Variables',
        canAdd: true,
        canDelete: true,
        canEdit: false,
        columns: [
          { key: 'key', label: 'Key', render: v => `<code>${this._esc(v)}</code>` },
          { key: '_workerName', label: 'Worker' },
          { key: 'isSet', label: 'Is Set', render: v => this._statusBadge(String(v)) },
          { key: 'updatedAt', label: 'Updated', render: v => this._formatDate(v) },
        ],
        createSchema: [
          { key: '_workerId', label: 'Worker ID', type: 'workerSelect', required: true },
          { key: 'key', label: 'Key', type: 'text', required: true },
          { key: 'value', label: 'Value', type: 'text', required: true },
        ],
      },

      syncs: {
        title: 'Syncs',
        canAdd: false,
        canDelete: false,
        canEdit: true,
        columns: [
          { key: 'capabilityKey', label: 'Capability' },
          { key: '_workerName', label: 'Worker' },
          { key: 'status', label: 'Status', render: v => this._statusBadge(v) },
          { key: 'runCount', label: 'Runs' },
          { key: 'errorCount', label: 'Errors' },
          { key: 'schedule', label: 'Schedule' },
        ],
        editSchema: [
          { key: 'status', label: 'Status', type: 'select', options: ['running', 'paused', 'idle', 'error'] },
        ],
      },

      oauthTokens: {
        title: 'OAuth Tokens',
        canAdd: false,
        canDelete: false,
        canEdit: false,
        columns: [
          { key: 'capabilityKey', label: 'Capability' },
          { key: '_workerName', label: 'Worker' },
          { key: 'provider', label: 'Provider' },
          { key: 'scopes', label: 'Scopes', render: v => Array.isArray(v) ? v.join(', ') : v },
          { key: 'expiresAt', label: 'Expires', render: v => this._formatDate(v) },
        ],
      },

      runs: {
        title: 'Runs',
        canAdd: false,
        canDelete: false,
        canEdit: false,
        columns: [
          { key: 'id', label: 'ID', render: v => `<code>${this._esc(v)}</code>` },
          { key: 'capabilityKey', label: 'Capability' },
          { key: '_workerName', label: 'Worker' },
          { key: 'status', label: 'Status', render: v => this._statusBadge(v) },
          { key: 'startedAt', label: 'Started', render: v => this._formatDate(v) },
          { key: 'durationMs', label: 'Duration', render: v => v != null ? v + 'ms' : '--' },
        ],
        rowAction: 'viewLogs',
      },

      webhooks: {
        title: 'Webhooks',
        canAdd: false,
        canDelete: false,
        canEdit: false,
        columns: [
          { key: 'capabilityKey', label: 'Capability' },
          { key: '_workerName', label: 'Worker' },
          { key: 'url', label: 'URL' },
          { key: 'createdAt', label: 'Created', render: v => this._formatDate(v) },
        ],
      },

      pages: {
        title: 'Pages',
        canAdd: true,
        canDelete: true,
        canEdit: true,
        columns: [
          { key: 'title', label: 'Title' },
          { key: 'parentType', label: 'Parent Type', render: v => v || '--' },
          { key: 'archived', label: 'Archived', render: v => v ? 'Yes' : 'No' },
          { key: 'updatedAt', label: 'Updated', render: v => this._formatDate(v) },
        ],
        editSchema: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'content', label: 'Content', type: 'textarea' },
          { key: 'parentId', label: 'Parent ID', type: 'text' },
        ],
        createSchema: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'content', label: 'Content', type: 'textarea' },
          { key: 'parent', label: 'Parent (e.g. page:page_root)', type: 'text' },
        ],
      },

      datasources: {
        title: 'Datasources',
        canAdd: false,
        canDelete: false,
        canEdit: false,
        columns: [
          { key: 'title', label: 'Title' },
          { key: 'databaseId', label: 'Database ID', render: v => `<code>${this._esc(v)}</code>` },
          { key: 'pages', label: 'Page Count', render: v => Array.isArray(v) ? v.length : 0 },
          { key: 'createdAt', label: 'Created', render: v => this._formatDate(v) },
        ],
      },

      files: {
        title: 'Files',
        canAdd: true,
        canDelete: false,
        canEdit: false,
        columns: [
          { key: 'filename', label: 'Filename' },
          { key: 'status', label: 'Status', render: v => this._statusBadge(v) },
          { key: 'contentType', label: 'Type' },
          { key: 'contentLength', label: 'Size', render: v => this._formatBytes(v) },
          { key: 'createdAt', label: 'Created', render: v => this._formatDate(v) },
        ],
        createSchema: [
          { key: 'filename', label: 'Filename', type: 'text', required: true },
          { key: 'contentType', label: 'Content Type', type: 'text' },
          { key: 'contentLength', label: 'Size (bytes)', type: 'number' },
        ],
      },
    };

    return configs[entityType] || { title: entityType, columns: [], canAdd: false, canDelete: false, canEdit: false };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  _renderEntityPage(title, data, columns, opts = {}) {
    const main = document.getElementById('main-content');
    let html = '<div class="content-header">';
    html += `<h2>${this._esc(title)}</h2>`;
    html += '<div class="content-header-actions">';
    if (opts.canAdd) {
      html += '<button class="btn btn-primary" id="btn-add-new">Add New</button>';
    }
    if (opts.canRefresh) {
      html += '<button class="btn btn-outline" id="btn-refresh">Refresh</button>';
    }
    html += '</div></div>';

    html += '<div class="table-container">';
    if (data.length === 0) {
      html += '<div class="table-empty">No records found.</div>';
    } else {
      html += '<table class="data-table"><thead><tr>';
      columns.forEach(col => {
        html += `<th>${this._esc(col.label)}</th>`;
      });
      if (opts.canDelete || opts.canEdit || (opts.entityType === 'runs')) {
        html += '<th class="col-actions">Actions</th>';
      }
      html += '</tr></thead><tbody>';

      data.forEach((row, idx) => {
        html += `<tr data-idx="${idx}">`;
        columns.forEach(col => {
          const val = row[col.key];
          const display = col.render ? col.render(val) : this._esc(String(val ?? '--'));
          html += `<td>${display}</td>`;
        });
        if (opts.canDelete || opts.canEdit || (opts.entityType === 'runs')) {
          html += '<td class="col-actions">';
          if (opts.canEdit) {
            html += `<button class="btn btn-primary btn-sm btn-edit" data-idx="${idx}">Edit</button> `;
          }
          if (opts.entityType === 'runs') {
            html += `<button class="btn btn-outline btn-sm btn-logs" data-idx="${idx}">Logs</button> `;
          }
          if (opts.canDelete) {
            html += `<button class="btn btn-danger btn-sm btn-delete" data-idx="${idx}">Delete</button>`;
          }
          html += '</td>';
        }
        html += '</tr>';
      });

      html += '</tbody></table>';
    }
    html += '</div>';

    main.innerHTML = html;

    // Bind events
    if (opts.canRefresh) {
      const refreshBtn = document.getElementById('btn-refresh');
      if (refreshBtn) refreshBtn.addEventListener('click', () => this.navigate(opts.entityType));
    }

    if (opts.canAdd) {
      const addBtn = document.getElementById('btn-add-new');
      if (addBtn) addBtn.addEventListener('click', () => this._showCreateModal(opts.entityType, opts.createSchema || opts.editSchema));
    }

    // Edit buttons
    main.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        this._showEditModal(opts.entityType, data[idx], opts.editSchema);
      });
    });

    // Delete buttons
    main.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        this._handleDelete(opts.entityType, data[idx]);
      });
    });

    // Logs buttons (runs)
    main.querySelectorAll('.btn-logs').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        this._showRunLogs(data[idx]);
      });
    });

    // Row click -> edit (if editable) or view logs (if runs)
    main.querySelectorAll('.data-table tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const idx = parseInt(tr.dataset.idx);
        if (opts.canEdit && opts.editSchema) {
          this._showEditModal(opts.entityType, data[idx], opts.editSchema);
        } else if (opts.entityType === 'runs') {
          this._showRunLogs(data[idx]);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------

  _showEditModal(entityType, entity, schema) {
    if (!schema || !schema.length) return;

    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const saveBtn = document.getElementById('modal-save');
    const backdrop = document.getElementById('modal-backdrop');

    title.textContent = 'Edit ' + this._entityLabel(entityType);

    let html = '';
    schema.forEach(field => {
      html += this._renderFormField(field, entity[field.key]);
    });
    body.innerHTML = html;

    // Remove old save handler, bind new one
    if (this._modalSaveHandler) {
      saveBtn.removeEventListener('click', this._modalSaveHandler);
    }
    this._modalSaveHandler = async () => {
      try {
        await this._saveEntity(entityType, entity, schema, false);
        backdrop.classList.remove('active');
        this.showToast('Updated successfully', 'success');
        this.navigate(entityType);
      } catch (err) {
        this.showToast('Save failed: ' + err.message, 'error');
      }
    };
    saveBtn.addEventListener('click', this._modalSaveHandler);

    backdrop.classList.add('active');
  }

  _showCreateModal(entityType, schema) {
    if (!schema || !schema.length) return;

    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const saveBtn = document.getElementById('modal-save');
    const backdrop = document.getElementById('modal-backdrop');

    title.textContent = 'Add ' + this._entityLabel(entityType);

    let html = '';
    schema.forEach(field => {
      html += this._renderFormField(field, '');
    });
    body.innerHTML = html;

    if (this._modalSaveHandler) {
      saveBtn.removeEventListener('click', this._modalSaveHandler);
    }
    this._modalSaveHandler = async () => {
      try {
        await this._saveEntity(entityType, null, schema, true);
        backdrop.classList.remove('active');
        this.showToast('Created successfully', 'success');
        this.navigate(entityType);
      } catch (err) {
        this.showToast('Create failed: ' + err.message, 'error');
      }
    };
    saveBtn.addEventListener('click', this._modalSaveHandler);

    backdrop.classList.add('active');
  }

  _renderFormField(field, value) {
    const id = 'field-' + field.key;
    let inputHtml = '';

    if (field.type === 'select') {
      inputHtml = `<select class="form-select" id="${id}" data-key="${field.key}">`;
      (field.options || []).forEach(opt => {
        const sel = value === opt ? ' selected' : '';
        inputHtml += `<option value="${this._esc(opt)}"${sel}>${this._esc(opt)}</option>`;
      });
      inputHtml += '</select>';
    } else if (field.type === 'textarea') {
      inputHtml = `<textarea class="form-textarea" id="${id}" data-key="${field.key}" placeholder="${this._esc(field.label)}">${this._esc(String(value ?? ''))}</textarea>`;
    } else if (field.type === 'workerSelect') {
      inputHtml = `<select class="form-select" id="${id}" data-key="${field.key}">`;
      this.workers.forEach(w => {
        inputHtml += `<option value="${this._esc(w.id)}">${this._esc(w.name)} (${this._esc(w.id)})</option>`;
      });
      inputHtml += '</select>';
    } else {
      const inputType = field.type === 'number' ? 'number' : 'text';
      inputHtml = `<input class="form-input" type="${inputType}" id="${id}" data-key="${field.key}" value="${this._esc(String(value ?? ''))}" placeholder="${this._esc(field.label)}"${field.required ? ' required' : ''}>`;
    }

    return `<div class="form-group"><label class="form-label" for="${id}">${this._esc(field.label)}</label>${inputHtml}</div>`;
  }

  async _saveEntity(entityType, existing, schema, isCreate) {
    const formData = {};
    schema.forEach(field => {
      const el = document.getElementById('field-' + field.key);
      if (el) {
        let val = el.value;
        if (field.type === 'number') val = parseInt(val, 10) || 0;
        formData[field.key] = val;
      }
    });

    switch (entityType) {
      case 'workers':
        if (isCreate) {
          await this._fetch('/api/workers', { method: 'POST', body: JSON.stringify({ name: formData.name }) });
        } else {
          await this._fetch(`/api/workers/${existing.id}`, { method: 'PATCH', body: JSON.stringify(formData) });
        }
        break;

      case 'syncs': {
        // Use pause/resume based on desired status
        const desiredStatus = formData.status;
        const wid = existing._workerId || existing.workerId;
        const key = existing.capabilityKey;
        if (desiredStatus === 'paused') {
          await this._fetch(`/api/workers/${wid}/syncs/${key}/pause`, { method: 'POST' });
        } else if (desiredStatus === 'running') {
          await this._fetch(`/api/workers/${wid}/syncs/${key}/resume`, { method: 'POST' });
        }
        break;
      }

      case 'envVars':
        if (isCreate) {
          const wid = formData._workerId;
          await this._fetch(`/api/workers/${wid}/env`, {
            method: 'POST',
            body: JSON.stringify({ vars: [{ key: formData.key, value: formData.value }] }),
          });
        }
        break;

      case 'pages':
        if (isCreate) {
          await this._fetch('/api/pages', {
            method: 'POST',
            body: JSON.stringify({ title: formData.title, content: formData.content, parent: formData.parent || null }),
          });
        } else {
          await this._fetch(`/api/pages/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(formData),
          });
        }
        break;

      case 'files':
        if (isCreate) {
          await this._fetch('/api/files', {
            method: 'POST',
            body: JSON.stringify({
              filename: formData.filename,
              contentType: formData.contentType || 'application/octet-stream',
              contentLength: formData.contentLength || 0,
            }),
          });
        }
        break;

      default:
        throw new Error('Save not supported for ' + entityType);
    }
  }

  async _handleDelete(entityType, entity) {
    const label = entity.name || entity.title || entity.key || entity.id;
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;

    try {
      switch (entityType) {
        case 'workers':
          await this._fetch(`/api/workers/${entity.id}`, { method: 'DELETE' });
          break;
        case 'envVars': {
          const wid = entity._workerId || entity.workerId;
          await this._fetch(`/api/workers/${wid}/env/${entity.key}`, { method: 'DELETE' });
          break;
        }
        case 'pages':
          await this._fetch(`/api/pages/${entity.id}/trash`, { method: 'POST' });
          break;
        default:
          throw new Error('Delete not supported for ' + entityType);
      }
      this.showToast('Deleted successfully', 'success');
      this.navigate(entityType);
    } catch (err) {
      this.showToast('Delete failed: ' + err.message, 'error');
    }
  }

  async _showRunLogs(run) {
    const logsBackdrop = document.getElementById('logs-modal-backdrop');
    const logsTitle = document.getElementById('logs-modal-title');
    const logsBody = document.getElementById('logs-modal-body');

    logsTitle.textContent = `Logs: ${run.id} (${run.capabilityKey})`;

    // Try to load logs from API
    let logs = [];
    try {
      const wid = run._workerId || run.workerId;
      const data = await this._fetch(`/api/workers/${wid}/runs/${run.id}/logs`);
      logs = data.logs || [];
    } catch {
      // Fallback to inline logs if available
      logs = run.logs || [];
    }

    if (logs.length === 0) {
      logsBody.innerHTML = '<div class="table-empty">No logs available.</div>';
    } else {
      let html = '<div class="log-entries">';
      logs.forEach(entry => {
        const levelClass = 'log-level-' + (entry.level || 'info');
        html += `<div class="log-entry">
          <span class="log-time">${this._formatTime(entry.timestamp)}</span>
          <span class="${levelClass}">[${this._esc(entry.level || 'info')}]</span>
          <span class="log-msg">${this._esc(entry.message)}</span>
        </div>`;
      });
      html += '</div>';
      logsBody.innerHTML = html;
    }

    logsBackdrop.classList.add('active');
  }

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _statusBadge(status) {
    if (!status) return '--';
    const cls = 'status-' + String(status).toLowerCase();
    return `<span class="status-badge ${cls}">${this._esc(status)}</span>`;
  }

  _formatDate(iso) {
    if (!iso) return '--';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  _formatTime(iso) {
    if (!iso) return '--';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  }

  _formatBytes(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  _entityLabel(entityType) {
    const labels = {
      workers: 'Worker',
      capabilities: 'Capability',
      envVars: 'Env Variable',
      syncs: 'Sync',
      oauthTokens: 'OAuth Token',
      runs: 'Run',
      webhooks: 'Webhook',
      pages: 'Page',
      datasources: 'Datasource',
      files: 'File',
      events: 'Event',
    };
    return labels[entityType] || entityType;
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.adminApp = new AdminApp();
});
