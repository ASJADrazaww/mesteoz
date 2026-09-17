require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mesteoz-development-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();
const projects = [];
const connections = [];
const workspaces = [];
const notifications = [];
const reports = [];

const TONES = ['violet', 'coral', 'blue', 'cyan', 'gold', 'pink'];
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'our', 'your', 'his', 'her', 'that', 'this', 'from', 'into', 'video', 'videos', 'content', 'work', 'make', 'needs', 'need', 'edit', 'editing', 'editor', 'editors', 'client', 'project', 'projects']);

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function tokenFor(payload, type = 'user') {
  return jwt.sign({ ...payload, type }, JWT_SECRET, { expiresIn: '7d' });
}

function getToken(req) {
  return req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function samePhone(a, b) {
  const left = digits(a);
  const right = digits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 10 && longer.endsWith(shorter);
}

function cleanHandle(value) {
  return String(value || '').trim().replace(/^@+/, '');
}

function initialsOf(name) {
  return String(name || 'MZ').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'MZ';
}

function toneFor(seed) {
  const total = String(seed || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TONES[total % TONES.length];
}

function nowIso() {
  return new Date().toISOString();
}

function findUserById(id) {
  return [...users.values()].find((user) => user.id === id) || null;
}

function notify(userId, type, title, message) {
  const item = { id: `notification-${Date.now()}-${notifications.length}`, userId, type, title, message, read: false, createdAt: nowIso() };
  notifications.unshift(item);
  return item;
}

function requireUser(req, res, next) {
  try {
    const payload = jwt.verify(getToken(req), JWT_SECRET);
    if (payload.type !== 'user') throw new Error('Invalid user token');
    req.user = findUserById(payload.id);
    if (!req.user) throw new Error('User not found');
    return next();
  } catch {
    return res.status(401).json({ message: 'Please sign in to continue.' });
  }
}

function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(getToken(req), JWT_SECRET);
    if (payload.type !== 'admin') throw new Error('Invalid admin token');
    return next();
  } catch {
    return res.status(401).json({ message: 'Admin access is required.' });
  }
}

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(422).json({ message: result.error.issues[0].message, issues: result.error.issues });
    }
    req[source] = result.data;
    return next();
  };
}

function profileStrength(user) {
  const details = user.details || {};
  const checks = ['title', 'bio', 'skills', 'software', 'startingPrice', 'availability', 'instagram'];
  const done = checks.filter((key) => Array.isArray(details[key]) ? details[key].length > 0 : Boolean(user[key] ?? details[key])).length;
  return Math.round(((done + 1) / (checks.length + 1)) * 100);
}

function buildEditorProfile(user) {
  const details = user.details || {};
  return {
    id: user.id,
    name: user.name,
    initials: initialsOf(user.name),
    tone: toneFor(user.id),
    title: details.title || 'Video Editor',
    rating: Number(user.rating || 0),
    reviews: Number(user.reviews || 0),
    match: user.reviews ? Math.round((user.rating || 0) * 20) : 0,
    price: Number(details.startingPrice) || 0,
    delivery: details.delivery || '2–4 days',
    availability: details.availability || 'Available now',
    location: user.city || 'Remote',
    skills: details.skills || [],
    software: details.software || [],
    experience: details.experience || 'Pro',
    bio: details.bio || 'Fresh on mesteoz and taking new briefs.',
    portfolio: details.portfolio || [],
    phone: user.phone || '',
    instagram: user.instagram || '',
    profileStrength: profileStrength(user),
    joinedAt: user.createdAt,
    verified: Boolean(details.verification?.portfolioUrl && details.verification?.realWorkAnswer)
  };
}

function materializeProfile(user) {
  if (user.role === 'editor') user.profile = buildEditorProfile(user);
  return user;
}

function registeredEditors() {
  return [...users.values()].filter((user) => user.role === 'editor' && user.onboardingComplete).map(materializeProfile);
}

function keywords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function overlap(a, b) {
  const target = new Set(keywords(b));
  return [...new Set(keywords(a))].filter((word) => target.has(word)).length;
}

function scorePair(client, project, editor) {
  const details = editor.details || {};
  const editorText = [...(details.skills || []), ...(details.software || []), details.title || '', details.bio || ''].join(' ');
  const clientText = (client?.details?.contentTypes || []).join(' ');
  const briefText = [project?.title, project?.category, (project?.skills || []).join(' '), project?.description].join(' ');

  let score = 42;
  score += Math.min(27, overlap(editorText, `${briefText} ${clientText}`) * 9);
  score += Math.min(12, overlap(clientText, editorText) * 6);
  if (project?.category && editorText.toLowerCase().includes(String(project.category).toLowerCase())) score += 8;
  if ((details.availability || 'Available now') === 'Available now') score += 6;
  if (Number(project?.budgetValue) > 0 && Number(details.startingPrice) > 0 && Number(details.startingPrice) <= Number(project.budgetValue)) score += 7;
  if (client?.city && editor.city && String(client.city).toLowerCase() === String(editor.city).toLowerCase()) score += 5;
  if ((details.experience || '') === 'Expert') score += 2;
  return Math.max(45, Math.min(99, Math.round(score)));
}

function connectionFor(clientId, editorId) {
  return connections.find((item) => item.clientId === clientId && item.editorId === editorId);
}

function connectPair(client, editor, project, score, initiatedBy) {
  const connection = {
    id: `connection-${Date.now()}-${connections.length}`,
    clientId: client.id,
    clientName: client.name,
    clientPhone: client.phone || '',
    clientInstagram: client.instagram || '',
    editorId: editor.id,
    editorName: editor.name,
    editorPhone: editor.phone || '',
    editorInstagram: editor.instagram || '',
    editorTitle: editor.details?.title || 'Video Editor',
    projectId: project?.id || '',
    projectTitle: project?.title || 'Open brief',
    category: project?.category || 'General',
    score,
    status: 'connected',
    initiatedBy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [{ label: 'Auto-connected', detail: `${client.name} and ${editor.name} were matched at ${score}% fit.`, at: nowIso() }]
  };
  connections.unshift(connection);
  io.emit('connection:connected', { connectionId: connection.id, clientId: client.id, editorId: editor.id, message: `${client.name} is now connected to ${editor.name}.` });
  return connection;
}

function partnerView(connection, userId) {
  const viewerIsClient = connection.clientId === userId;
  const role = viewerIsClient ? 'editor' : 'client';
  const name = viewerIsClient ? connection.editorName : connection.clientName;
  const phone = viewerIsClient ? connection.editorPhone : connection.clientPhone;
  const instagram = viewerIsClient ? connection.editorInstagram : connection.clientInstagram;
  const title = viewerIsClient ? connection.editorTitle || 'Video Editor' : 'Client';
  return {
    id: connection.id,
    direction: role,
    partner: { role, name, title, phone, instagram, initials: name ? initialsOf(name) : 'MZ', tone: toneFor(name || connection.id), location: '' },
    projectTitle: connection.projectTitle,
    projectId: connection.projectId,
    category: connection.category,
    score: connection.score,
    status: connection.status,
    initiatedBy: connection.initiatedBy,
    updatedAt: connection.updatedAt,
    createdAt: connection.createdAt,
    history: connection.history || [],
    contact: connection.status === 'connected' ? { phone: phone || '', instagram: instagram || '' } : { phone: '', instagram: '' }
  };
}

function connectionsFor(userId) {
  return connections.filter((item) => item.clientId === userId || item.editorId === userId).map((item) => partnerView(item, userId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function contactIdentifier(contact = {}) {
  return {
    phone: String(contact.phone || '').trim(),
    instagram: cleanHandle(contact.instagram || contact.handle || '')
  };
}

function matchesContact(account, wanted) {
  if (!account || !account.onboardingComplete) return '';
  if (wanted.phone && samePhone(account.phone, wanted.phone)) return 'mobile number';
  const handle = cleanHandle(account.instagram);
  if (wanted.instagram && handle && handle.toLowerCase() === wanted.instagram.toLowerCase()) return 'Instagram handle';
  return '';
}

function findUserByContact(contact, options = {}) {
  const wanted = contactIdentifier(contact);
  const excludeId = options.excludeId || '';
  const role = options.role || '';
  if (!wanted.phone && !wanted.instagram) return null;
  for (const account of users.values()) {
    if (account.id === excludeId) continue;
    if (role && account.role !== role) continue;
    const reason = matchesContact(account, wanted);
    if (reason) return { account, reason };
  }
  return null;
}

// Automatically connects an editor and a client using a shared mobile number or Instagram handle.
function autoConnectByContact(user, contact = {}) {
  const counterpartRole = user.role === 'editor' ? 'client' : 'editor';
  const found = findUserByContact(contact, { role: counterpartRole, excludeId: user.id });
  if (!found) return null;

  const client = user.role === 'client' ? user : found.account;
  const editor = user.role === 'editor' ? user : found.account;
  const brief = projects.filter((project) => project.clientId === client.id)[0] || null;
  const score = scorePair(client, brief, editor);
  const existing = connectionFor(client.id, editor.id);

  if (existing) {
    existing.status = 'connected';
    existing.score = Math.max(existing.score, score);
    existing.updatedAt = nowIso();
    existing.history.unshift({ label: 'Contact handoff', detail: `${user.name} connected with ${found.account.name} through a shared ${found.reason}.`, at: nowIso() });
  } else {
    const connection = connectPair(client, editor, brief, score, user.role);
    connection.history.unshift({ label: 'Contact handoff', detail: `${client.name} and ${editor.name} were auto-connected through a shared ${found.reason}.`, at: nowIso() });
  }

  notify(client.id, 'connection', 'Editor connected', `${editor.name} is now linked to you. Phone: ${editor.phone || 'shared in dashboard'}.`);
  notify(editor.id, 'connection', 'Client connected', `${client.name} is now linked to you. Phone: ${client.phone || 'shared in dashboard'}.`);

  const mine = connectionsFor(user.id);
  return {
    connection: mine.find((item) => item.partner.name === found.account.name) || mine[0] || null,
    connections: mine,
    partner: found.account,
    reason: found.reason,
    created: !existing
  };
}

function createSearchingConnection(user, project) {
  const connection = {
    id: `connection-${Date.now()}-${connections.length}`,
    clientId: '',
    clientName: '',
    clientPhone: '',
    clientInstagram: '',
    editorId: '',
    editorName: '',
    editorPhone: '',
    editorInstagram: '',
    editorTitle: '',
    projectId: project?.id || '',
    projectTitle: project?.title || 'Open brief',
    category: project?.category || 'General',
    score: 0,
    status: 'searching',
    initiatedBy: user.role,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [{ label: user.role === 'client' ? 'Brief published' : 'Profile published', detail: user.role === 'client' ? 'Waiting for the first editor that fits this brief.' : 'Waiting for the next client brief that fits these skills.', at: nowIso() }]
  };

  if (user.role === 'client') {
    Object.assign(connection, { clientId: user.id, clientName: user.name, clientPhone: user.phone || '', clientInstagram: user.instagram || '' });
  } else {
    Object.assign(connection, { editorId: user.id, editorName: user.name, editorPhone: user.phone || '', editorInstagram: user.instagram || '', editorTitle: user.details?.title || 'Video Editor' });
  }

  connections.unshift(connection);
  return connection;
}

function runMatchmaking() {
  const editors = registeredEditors();
  const briefs = projects.filter((project) => project.status !== 'Closed');
  const matched = [];

  for (const connection of connections) {
    if (connection.status !== 'searching') continue;

    if (connection.clientId && !connection.editorId) {
      const client = findUserById(connection.clientId);
      if (!client) continue;
      const project = projects.find((item) => item.id === connection.projectId) || null;
      const ranked = editors.filter((editor) => !connectionFor(client.id, editor.id)).map((editor) => ({ editor, score: scorePair(client, project, editor) })).sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best) continue;

      Object.assign(connection, {
        editorId: best.editor.id,
        editorName: best.editor.name,
        editorPhone: best.editor.phone || '',
        editorInstagram: best.editor.instagram || '',
        editorTitle: best.editor.title || 'Video Editor',
        score: best.score,
        status: 'connected',
        updatedAt: nowIso()
      });
      connection.history.unshift({ label: 'Editor matched', detail: `${best.editor.name} joined and was auto-connected at ${best.score}% fit.`, at: nowIso() });
      notify(connection.clientId, 'connection', 'Editor connected', `${best.editor.name} is now linked to "${connection.projectTitle}".`);
      notify(best.editor.id, 'connection', 'Client connected', `${connection.clientName} is now linked to "${connection.projectTitle}".`);
      io.emit('connection:connected', { connectionId: connection.id, clientId: connection.clientId, editorId: best.editor.id, message: `${connection.clientName} is now connected to ${best.editor.name}.` });
      matched.push(connection);
      continue;
    }

    if (connection.editorId && !connection.clientId) {
      const editor = findUserById(connection.editorId);
      if (!editor) continue;
      const ranked = briefs.map((project) => {
        const client = findUserById(project.clientId);
        if (!client || connectionFor(client.id, editor.id)) return null;
        return { client, project, score: scorePair(client, project, editor) };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best) continue;

      Object.assign(connection, {
        clientId: best.client.id,
        clientName: best.client.name,
        clientPhone: best.client.phone || '',
        clientInstagram: best.client.instagram || '',
        projectId: best.project.id,
        projectTitle: best.project.title,
        category: best.project.category || 'General',
        score: best.score,
        status: 'connected',
        updatedAt: nowIso()
      });
      connection.history.unshift({ label: 'Client matched', detail: `${best.client.name} published "${best.project.title}" and was auto-connected at ${best.score}% fit.`, at: nowIso() });
      notify(editor.id, 'connection', 'Client connected', `${best.client.name} is now linked to "${best.project.title}".`);
      notify(best.client.id, 'connection', 'Editor connected', `${editor.name} is now linked to "${best.project.title}".`);
      io.emit('connection:connected', { connectionId: connection.id, clientId: best.client.id, editorId: editor.id, message: `${best.client.name} is now connected to ${editor.name}.` });
      matched.push(connection);
    }
  }

  return matched;
}

function userForLogin(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const byEmail = [...users.values()].find((user) => user.email && user.email.toLowerCase() === normalized);
  if (byEmail) return byEmail;
  const byPhone = [...users.values()].find((user) => samePhone(user.phone, raw));
  if (byPhone) return byPhone;
  return [...users.values()].find((user) => user.instagram && cleanHandle(user.instagram).toLowerCase() === cleanHandle(raw).toLowerCase());
}

const phoneShape = z.string().trim().regex(/^[0-9+\s()-]{7,20}$/, 'Enter a valid mobile number.');

const registrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.'),
  phone: phoneShape,
  email: z.string().trim().email('Enter a valid email.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  instagram: z.string().trim().optional().or(z.literal(''))
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email or mobile number.'),
  password: z.string().min(1, 'Enter your password.')
});

const onboardingSchema = z.object({
  role: z.enum(['client', 'editor']),
  phone: phoneShape,
  instagram: z.string().trim().optional().or(z.literal('')),
  company: z.string().trim().optional().or(z.literal('')),
  projectTitle: z.string().trim().optional().or(z.literal('')),
  projectCategory: z.string().trim().optional().or(z.literal('')),
  projectBudget: z.string().trim().optional().or(z.literal('')),
  projectDeadline: z.string().trim().optional().or(z.literal('')),
  projectDescription: z.string().trim().optional().or(z.literal('')),
  title: z.string().trim().optional().or(z.literal('')),
  skills: z.array(z.string()).default([]),
  software: z.array(z.string()).default([]),
  experience: z.string().trim().optional().or(z.literal('')),
  availability: z.string().trim().optional().or(z.literal('')),
  bio: z.string().trim().optional().or(z.literal('')),
  startingPrice: z.coerce.number().nonnegative().optional().default(0),
  location: z.string().trim().optional().or(z.literal('')),
  editorExperienceYears: z.coerce.number().int().min(0).max(60).optional().default(0),
  editorSpecialty: z.string().trim().optional().or(z.literal('')),
  editorPortfolioUrl: z.string().trim().url('Enter a valid portfolio URL.').optional().or(z.literal('')),
  editorRealWorkAnswer: z.string().trim().optional().or(z.literal('')),
  profilePhotoUrl: z.string().trim().url('Enter a valid photo URL.').optional().or(z.literal(''))
}).superRefine((payload, context) => {
  if (payload.role !== 'editor') return;
  if (!payload.editorSpecialty) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['editorSpecialty'], message: 'Tell us what kind of editing you specialise in.' });
  }
  if (!payload.editorPortfolioUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['editorPortfolioUrl'], message: 'Add a portfolio or sample-work link.' });
  }
  if (!payload.editorRealWorkAnswer || payload.editorRealWorkAnswer.length < 30) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['editorRealWorkAnswer'], message: 'Share at least 30 characters about a real project you edited.' });
  }
});

const offerSchema = z.object({
  editorId: z.string().min(1, 'Select an editor.'),
  title: z.string().trim().min(3, 'Give the project a short title.'),
  deliverables: z.string().trim().min(3, 'Describe the deliverables.'),
  budget: z.coerce.number().positive('Budget must be greater than zero.'),
  currency: z.enum(['USD', 'INR']),
  deadline: z.string().trim().min(1, 'Pick a deadline.'),
  revisions: z.coerce.number().int().min(0).max(10),
  rawAssetUrl: z.string().trim().optional().or(z.literal(''))
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'mesteoz', time: nowIso() });
});

app.post('/api/auth/register', validate(registrationSchema, 'body'), (req, res) => {
  const { fullName, phone, email, password, instagram } = req.body;
  const normalizedEmail = String(email).trim().toLowerCase();
  const duplicateEmail = users.get(normalizedEmail);
  const duplicatePhone = [...users.values()].find((user) => samePhone(user.phone, phone));

  if (duplicateEmail || duplicatePhone) {
    return res.status(409).json({ message: 'An account with this email or mobile number already exists.' });
  }

  const user = {
    id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: fullName,
    email: normalizedEmail,
    phone: digits(phone),
    instagram: cleanHandle(instagram),
    passwordHash: bcrypt.hashSync(password, 10),
    role: null,
    onboardingComplete: false,
    createdAt: nowIso(),
    city: '',
    details: {},
    rating: 0,
    reviews: 0
  };

  users.set(normalizedEmail, user);
  return res.status(201).json({
    token: tokenFor({ id: user.id, type: 'user' }),
    user: publicUser(user)
  });
});

app.post('/api/auth/login', validate(loginSchema, 'body'), (req, res) => {
  const account = userForLogin(req.body.email);
  if (!account) {
    return res.status(404).json({ message: 'No account found for that email or mobile number.' });
  }

  if (!bcrypt.compareSync(req.body.password, account.passwordHash)) {
    return res.status(401).json({ message: 'Incorrect password. Please try again.' });
  }

  const existing = connections.find((item) => item.clientId === account.id || item.editorId === account.id);
  const connection = existing ? { message: existing.status === 'connected' ? `Connecting to ${existing.editorName || existing.clientName}` : 'Connecting to video editor' } : { message: 'Connecting to video editor' };

  return res.json({
    token: tokenFor({ id: account.id, type: 'user' }),
    user: publicUser(account),
    connection
  });
});

app.post('/api/auth/onboarding', requireUser, validate(onboardingSchema, 'body'), (req, res) => {
  const user = req.user;
  const payload = req.body;

  user.name = user.name || payload.title || user.name;
  user.phone = digits(payload.phone || user.phone || '');
  user.instagram = cleanHandle(payload.instagram || user.instagram || '');
  user.role = payload.role;
  user.onboardingComplete = true;
  user.city = payload.location || user.city || '';
  user.details = {
    ...user.details,
    title: payload.title || user.details?.title || (payload.role === 'editor' ? 'Video Editor' : ''),
    bio: payload.role === 'editor' ? (payload.bio || user.details?.bio || '') : (payload.projectDescription || user.details?.bio || ''),
    skills: payload.skills || [],
    software: payload.software || [],
    startingPrice: Number(payload.startingPrice || user.details?.startingPrice || 0),
    experience: payload.experience || user.details?.experience || 'Pro',
    availability: payload.availability || user.details?.availability || 'Available now',
    delivery: '2–4 days',
    location: payload.location || 'Remote',
    contentTypes: payload.projectCategory ? [payload.projectCategory] : user.details?.contentTypes || [],
    photoUrl: payload.profilePhotoUrl || user.details?.photoUrl || '',
    verification: payload.role === 'editor' ? {
      experienceYears: Number(payload.editorExperienceYears || 0),
      specialty: payload.editorSpecialty || '',
      portfolioUrl: payload.editorPortfolioUrl || '',
      realWorkAnswer: payload.editorRealWorkAnswer || '',
      verifiedAt: nowIso()
    } : user.details?.verification || null
  };

  materializeProfile(user);

  if (payload.role === 'client') {
    const project = {
      id: `project-${Date.now()}-${projects.length}`,
      clientId: user.id,
      client: user.name,
      title: payload.projectTitle || 'New project brief',
      category: payload.projectCategory || 'Video Editing',
      budget: payload.projectBudget || 'Flexible',
      budgetValue: Number(String(payload.projectBudget || '0').replace(/[^\d.]/g, '')) || 0,
      deadline: payload.projectDeadline || 'Flexible',
      description: payload.projectDescription || 'Client brief posted on mesteoz.',
      skills: payload.projectCategory ? [payload.projectCategory] : ['Video Editing'],
      status: 'Open',
      applicants: 0,
      createdAt: nowIso(),
      phone: user.phone,
      instagram: user.instagram || ''
    };

    projects.unshift(project);
    const searching = createSearchingConnection(user, project);
    searching.projectTitle = project.title;
    searching.category = project.category;
    runMatchmaking();

    return res.json({
      token: tokenFor({ id: user.id, type: 'user' }),
      user: publicUser(user),
      connection: { message: 'Connecting to video editor' }
    });
  }

  createSearchingConnection(user, null);
  runMatchmaking();
  return res.json({
    token: tokenFor({ id: user.id, type: 'user' }),
    user: publicUser(user),
    connection: { message: 'Connecting to client' }
  });
});

app.get('/api/editors', (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const editors = registeredEditors().map((user) => buildEditorProfile(user)).filter((editor) => {
    const haystack = [editor.name, editor.title, editor.location, editor.instagram, ...(editor.skills || []), ...(editor.software || [])].join(' ').toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesCategory = !category || category === 'All editors' || (editor.skills || []).includes(category) || (editor.title || '').includes(category);
    return matchesSearch && matchesCategory;
  }).sort((a, b) => (b.profileStrength || 0) - (a.profileStrength || 0)).map((editor) => {
    const { phone, ...publicProfile } = editor;
    return publicProfile;
  });

  return res.json({ data: editors });
});

app.get('/api/projects', (req, res) => {
  const payload = projects.map((project) => ({
    id: project.id,
    clientId: project.clientId,
    client: project.client || 'Client',
    title: project.title,
    category: project.category || 'Video Editing',
    budget: project.budget || 'Flexible',
    budgetValue: Number(project.budgetValue || 0),
    deadline: project.deadline || 'Flexible',
    description: project.description || '',
    skills: project.skills || [],
    status: project.status || 'Open',
    applicants: Number(project.applicants || 0),
    createdAt: project.createdAt
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return res.json({ data: payload });
});

app.post('/api/projects',
  requireUser,
  validate(
    z.object({
      title: z.string().trim().min(3, 'Project title is required.'),
      category: z.string().trim().min(1, 'Choose a category.'),
      budget: z.string().trim().min(1, 'Add a budget.'),
      deadline: z.string().trim().optional().or(z.literal('')),
      skills: z.array(z.string()).optional().default([]),
      description: z.string().trim().optional().or(z.literal(''))
    }),
    'body'
  ),
  (req, res) => {
    const user = req.user;
    const project = {
      id: `project-${Date.now()}-${projects.length}`,
      clientId: user.id,
      client: user.name,
      title: req.body.title,
      category: req.body.category,
      budget: req.body.budget,
      budgetValue: Number(String(req.body.budget).replace(/[^\d.]/g, '')) || 0,
      deadline: req.body.deadline || 'Flexible',
      description: req.body.description || 'Client brief posted on mesteoz.',
      skills: req.body.skills || [],
      status: 'Open',
      applicants: 0,
      createdAt: nowIso(),
      phone: user.phone,
      instagram: user.instagram || ''
    };

    projects.unshift(project);
    const searching = createSearchingConnection(user, project);
    searching.projectTitle = project.title;
    searching.category = project.category;
    runMatchmaking();

    return res.status(201).json({ data: project, message: 'Project published successfully.' });
  }
);

app.post('/api/projects/:id/apply', requireUser, (req, res) => {
  if (req.user.role !== 'editor') return res.status(403).json({ message: 'Only editor accounts can apply to briefs.' });
  const project = projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  const client = findUserById(project.clientId);
  if (!client) return res.status(404).json({ message: 'This brief is no longer available.' });

  const score = scorePair(client, project, req.user);
  project.applicants = Number(project.applicants || 0) + 1;
  const existing = connectionFor(client.id, req.user.id);

  if (existing) {
    existing.score = Math.max(existing.score, score);
    existing.updatedAt = nowIso();
    existing.history.unshift({ label: 'Application sent', detail: `${req.user.name} applied to "${project.title}".`, at: nowIso() });
  } else {
    connectPair(client, req.user, project, score, 'editor');
  }

  notify(client.id, 'application', 'New application', `${req.user.name} applied to "${project.title}" — you are now connected.`);
  notify(req.user.id, 'connection', 'Client connected', `You are now connected with ${client.name} for "${project.title}".`);
  return res.status(201).json({ message: 'Applied — you and the client are now connected.', data: connectionsFor(req.user.id), created: !existing });
});

app.post('/api/offers', requireUser, validate(offerSchema, 'body'), (req, res) => {
  const editor = findUserById(req.body.editorId);
  if (!editor || editor.role !== 'editor') return res.status(404).json({ message: 'Editor not found.' });

  const workspace = {
    id: `workspace-${Date.now()}-${workspaces.length}`,
    clientId: req.user.id,
    editorId: editor.id,
    clientName: req.user.name,
    editorName: editor.name,
    title: req.body.title,
    description: req.body.deliverables,
    budget: Number(req.body.budget),
    currency: req.body.currency,
    deadline: req.body.deadline,
    revisions: Number(req.body.revisions || 0),
    rawAssetUrl: req.body.rawAssetUrl || '',
    progress: 12,
    status: 'new',
    createdAt: nowIso()
  };
  workspaces.unshift(workspace);

  const existing = connections.find((item) => item.clientId === req.user.id && item.editorId === editor.id);
  if (!existing) {
    connections.unshift({
      id: `connection-${Date.now()}-${connections.length}`,
      clientId: req.user.id,
      clientName: req.user.name,
      clientPhone: req.user.phone || '',
      clientInstagram: req.user.instagram || '',
      editorId: editor.id,
      editorName: editor.name,
      editorPhone: editor.phone || '',
      editorInstagram: editor.instagram || '',
      editorTitle: editor.details?.title || 'Video Editor',
      projectId: '',
      projectTitle: req.body.title,
      category: 'Assigned',
      score: 100,
      status: 'connected',
      initiatedBy: 'client',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      history: [{ label: 'Project assigned', detail: `${req.user.name} assigned ${editor.name} to "${req.body.title}".`, at: nowIso() }]
    });
  }

  notify(editor.id, 'assignment', 'New assignment', `${req.user.name} assigned you to "${req.body.title}".`);
  notify(req.user.id, 'assignment', 'Project assigned', `${editor.name} has been added to "${req.body.title}".`);
  io.emit('connection:connected', { connectionId: workspace.id, clientId: req.user.id, editorId: editor.id, message: `${req.user.name} is now connected to ${editor.name}.` });

  return res.status(201).json({ message: 'Project assigned and editor notified.' });
});

app.get('/api/dashboard/:role', requireUser, (req, res) => {
  const role = req.params.role === 'editor' ? 'editor' : 'client';
  const user = req.user;

  if (!user.onboardingComplete || !user.role) {
    return res.status(403).json({ message: 'Finish onboarding before opening your dashboard.' });
  }

  if (user.role !== role) {
    return res.status(403).json({ message: 'This dashboard is not available for your account type.' });
  }

  const matches = connectionsFor(user.id);
  const connected = matches.filter((item) => item.status === 'connected');
  const searching = matches.filter((item) => item.status === 'searching');
  const working = role === 'editor' ? workspaces.filter((space) => space.editorId === user.id) : workspaces.filter((space) => space.clientId === user.id);
  const myBriefs = projects.filter((project) => project.clientId === user.id);
  const budgetTracked = working.reduce((sum, space) => sum + Number(space.budget || 0), 0) + myBriefs.reduce((sum, project) => sum + Number(project.budgetValue || 0), 0);
  const metrics = role === 'editor'
    ? [
        [String(connected.length), 'Live connections', 'client links'],
        [String(searching.length), 'Requests tracked', 'still searching'],
        [`${profileStrength(user)}%`, 'Profile strength', 'completeness'],
        [`$${Number(user.details?.startingPrice || 0)}`, 'Starting price', 'per edit']
      ]
    : [
        [String(myBriefs.length), 'Briefs posted', 'on the website'],
        [String(connected.length), 'Editors connected', 'live links'],
        [String(searching.length), 'Requests tracked', 'still searching'],
        [`$${budgetTracked}`, 'Budget tracked', 'briefs + projects']
      ];

  return res.json({
    data: {
      eyebrow: role === 'editor' ? 'EDITOR WORKSPACE' : 'CLIENT WORKSPACE',
      title: user.name ? `Good morning, ${user.name.split(' ')[0]}` : 'Good morning',
      subtitle: role === 'editor' ? 'Your next great project is closer than you think.' : 'Everything your next brief needs is in one place.',
      profile: {
        name: user.name || '',
        role,
        photoUrl: user.details?.photoUrl || '',
        title: user.details?.title || '',
        location: user.city || 'Remote',
        bio: user.details?.bio || '',
        portfolioUrl: user.details?.verification?.portfolioUrl || '',
        verified: Boolean(user.details?.verification?.portfolioUrl && user.details?.verification?.realWorkAnswer)
      },
      metrics,
      workspaces: working.slice(0, 3).map((space) => ({
        title: space.title,
        editorName: space.editorName || 'Editor',
        clientName: space.clientName || 'Client',
        budget: space.budget || 0,
        currency: space.currency || 'USD',
        progress: Number(space.progress || 0)
      })),
      connections: matches,
      notifications: notifications.filter((item) => item.userId === user.id).slice(0, 5)
    }
  });
});

app.get('/api/connections', requireUser, (req, res) => {
  const matched = runMatchmaking();
  return res.json({ data: connectionsFor(req.user.id), matched: matched.length });
});

app.post('/api/connect/auto', requireUser, (req, res) => {
  const before = new Set(connections.filter((item) => item.status === 'connected').map((item) => item.id));
  const matched = runMatchmaking();
  const mine = connectionsFor(req.user.id);
  const fresh = mine.filter((item) => item.status === 'connected' && !before.has(item.id));
  return res.json({ data: { connection: mine[0] || null, connections: mine, created: fresh.length > 0 || Boolean(mine.length), matched: fresh.length || matched.length } });
});

app.post('/api/admin/login', validate(z.object({ password: z.string().trim().min(1, 'Enter the admin password.') }), 'body'), (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: 'Invalid admin password.' });
  }
  return res.json({ token: tokenFor({ id: 'admin', type: 'admin' }) });
});

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const totalRevenue = workspaces.reduce((sum, workspace) => sum + Number(workspace.budget || 0), 0);
  return res.json({
    data: {
      analytics: { users: users.size, projects: projects.length, revenue: `$${totalRevenue.toLocaleString()}`, reports: reports.length },
      users: [...users.values()].map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role || 'Onboarding', phone: user.phone, instagram: user.instagram || '' })),
      payments: workspaces.map((workspace) => ({ id: workspace.id, project: workspace.title, amount: Number(workspace.budget || 0), currency: workspace.currency || 'USD', status: workspace.status || 'Active' }))
    }
  });
});

app.post('/api/auth/check-phone', validate(z.object({ phone: phoneShape }), 'body'), (req, res) => {
  const account = [...users.values()].find((user) => samePhone(user.phone, req.body.phone));
  return res.json({ data: { exists: Boolean(account), onboardingComplete: Boolean(account?.onboardingComplete), role: account?.role || null, name: account?.name || '' } });
});

app.get('/api/auth/me', requireUser, (req, res) => {
  materializeProfile(req.user);
  return res.json({ user: publicUser(req.user), connections: connectionsFor(req.user.id) });
});

app.get('/api/requests', requireUser, (req, res) => {
  runMatchmaking();
  const mine = connectionsFor(req.user.id);
  const myBriefs = projects.filter((project) => project.clientId === req.user.id);
  const visibleBriefs = req.user.role === 'editor' ? projects.filter((project) => project.status !== 'Closed') : myBriefs;
  return res.json({
    data: {
      connections: mine,
      projects: visibleBriefs,
      workspaces: workspaces.filter((space) => space.clientId === req.user.id || space.editorId === req.user.id),
      notifications: notifications.filter((item) => item.userId === req.user.id),
      counts: { connected: mine.filter((item) => item.status === 'connected').length, searching: mine.filter((item) => item.status === 'searching').length, accepted: mine.filter((item) => item.status === 'accepted').length }
    }
  });
});

app.get('/api/notifications', requireUser, (req, res) => res.json({ data: notifications.filter((item) => item.userId === req.user.id) }));
app.post('/api/notifications/read', requireUser, (req, res) => { notifications.filter((item) => item.userId === req.user.id).forEach((item) => { item.read = true; }); return res.json({ message: 'Notifications marked as read.' }); });

app.post('/api/connections/:id/status', requireUser, (req, res) => {
  const connection = connections.find((item) => item.id === req.params.id && (item.clientId === req.user.id || item.editorId === req.user.id));
  if (!connection) return res.status(404).json({ message: 'Connection not found.' });
  const status = String(req.body.status || '');
  if (!['accepted', 'declined', 'completed'].includes(status)) return res.status(422).json({ message: 'Unknown connection status.' });
  connection.status = status;
  connection.updatedAt = nowIso();
  connection.history.unshift({ label: `Request ${status}`, detail: `${req.user.name} marked this request as ${status}.`, at: nowIso() });
  const partnerId = connection.clientId === req.user.id ? connection.editorId : connection.clientId;
  if (partnerId) notify(partnerId, 'connection', `Request ${status}`, `${req.user.name} marked "${connection.projectTitle}" as ${status}.`);
  io.emit('connection:updated', { connectionId: connection.id, status, message: `Request ${status}.` });
  return res.json({ data: partnerView(connection, req.user.id), message: `Request marked ${status}.` });
});

app.post('/api/connect/editor/:id', requireUser, (req, res) => {
  const editor = findUserById(req.params.id);
  if (!editor || editor.role !== 'editor') return res.status(404).json({ message: 'That editor is not available.' });
  if (req.user.role !== 'client') return res.status(403).json({ message: 'Only client accounts can connect with an editor.' });

  const myBrief = projects.filter((project) => project.clientId === req.user.id)[0] || null;
  const score = scorePair(req.user, myBrief, editor);
  const existing = connectionFor(req.user.id, editor.id);

  if (existing) {
    existing.status = 'connected';
    existing.score = Math.max(existing.score, score);
    existing.updatedAt = nowIso();
    existing.history.unshift({ label: 'Direct connect', detail: `${req.user.name} connected directly with ${editor.name}.`, at: nowIso() });
  } else {
    connectPair(req.user, editor, myBrief, score, 'client');
  }

  notify(editor.id, 'connection', 'Client connected', `${req.user.name} wants to work with you. Phone: ${req.user.phone || 'shared in dashboard'}.`);
  notify(req.user.id, 'connection', 'Editor connected', `${editor.name} is now linked to your brief. Phone: ${editor.phone || 'shared in dashboard'}.`);
  const mine = connectionsFor(req.user.id);
  return res.status(201).json({ data: { connection: mine.find((item) => item.partner.name === editor.name) || mine[0] || null, connections: mine }, created: !existing, message: `Connecting to ${editor.name}` });
});

app.post('/api/connect/contact',
  requireUser,
  validate(
    z.object({
      phone: phoneShape.optional().or(z.literal('')),
      instagram: z.string().trim().optional().or(z.literal(''))
    }),
    'body'
  ),
  (req, res) => {
    if (!req.user.role || !req.user.onboardingComplete) {
      return res.status(403).json({ message: 'Finish onboarding before auto-connecting with a mobile number or Instagram handle.' });
    }

    const wanted = contactIdentifier(req.body);
    if (!wanted.phone && !wanted.instagram) {
      return res.status(422).json({ message: 'Enter a mobile number or an Instagram handle to auto-connect.' });
    }

    const result = autoConnectByContact(req.user, req.body);
    if (!result) {
      const counterpartRole = req.user.role === 'editor' ? 'client' : 'editor';
      return res.status(404).json({ message: `No ${counterpartRole} account is registered with that ${wanted.phone ? 'mobile number' : 'Instagram handle'} yet.` });
    }

    return res.status(201).json({
      data: { connection: result.connection, connections: result.connections },
      created: result.created,
      message: `Connecting to ${result.partner.name}`
    });
  }
);

app.get('/api/stats', (req, res) => res.json({ data: { editors: registeredEditors().length, clients: [...users.values()].filter((user) => user.role === 'client').length, projects: projects.filter((project) => project.status !== 'Closed').length, connections: connections.filter((item) => item.status === 'connected').length, accounts: users.size } }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('Unexpected app error:', error);
  return res.status(500).json({ message: 'An unexpected server error occurred.' });
});

server.listen(PORT, () => {
  console.log(`mesteoz running on http://localhost:${PORT}`);
});
