const state = {
  token: localStorage.getItem('ec-token') || '',
  user: JSON.parse(localStorage.getItem('ec-user') || 'null'),
  editors: [],
  projects: [],
  dashboard: null,
  requests: null,
  pendingPhone: '',
  pendingRole: ''
};

const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const toast = document.getElementById('toast');

function saveSession() {
  if (state.token) {
    localStorage.setItem('ec-token', state.token);
  } else {
    localStorage.removeItem('ec-token');
  }

  if (state.user) {
    localStorage.setItem('ec-user', JSON.stringify(state.user));
  } else {
    localStorage.removeItem('ec-user');
  }
}

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function closeModal() {
  modal.hidden = true;
  modalContent.innerHTML = '';
}

function openModal(content) {
  modalContent.innerHTML = content;
  modal.hidden = false;
}

function setAuthStatus(form, message, type = 'loading') {
  let status = form.querySelector('.auth-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'auth-status';
    form.querySelector('button[type="submit"]')?.after(status);
  }
  status.innerHTML = type === 'loading'
    ? `<span class="inline-spinner" aria-hidden="true"></span>${message}`
    : message;
  status.dataset.type = type;
}

function setFormBusy(form, busy, message) {
  form.querySelectorAll('input, textarea, select, button').forEach((field) => {
    field.disabled = busy;
  });
  if (busy) setAuthStatus(form, message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function needsEditorVerification(user) {
  return user?.role === 'editor' && !user.details?.verification;
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || 10000);
  let raw;
  try {
    raw = await fetch(path, {
      method,
      headers,
      signal: controller.signal,
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request took too long. Please try again.');
    throw new Error('Unable to reach the server. Please check your connection and try again.');
  } finally {
    window.clearTimeout(timeout);
  }

  const data = await raw.json().catch(() => ({}));
  if (!raw.ok) {
    throw new Error(data.message || 'Something went wrong.');
  }
  return data;
}

function formatPhone(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 15);
}

const revealObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -60px 0px' })
  : null;

function observeReveals(root = document) {
  const nodes = root.querySelectorAll('.reveal:not(.visible)');
  nodes.forEach((node) => {
    if (!revealObserver) {
      node.classList.add('visible');
      return;
    }
    revealObserver.observe(node);
  });
}

function renderEditors() {
  const grid = document.getElementById('editor-grid');
  if (!grid) return;

  if (!state.editors.length) {
    grid.innerHTML = '<article class="empty-state"><h3>No editors yet</h3><p>Be the first editor to join mesteoz.</p></article>';
    return;
  }

  grid.innerHTML = state.editors.map((editor) => {
    const skills = (editor.skills || []).slice(0, 3).map((skill) => `<span>${skill}</span>`).join('');
    return `
      <article class="editor-card reveal">
        <div class="card-top">
          <div class="avatar avatar-${editor.tone || 'violet'}">${editor.initials || 'MZ'}</div>
          <div>
            <h3>${editor.name}</h3>
            <p>${editor.title || 'Video Editor'}</p>
          </div>
          <span class="rating">${editor.reviews ? `★ ${Number(editor.rating || 0).toFixed(1)}` : 'NEW'}</span>
        </div>
        <div class="tag-row">${skills || '<span>Video editing</span>'}</div>
        <p class="editor-bio">${editor.bio || 'Available for new client briefs.'}</p>
        <div class="card-meta">
          <span>${editor.location || 'Remote'}</span>
          <span>${editor.availability || 'Available now'}</span>
        </div>
        <div class="card-actions">
          <button class="mini-button" data-action="contact-editor" data-editor-id="${editor.id}">Connect</button>
          <span class="price">${Number(editor.price || 0) > 0 ? `From $${Number(editor.price)}` : 'Rate on request'}</span>
        </div>
      </article>
    `;
  }).join('');

  observeReveals(grid);
}

function renderProjects() {
  const list = document.getElementById('project-list');
  if (!list) return;

  if (!state.projects.length) {
    list.innerHTML = '<article class="empty-state"><h3>No open projects</h3><p>Post a project to start matching with video editors.</p></article>';
    return;
  }

  list.innerHTML = state.projects.map((project) => `
    <article class="project-card">
      <div class="project-head">
        <div>
          <span class="tiny-label">${project.category || 'Video Editing'}</span>
          <h3>${project.title}</h3>
        </div>
        <span class="project-budget">${project.budget || 'Flexible'}</span>
      </div>
      <p>${project.description || 'Client project looking for the right editor.'}</p>
      <div class="tag-row">${(project.skills || []).slice(0, 3).map((skill) => `<span>${skill}</span>`).join('') || '<span>Editing</span>'}</div>
      <div class="project-foot">
        <span>${project.client || 'Client'}</span>
        <button class="mini-button" data-action="apply-project" data-project-id="${project.id}">Apply now</button>
      </div>
    </article>
  `).join('');

  observeReveals(list);
}

async function routeAfterAuth(user, popupMessage) {
  if (!user) return;
  showToast(popupMessage || 'Welcome back', 'success');
  const role = user.role === 'editor' ? 'editor' : 'client';
  loadDashboard(role);
  loadRequests();
  document.getElementById('dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  api('/api/connect/auto', { method: 'POST', timeout: 10000 })
    .then(async () => {
      await loadRequests();
      await loadDashboard(role);
    })
    .catch((error) => showToast(error.message || 'Could not refresh your connections.', 'error'));
}

function showConnectionPopup(message, options = {}) {
  openModal(`
    <div class="connect-popup">
      <div class="connect-spinner"></div>
      <div class="tiny-label">AUTO-CONNECT - LIVE</div>
      <h3>${message || 'Connecting...'}</h3>
      <p>${options.detail || 'Matching your profile with the right contact and project fit.'}</p>
      <div class="connect-steps">
        <span>Matching skills, budget and deadline</span>
        <span>Sharing phone number and Instagram handle</span>
        <span>Opening your request tracker</span>
      </div>
    </div>
  `);
}

function showConnectionResult(connection, fallbackName) {
  if (!connection) {
    openModal(`
      <div class="connect-popup">
        <div class="connect-spinner done"></div>
        <div class="tiny-label">SEARCHING</div>
        <h3>Still connecting</h3>
        <p>Nobody matches this request yet. We keep searching in the background and will connect you the second the right account joins.</p>
        <div class="connect-actions">
          <button class="button" data-action="go-dashboard">Track it in my dashboard</button>
          <button class="button button-ghost" data-action="close-modal">Close</button>
        </div>
      </div>
    `);
    return;
  }

  const partner = connection.partner || {};
  const contact = connection.contact || {};
  const connected = connection.status === 'connected' || connection.status === 'accepted';
  const name = partner.name || fallbackName || 'your match';
  openModal(`
    <div class="connect-popup">
      <div class="connect-spinner ${connected ? 'done' : ''}"></div>
      <div class="tiny-label">${connected ? 'CONNECTED' : 'SEARCHING'}</div>
      <h3>${connected ? `Connected with ${name}` : 'Still matching'}</h3>
      <p>${connection.projectTitle ? `Project: ${connection.projectTitle}` : 'Your request is being tracked.'}${connection.score ? ` - ${connection.score}% fit` : ''}</p>
      ${connected ? `
        <div class="contact-row">
          ${contact.phone ? `<a class="contact-chip" href="tel:${contact.phone}">Call ${contact.phone}</a>` : ''}
          ${contact.instagram ? `<a class="contact-chip" href="https://instagram.com/${contact.instagram}" target="_blank" rel="noopener">@${contact.instagram}</a>` : ''}
          ${!contact.phone && !contact.instagram ? '<span class="muted-text">Contact details will appear as soon as they are shared.</span>' : ''}
        </div>
      ` : '<p class="muted-text">We will notify you the moment a match joins the network.</p>'}
      <div class="connect-actions">
        <button class="button" data-action="go-dashboard">Open my dashboard</button>
        <button class="button button-ghost" data-action="close-modal">Close</button>
      </div>
    </div>
  `);
}

async function loadRequests() {
  if (!state.token || !state.user) return;
  const target = document.getElementById('tracker-list') || document.getElementById('dashboard-connections');
  const count = document.getElementById('tracker-count');
  try {
    const response = await api('/api/requests');
    const data = response.data || {};
    state.requests = data;
    const connections = data.connections || [];
    if (count) count.textContent = `${connections.length} request${connections.length === 1 ? '' : 's'}`;
    if (!target) return;
    target.innerHTML = connections.length
      ? connections.map(connectionRow).join('')
      : '<p class="muted-text">No requests to track yet. Post a brief or connect with an editor to start.</p>';
  } catch (error) {
    console.error(error);
  }
}

function connectionRow(item) {
  const partner = item.partner || {};
  const contact = item.contact || {};
  const connected = item.status === 'connected' || item.status === 'accepted';
  const roleLabel = partner.role === 'editor' ? 'Video editor' : 'Client';
  return `
    <div class="tracker-row">
      <div class="avatar avatar-${partner.tone || 'violet'}">${partner.initials || 'MZ'}</div>
      <div class="tracker-info">
        <strong>${partner.name || 'Waiting for a match'}</strong>
        <span>${roleLabel}${item.projectTitle ? ` · ${item.projectTitle}` : ''}${item.score ? ` · ${item.score}% fit` : ''}</span>
        ${connected ? `<span class="tracker-contact">${contact.phone ? `<a href="tel:${contact.phone}">${contact.phone}</a>` : ''}${contact.instagram ? `<a href="https://instagram.com/${contact.instagram}" target="_blank" rel="noopener">@${contact.instagram}</a>` : ''}</span>` : ''}
      </div>
      <span class="status-badge ${item.status || 'searching'}">${item.status || 'searching'}</span>
      ${connected ? `
        <div class="tracker-actions">
          <button class="mini-button" data-action="connection-status" data-connection-id="${item.id}" data-status="accepted">Accept</button>
          <button class="mini-button ghost" data-action="connection-status" data-connection-id="${item.id}" data-status="declined">Decline</button>
        </div>
      ` : ''}
    </div>
  `;
}

async function showNotifications() {
  if (!state.token || !state.user) return openLoginModal();
  try {
    const response = await api('/api/notifications');
    const items = response.data || [];
    openModal(`
      <div class="modal-head"><h2>Your updates</h2><span>${items.length} notification${items.length === 1 ? '' : 's'}</span></div>
      <div class="notification-list">
        ${items.length ? items.map((item) => `
          <div class="notification-item ${item.read ? '' : 'unread'}">
            <strong>${item.title}</strong>
            <p>${item.message}</p>
            <span>${new Date(item.createdAt).toLocaleString()}</span>
          </div>
        `).join('') : '<p class="muted-text">No notifications yet.</p>'}
      </div>
      <div class="connect-actions">
        <button class="button" data-action="mark-read">Mark all as read</button>
        <button class="button button-ghost" data-action="close-modal">Close</button>
      </div>
    `);
  } catch (error) {
    showToast(error.message || 'Could not load notifications.', 'error');
  }
}

function showPhoneLoginForm(name) {
  openModal(`
    <form data-form="phone-login" class="auth-form">
      <div class="modal-head"><h2>Welcome back${name ? `, ${name.split(' ')[0]}` : ''}!</h2><span>Returning member</span></div>
      <p class="muted-text">We found your existing mesteoz account. Confirm your ID and password to continue to your dashboard.</p>
      <label><span>Your ID</span><input name="identity" type="tel" value="${state.pendingPhone}" readonly></label>
      <label><span>Password</span><input name="password" type="password" placeholder="Enter your password" autocomplete="current-password" required></label>
      <button type="submit" class="button">Log in to my dashboard</button>
      <p class="muted-link">Not your number? <button type="button" class="text-button-inline" data-action="signup">Use another number</button></p>
    </form>
  `);
}

function openContactConnectModal() {
  const isEditor = state.user?.role === 'editor';
  openModal(`
    <form data-form="contact-connect" class="auth-form">
      <div class="modal-head"><h2>Auto-connect</h2><span>By phone or Instagram</span></div>
      <p class="muted-text">${isEditor ? 'Enter a client mobile number or Instagram handle and mesteoz links you to their brief instantly.' : 'Enter an editor mobile number or Instagram handle and mesteoz links you to their profile instantly.'}</p>
      <label><span>Mobile number</span><input name="phone" type="tel" placeholder="+91 98765 43210"></label>
      <label><span>Instagram handle</span><input name="instagram" type="text" placeholder="@handle or handle"></label>
      <button type="submit" class="button">${isEditor ? 'Connecting to client' : 'Connecting to video editor'}</button>
    </form>
  `);
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme, persist) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f4f7fc' : '#07080d');

  document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
    const label = next === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', next === 'light' ? 'true' : 'false');
  });

  if (persist) {
    try {
      localStorage.setItem('ec-theme', next);
    } catch (error) {
      console.warn('Theme preference could not be saved.', error);
    }
  }
}

function toggleTheme() {
  applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
}

function initCursorEffect() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const cursor = document.createElement('div');
  cursor.className = 'cursor-glow';
  cursor.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cursor);

  let frame = 0;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  document.addEventListener('pointermove', (event) => {
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--cursor-x', `${x}px`);
      document.documentElement.style.setProperty('--cursor-y', `${y}px`);
      cursor.classList.add('visible');
      frame = 0;
    });
  });

  document.addEventListener('pointerleave', () => cursor.classList.remove('visible'));
}

function initLaunchSplash() {
  const splash = document.getElementById('launch-splash');
  if (!splash) return;

  let finished = false;
  const finish = () => {
    if (finished || !document.body.contains(splash)) return;
    finished = true;
    splash.classList.add('is-finished');
    document.body.classList.remove('is-launching');
    window.setTimeout(() => splash.remove(), 650);
  };

  document.body.classList.add('is-launching');
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    finish();
    return;
  }

  // Keep the reveal independent from animation events so it also works when
  // the browser throttles or skips CSS animations during the initial paint.
  window.setTimeout(finish, 3000);
  window.setTimeout(() => {
    if (document.body.contains(splash)) {
      splash.remove();
      document.body.classList.remove('is-launching');
    }
  }, 3900);
}

function watchSystemTheme() {
  if (!window.matchMedia) return;
  const query = window.matchMedia('(prefers-color-scheme: light)');
  if (!query.addEventListener) return;
  query.addEventListener('change', () => {
    let stored = null;
    try {
      stored = localStorage.getItem('ec-theme');
    } catch (error) {
      stored = null;
    }
    if (!stored) applyTheme(query.matches ? 'light' : 'dark', false);
  });
}

function bindGlobalActions() {
  document.body.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    if (action === 'login') return openLoginModal();
    if (action === 'toggle-theme') return toggleTheme();
    if (action === 'signup') return openSignupFlow();
    if (action === 'editor') return openSignupFlow('editor');
    if (action === 'signup-client') return openSignupFlow('client');
    if (action === 'close-modal') return closeModal();
    if (action === 'logout') {
      state.token = '';
      state.user = null;
      saveSession();
      showToast('You have been signed out.');
      closeModal();
      window.location.reload();
    }
    if (action === 'contact-connect') {
      if (!state.token || !state.user) return openLoginModal();
      return openContactConnectModal();
    }
    if (action === 'contact-editor') {
      const editorId = target.dataset.editorId;
      const editor = state.editors.find((item) => item.id === editorId);
      if (!editor) return;
      if (!state.token || !state.user) {
        openLoginModal();
        return;
      }
      try {
        showConnectionPopup(`Connecting to ${editor.name}`, { detail: 'Comparing your brief with their skills, price and availability.' });
        const response = await api(`/api/connect/editor/${editor.id}`, { method: 'POST' });
        await loadRequests();
        setTimeout(() => showConnectionResult(response.data?.connection || null, editor.name), 1400);
      } catch (error) {
        showToast(error.message || 'Connection failed.', 'error');
        setTimeout(() => closeModal(), 1200);
      }
    }
    if (action === 'apply-project') {
      const projectId = target.dataset.projectId;
      if (!state.token || !state.user) {
        openLoginModal();
        return;
      }
      try {
        await api(`/api/projects/${projectId}/apply`, { method: 'POST' });
        showToast('Application sent successfully.', 'success');
      } catch (error) {
        showToast(error.message || 'Unable to apply.', 'error');
      }
    }
    if (action === 'create-project') {
      if (!state.token || !state.user) {
        openLoginModal();
        return;
      }
      openProjectModal();
    }
    if (action === 'load-more') {
      await loadEditors();
      await loadProjects();
      showToast('Fresh editors and briefs loaded.', 'success');
    }
    if (action === 'notifications') {
      if (!state.token || !state.user) {
        openLoginModal();
        return;
      }
      await showNotifications();
    }
    if (action === 'go-dashboard') {
      closeModal();
      if (state.user) {
        loadDashboard(state.user.role === 'editor' ? 'editor' : 'client');
        loadRequests();
        document.getElementById('dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    if (action === 'connection-status') {
      const connectionId = target.dataset.connectionId;
      const status = target.dataset.status;
      if (!state.token || !state.user || !connectionId) return openLoginModal();
      try {
        const response = await api(`/api/connections/${connectionId}/status`, { method: 'POST', body: { status } });
        showToast(response.message || `Request ${status}.`, 'success');
        await loadRequests();
      } catch (error) {
        showToast(error.message || 'Could not update that request.', 'error');
      }
    }
    if (action === 'mark-read') {
      if (!state.token || !state.user) return;
      try {
        await api('/api/notifications/read', { method: 'POST' });
        await showNotifications();
      } catch (error) {
        showToast(error.message || 'Could not update notifications.', 'error');
      }
    }
  });

  document.body.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const action = form.dataset.form;
    if (action === 'login-form') {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      setFormBusy(form, true, 'Logging in...');
      try {
        const response = await api('/api/auth/login', { method: 'POST', body: { email: payload.email, password: payload.password } });
        state.token = response.token;
        state.user = response.user;
        saveSession();
        setAuthStatus(form, 'Success - you are logged in.', 'success');
        showToast('Signed in successfully.', 'success');
        await wait(150);
        closeModal();
        if (!state.user.role || !state.user.onboardingComplete || needsEditorVerification(state.user)) {
          openOnboardingModal();
        } else {
          routeAfterAuth(state.user, response.connection?.message || 'Welcome back');
        }
      } catch (error) {
        setFormBusy(form, false);
        showToast(error.message || 'Login failed.', 'error');
      }
      return;
    }

    if (action === 'signup-phone') {
      event.preventDefault();
      const phone = formatPhone(new FormData(form).get('phone'));
      if (phone.length < 10) {
        showToast('Enter a valid mobile number first.', 'error');
        return;
      }
      state.pendingPhone = phone;
      setFormBusy(form, true, 'Checking your account...');
      try {
        const check = await api('/api/auth/check-phone', { method: 'POST', body: { phone } });
        if (check.data?.exists) {
          return showPhoneLoginForm(check.data.name || '');
        }
      } catch (error) {
        setFormBusy(form, false);
        showToast(error.message || 'Could not verify that number.', 'error');
        return;
      }
      showSignupDetailsForm();
      return;
    }

    if (action === 'phone-login') {
      event.preventDefault();
      const password = new FormData(form).get('password');
      setFormBusy(form, true, 'Logging in...');
      try {
        const response = await api('/api/auth/login', { method: 'POST', body: { email: state.pendingPhone, password } });
        state.token = response.token;
        state.user = response.user;
        saveSession();
        setAuthStatus(form, 'Success - you are logged in.', 'success');
        showToast('Signed in successfully.', 'success');
        await wait(150);
        closeModal();
        if (!state.user.role || !state.user.onboardingComplete || needsEditorVerification(state.user)) {
          openOnboardingModal();
          return;
        }
        routeAfterAuth(state.user, response.connection?.message || 'Connecting to video editor');
      } catch (error) {
        setFormBusy(form, false);
        showToast(error.message || 'Login failed.', 'error');
      }
      return;
    }

    if (action === 'signup-details') {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      setFormBusy(form, true, 'Creating account...');
      try {
        const response = await api('/api/auth/register', {
          method: 'POST',
          body: {
            fullName: payload.fullName,
            phone: state.pendingPhone || payload.phone,
            email: payload.email,
            password: payload.password,
            instagram: payload.instagram || ''
          }
        });
        state.token = response.token;
        state.user = response.user;
        saveSession();
        setAuthStatus(form, 'Success - account created.', 'success');
        showToast('Account created successfully.', 'success');
        await wait(150);
        closeModal();
        openOnboardingModal();
      } catch (error) {
        setFormBusy(form, false);
        showToast(error.message || 'Signup failed.', 'error');
      }
      return;
    }

    if (action === 'onboarding-form') {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      const formData = {
        role: payload.role,
        phone: state.pendingPhone || state.user?.phone || payload.phone,
        instagram: payload.instagram || state.user?.instagram || '',
        title: payload.title || '',
        bio: payload.bio || '',
        skills: (payload.skills || '').split(',').map((item) => item.trim()).filter(Boolean),
        software: (payload.software || '').split(',').map((item) => item.trim()).filter(Boolean),
        experience: payload.experience || '',
        availability: payload.availability || '',
        startingPrice: Number(payload.startingPrice || 0),
        location: payload.location || '',
        projectTitle: payload.projectTitle || '',
        projectCategory: payload.projectCategory || '',
        projectBudget: payload.projectBudget || '',
        editorExperienceYears: Number(payload.editorExperienceYears || 0),
        editorSpecialty: payload.editorSpecialty || '',
        editorPortfolioUrl: payload.editorPortfolioUrl || '',
        editorRealWorkAnswer: payload.editorRealWorkAnswer || '',
        profilePhotoUrl: payload.profilePhotoUrl || ''
      };

      setFormBusy(form, true, 'Saving your profile...');
      try {
        const response = await api('/api/auth/onboarding', { method: 'POST', body: formData });
        state.user = response.user;
        state.token = response.token;
        saveSession();
        setAuthStatus(form, 'Success - your profile is ready.', 'success');
        await wait(150);
        closeModal();
        routeAfterAuth(response.user, response.connection?.message || 'Welcome');
      } catch (error) {
        setFormBusy(form, false);
        showToast(error.message || 'Onboarding failed.', 'error');
      }
    }

    if (action === 'contact-connect') {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      const phone = formatPhone(payload.phone || '');
      const instagram = String(payload.instagram || '').trim();
      if (phone.length < 10 && !instagram) {
        showToast('Enter a mobile number or an Instagram handle.', 'error');
        return;
      }
      showConnectionPopup(state.user?.role === 'editor' ? 'Connecting to client' : 'Connecting to video editor', {
        detail: phone ? 'Looking up the account that owns this mobile number.' : 'Looking up the account that owns this Instagram handle.'
      });
      try {
        const response = await api('/api/connect/contact', { method: 'POST', body: { phone, instagram } });
        await loadRequests();
        setTimeout(() => showConnectionResult(response.data?.connection || null), 1200);
      } catch (error) {
        showToast(error.message || 'Could not connect with that contact.', 'error');
        setTimeout(() => closeModal(), 1400);
      }
      return;
    }

    if (action === 'project-form') {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      try {
        const response = await api('/api/projects', {
          method: 'POST',
          body: {
            title: payload.title,
            category: payload.category,
            budget: payload.budget,
            deadline: payload.deadline || '',
            skills: (payload.skills || '').split(',').map((item) => item.trim()).filter(Boolean),
            description: payload.description || ''
          }
        });
        await loadProjects();
        closeModal();
        routeAfterAuth(state.user, 'Connecting to video editor');
        showToast(response.message || 'Project published successfully.', 'success');
      } catch (error) {
        showToast(error.message || 'Project failed to publish.', 'error');
      }
    }
  });
}

function openLoginModal() {
  openModal(`
    <form data-form="login-form" class="auth-form">
      <div class="modal-head"><h2>Sign in</h2><span>Welcome back</span></div>
      <label>
        <span>Email or mobile number</span>
        <input name="email" type="text" placeholder="you@example.com or +91..." required>
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" placeholder="Enter your password" required>
      </label>
      <button type="submit" class="button">Continue</button>
      <p class="muted-link">
        Need an account? <button type="button" class="text-button-inline" data-action="signup">Create one</button>
      </p>
    </form>
  `);
}

function openSignupFlow(preferRole = '') {
  state.pendingPhone = '';
  state.pendingRole = preferRole;
  openModal(`
    <form data-form="signup-phone" class="auth-form">
      <div class="modal-head"><h2>Get started</h2><span>Step 1 of 3</span></div>
      <p class="muted-text">We start with your mobile number — it is how mesteoz connects you with clients or editors and keeps every match accountable.</p>
      <label>
        <span>Mobile number</span>
        <input name="phone" type="tel" placeholder="+91 98765 43210" value="${state.pendingPhone || ''}" required>
      </label>
      <button type="submit" class="button">Continue</button>
    </form>
  `);
}

function showSignupDetailsForm() {
  openModal(`
    <form data-form="signup-details" class="auth-form">
      <div class="modal-head"><h2>Create account</h2><span>Step 2 of 2</span></div>
      <label>
        <span>Full name</span>
        <input name="fullName" type="text" placeholder="Your name" required>
      </label>
      <label>
        <span>Email</span>
        <input name="email" type="email" placeholder="you@example.com" required>
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" placeholder="At least 8 characters" required>
      </label>
      <label>
        <span>Instagram handle</span>
        <input name="instagram" type="text" placeholder="@yourhandle or yourhandle">
      </label>
      <button type="submit" class="button">Create account</button>
    </form>
  `);
}

function openOnboardingModal() {
  const selectedRole = state.user?.role || state.pendingRole || 'client';
  openModal(`
    <form data-form="onboarding-form" class="auth-form onboarding-form">
      <div class="modal-head"><h2>Choose your role</h2><span>One final step</span></div>
      <div class="role-grid">
        <label class="role-card">
          <input type="radio" name="role" value="client" ${selectedRole === 'client' ? 'checked' : ''}>
          <span>I’m a client</span>
        </label>
        <label class="role-card">
          <input type="radio" name="role" value="editor" ${selectedRole === 'editor' ? 'checked' : ''}>
          <span>I’m an editor</span>
        </label>
      </div>
      <div class="grid-two">
        <label>
          <span>Phone</span>
          <input name="phone" type="tel" value="${state.user?.phone || state.pendingPhone || ''}" required>
        </label>
        <label>
          <span>Instagram</span>
          <input name="instagram" type="text" value="${state.user?.instagram || ''}" placeholder="@handle">
        </label>
        <label>
          <span>City</span>
          <input name="location" type="text" placeholder="Remote / Delhi / Dubai">
        </label>
      </div>

      <div class="editor-fields">
        <div class="verification-intro">
          <span class="tiny-label">EDITOR VERIFICATION</span>
          <p class="muted-text">These questions help clients find real working editors. Be specific and use a genuine sample-work link.</p>
        </div>
        <label><span>Editor title</span><input name="title" type="text" placeholder="Short-form editor"></label>
        <label><span>Profile photo URL</span><input name="profilePhotoUrl" type="url" placeholder="https://..."></label>
        <label><span>Years of editing experience</span><input name="editorExperienceYears" type="number" min="0" max="60" placeholder="e.g. 3"></label>
        <label><span>What do you specialise in?</span><input name="editorSpecialty" type="text" placeholder="Reels, YouTube, podcasts, motion graphics" required></label>
        <label><span>Bio</span><textarea name="bio" rows="2" placeholder="What do you make better?"></textarea></label>
        <label><span>Skills</span><input name="skills" type="text" placeholder="Shorts, YouTube, Podcast"></label>
        <label><span>Software</span><input name="software" type="text" placeholder="Premiere Pro, After Effects"></label>
        <label><span>Experience</span><input name="experience" type="text" placeholder="Pro"></label>
        <label><span>Starting price</span><input name="startingPrice" type="number" min="0" step="5" placeholder="Optional"></label>
        <label><span>Availability</span><input name="availability" type="text" placeholder="Available now"></label>
        <label><span>Portfolio or sample-work link</span><input name="editorPortfolioUrl" type="url" placeholder="https://vimeo.com/... or https://drive.google.com/..." required></label>
        <label><span>Describe one real project you edited</span><textarea name="editorRealWorkAnswer" rows="3" minlength="30" placeholder="What was the brief, what did you edit, and what was the result?" required></textarea></label>
      </div>

      <div class="client-fields">
        <label><span>Project title</span><input name="projectTitle" type="text" placeholder="Podcast launch edit package"></label>
        <label><span>Project category</span><input name="projectCategory" type="text" placeholder="Video Editing"></label>
        <label><span>Budget</span><input name="projectBudget" type="text" placeholder="800 or Flexible"></label>
      </div>

      <button type="submit" class="button">Continue to dashboard</button>
    </form>
  `);

  const roleInputs = document.querySelectorAll('input[name="role"]');
  roleInputs.forEach((input) => {
    input.addEventListener('change', () => {
      const form = input.closest('form');
      const clientFields = form.querySelector('.client-fields');
      const editorFields = form.querySelector('.editor-fields');
      const selected = input.value;
      if (selected === 'client') {
        editorFields.style.display = 'none';
        clientFields.style.display = 'grid';
      } else {
        clientFields.style.display = 'none';
        editorFields.style.display = 'grid';
      }
      editorFields.querySelectorAll('[required]').forEach((field) => {
        field.required = selected === 'editor';
      });
    });
  });

  const selectedRoleInput = document.querySelector('input[name="role"]:checked');
  if (selectedRoleInput) {
    selectedRoleInput.dispatchEvent(new Event('change'));
  }
}

function openProjectModal() {
  openModal(`
    <form data-form="project-form" class="auth-form">
      <div class="modal-head"><h2>Post a project</h2><span>Find the right editor</span></div>
      <label><span>Project title</span><input name="title" type="text" placeholder="Podcast edit package" required></label>
      <label><span>Category</span><input name="category" type="text" placeholder="Video Editing" required></label>
      <label><span>Budget</span><input name="budget" type="text" placeholder="$800 or Flexible" required></label>
      <label><span>Deadline</span><input name="deadline" type="text" placeholder="3 days"></label>
      <label><span>Skills</span><input name="skills" type="text" placeholder="Shorts, Reels, Podcast"></label>
      <label><span>Description</span><textarea name="description" rows="4" placeholder="Tell editors exactly what you need."></textarea></label>
      <button type="submit" class="button">Publish project</button>
    </form>
  `);
}

async function loadEditors() {
  try {
    const response = await api('/api/editors');
    state.editors = response.data || [];
    renderEditors();
  } catch (error) {
    console.error(error);
  }
}

async function loadProjects() {
  try {
    const response = await api('/api/projects');
    state.projects = response.data || [];
    renderProjects();
  } catch (error) {
    console.error(error);
  }
}

async function loadStats() {
  try {
    const response = await api('/api/stats');
    const stats = response.data || {};
    const editors = Number(stats.editors || 0);
    const projects = Number(stats.projects || 0);
    const connections = Number(stats.connections || 0);

    const editorsNode = document.getElementById('stat-editors');
    if (editorsNode) editorsNode.textContent = String(editors);

    const projectsNode = document.getElementById('stat-projects');
    if (projectsNode) projectsNode.textContent = `${projects} open brief${projects === 1 ? '' : 's'}`;

    const connectionsNode = document.getElementById('stat-connections');
    if (connectionsNode) connectionsNode.textContent = `${connections} connection${connections === 1 ? '' : 's'}`;

    const stackCount = document.querySelector('#network-stack .avatar-more');
    if (stackCount) stackCount.textContent = String(editors);
  } catch (error) {
    console.error(error);
  }
}

function renderAccountState() {
  const avatar = document.getElementById('dash-avatar');
  const nameNode = document.getElementById('dash-user-name');
  const roleNode = document.getElementById('dash-user-role');

  if (!state.user || !state.token) {
    if (avatar) avatar.textContent = '?';
    if (nameNode) nameNode.textContent = 'Not signed in';
    if (roleNode) roleNode.textContent = 'Sign in to track requests';
    return;
  }

  const initials = String(state.user.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'MZ';
  const isEditor = state.user.role === 'editor';
  const roleLabel = state.user.onboardingComplete
    ? (isEditor ? 'Editor account' : 'Client account')
    : 'Finish your profile';

  if (avatar) avatar.textContent = initials;
  if (nameNode) nameNode.textContent = state.user.name || 'mesteoz member';
  if (roleNode) roleNode.textContent = roleLabel;
}

async function loadDashboard(role) {
  if (!state.token || !state.user) return;
  try {
    const response = await api(`/api/dashboard/${role || state.user.role}`);
    const data = response.data || {};
    state.dashboard = data;

    const eyebrow = document.getElementById('dashboard-eyebrow');
    const title = document.getElementById('dashboard-title');
    const subtitle = document.getElementById('dashboard-subtitle');
    const metricGrid = document.getElementById('metric-grid');

    if (eyebrow) eyebrow.textContent = data.eyebrow || 'WORKSPACE';
    if (title) title.textContent = data.title || 'Your dashboard';
    if (subtitle) subtitle.textContent = data.subtitle || 'Everything is in one place.';

    if (metricGrid) {
      metricGrid.innerHTML = (data.metrics || []).map(([value, label, detail]) => `
        <div class="metric-card">
          <strong>${value}</strong>
          <span>${label}</span>
          <small>${detail}</small>
        </div>
      `).join('');
    }

    let profilePanel = document.getElementById('dashboard-profile-panel');
    if (!profilePanel) {
      profilePanel = document.createElement('div');
      profilePanel.id = 'dashboard-profile-panel';
      profilePanel.className = 'dashboard-panel dashboard-profile-panel';
      document.querySelector('.dashboard-main')?.prepend(profilePanel);
    }
    const profile = data.profile || {};
    const initials = String(profile.name || 'MZ')
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const profilePhoto = profile.photoUrl
      ? `<img class="profile-photo" src="${profile.photoUrl}" alt="${profile.name || 'Profile'}">`
      : `<div class="profile-photo profile-photo-placeholder">${initials}</div>`;
    profilePanel.innerHTML = `
      <div class="profile-card">
        ${profilePhoto}
        <div class="profile-card-copy">
          <span class="tiny-label">${profile.verified ? 'VERIFIED EDITOR' : `${profile.role === 'editor' ? 'EDITOR' : 'CLIENT'} PROFILE`}</span>
          <strong>${profile.name || 'Complete your profile'}</strong>
          <span>${profile.title || profile.location || 'Add your details to get better matches.'}</span>
          ${profile.bio ? `<p>${profile.bio}</p>` : ''}
          ${profile.portfolioUrl ? `<a class="mini-button" href="${profile.portfolioUrl}" target="_blank" rel="noopener">View portfolio ↗</a>` : ''}
        </div>
      </div>
    `;

    const connectionList = document.getElementById('dashboard-connections');
    if (connectionList) {
      connectionList.innerHTML = (data.connections || []).map((item) => `
        <div class="connection-item">
          <div class="avatar avatar-${item.partner?.tone || 'violet'}">${item.partner?.initials || 'MZ'}</div>
          <div>
            <strong>${item.partner?.name || 'Connection'}</strong>
            <small>${item.projectTitle || 'Project'}</small>
          </div>
          <span>${item.status || 'connected'}</span>
        </div>
      `).join('') || '<p class="muted-text">No active matches yet.</p>';
    } else {
      const existing = document.getElementById('dashboard-connection-panel');
      if (existing) existing.remove();
      const panel = document.createElement('div');
      panel.id = 'dashboard-connection-panel';
      panel.className = 'dashboard-panel';
      panel.innerHTML = `
        <div class="panel-head"><div><span class="tiny-label">MATCHES</span><strong>Connections</strong></div></div>
        <div id="dashboard-connections" class="connection-list">
          ${(data.connections || []).map((item) => `
            <div class="connection-item">
              <div class="avatar avatar-${item.partner?.tone || 'violet'}">${item.partner?.initials || 'MZ'}</div>
              <div>
                <strong>${item.partner?.name || 'Connection'}</strong>
                <small>${item.projectTitle || 'Project'}</small>
              </div>
              <span>${item.status || 'connected'}</span>
            </div>
          `).join('') || '<p class="muted-text">No active matches yet.</p>'}
        </div>
      `;
      document.querySelector('.dashboard-main')?.appendChild(panel);
    }

    let contactPanel = document.getElementById('dashboard-contact-panel');
    if (!contactPanel) {
      contactPanel = document.createElement('div');
      contactPanel.id = 'dashboard-contact-panel';
      contactPanel.className = 'dashboard-panel';
      document.querySelector('.dashboard-main')?.appendChild(contactPanel);
    }
    contactPanel.innerHTML = `
      <div class="panel-head"><div><span class="tiny-label">AUTO-CONNECT</span><strong>Connect by phone or @handle</strong></div></div>
      <p class="muted-text">${state.user?.role === 'editor' ? 'Have a client mobile number or Instagram handle? Link their brief to your profile instantly.' : 'Have an editor mobile number or Instagram handle? Link their profile to your brief instantly.'}</p>
      <button class="mini-button" data-action="contact-connect">Auto-connect now</button>
    `;
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Dashboard unavailable.', 'error');
  }
}

function applyLoggedInState() {
  const authButton = document.querySelector('[data-action="login"]');
  const ctaButton = document.querySelector('[data-action="signup"]');
  if (state.user && state.token) {
    if (authButton) authButton.textContent = 'Dashboard';
    if (ctaButton) ctaButton.textContent = 'Log out';
    authButton?.setAttribute('data-action', 'dashboard');
    ctaButton?.setAttribute('data-action', 'logout');

    if (state.user.role && state.user.onboardingComplete) {
      loadDashboard(state.user.role === 'editor' ? 'editor' : 'client');
      loadRequests();
      renderAccountState();
      loadStats();
    }
  }
}

function initSocket() {
  if (!window.io) return;
  const socket = window.io();

  socket.on('connection:connected', async (payload) => {
    if (!state.user || !state.token) return;
    const relevant = payload?.clientId === state.user.id || payload?.editorId === state.user.id;
    if (!relevant) return;
    await loadStats();
    await loadRequests();
    await loadDashboard(state.user.role === 'editor' ? 'editor' : 'client');
    const popupOpen = !modal.hidden && Boolean(modalContent.querySelector('.connect-popup'));
    const stillSearching = popupOpen && !modalContent.querySelector('.connect-spinner.done');
    if (stillSearching) {
      try {
        const response = await api('/api/connect/auto', { method: 'POST' });
        showConnectionResult(response.data?.connection || null);
      } catch (error) {
        console.error(error);
      }
      return;
    }
    showToast(payload?.message || 'You have a new connection.', 'success');
  });

  socket.on('connection:updated', async () => {
    if (!state.token) return;
    await loadRequests();
    await loadDashboard(state.user?.role === 'editor' ? 'editor' : 'client');
  });
}

function bindDashboardNavigation() {
  document.body.addEventListener('click', (event) => {
    const target = event.target.closest('[data-dashboard]');
    if (!target) return;
    const role = target.dataset.dashboard;
    if (state.user && state.token) {
      loadDashboard(role);
    }
  });

  document.body.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action="dashboard"]');
    if (!target || !state.user) return;
    const role = state.user.role === 'editor' ? 'editor' : 'client';
    loadDashboard(role);
    document.getElementById('dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function bindToolbar() {
  const searchInput = document.getElementById('editor-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(bindToolbar.timer);
      bindToolbar.timer = setTimeout(loadEditors, 220);
    });
  }

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');
      state.category = chip.dataset.category || '';
      loadEditors();
    });
  });

  document.querySelectorAll('[data-scroll="editors"]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById('editors')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
}

function init() {
  applyTheme(currentTheme(), false);
  initLaunchSplash();
  watchSystemTheme();
  observeReveals();
  bindGlobalActions();
  bindDashboardNavigation();
  bindToolbar();
  initCursorEffect();
  renderAccountState();
  initSocket();
  Promise.all([loadEditors(), loadProjects(), loadStats()]).then(() => {
    if (state.token && state.user) {
      applyLoggedInState();
      api('/api/auth/me')
        .then((response) => {
          if (response.user) {
            state.user = response.user;
            saveSession();
            renderAccountState();
          }
        })
        .catch(() => {});
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
