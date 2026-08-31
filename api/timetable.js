const https = require('https');

// Shahaf moved this school off the old WebForms viewer (view.shahaf.info, driven by
// __VIEWSTATE postbacks) onto a stateless ASP.NET Core site: every view is a plain
// GET with query-string state, so one request replaces the old 3-step handshake and
// the per-week postback loop.
const BASE_URL = 'https://techni-bs.shahaf.site/';

// Public view name -> the site's ?tab= value. The public names are kept from the
// previous API so existing clients keep working.
const VIEW_TABS = {
  TimeTable: 'timetable',
  ChangesTable: 'changestable',
  Changes: 'changes',
  Exams: 'exams',
  Messages: 'messages',
  Events: 'events'
};
const GRID_VIEWS = ['TimeTable', 'ChangesTable'];

// The grid marks a changed cell with a modifier class next to .TTChange.
const CHANGE_TYPES = {
  TableFreeChange: 'cancelled',
  TableFillChange: 'changed',
  TableEventChange: 'event',
  TableExamChange: 'exam'
};

// In-memory cache (persists within the same serverless instance)
let cache = {};
const CACHE_TTL = 2 * 60 * 1000;

function fetchPage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; techni-timetable)',
        'Accept': 'text/html'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) return reject(new Error('Too many redirects'));
        return resolve(fetchPage(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('Upstream returned HTTP ' + res.statusCode));
      }
      // Buffer the chunks instead of concatenating strings: a chunk boundary can
      // fall inside a multi-byte Hebrew character, which string concatenation
      // would turn into U+FFFD.
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Upstream timeout')));
  });
}

const NAMED_ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(nbsp|amp|quot|apos|lt|gt);/gi, (_, n) => NAMED_ENTITIES[n.toLowerCase()]);
}

// Strip tags first, then decode — decoding first would turn the site's escaped
// "&lt;-" substitution arrow into "<-" and the tag stripper would eat it.
function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function todayShort() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Pull a trailing room off a name, e.g. "מבוא לתכנות 421 - (ט'4)" -> "421 (ט'4)".
function splitRoom(s) {
  const m = s.match(/\s*\b(\d{3,4})\b\s*(?:[-–]\s*)?(\([^)]*\))?\s*$/);
  if (!m || !m.index) return { name: s.trim(), room: '' };
  return { name: s.slice(0, m.index).trim(), room: (m[1] + ' ' + (m[2] || '')).trim() };
}

function classifySubject(s) {
  if (/ארוחת צהרים/.test(s)) return 'break';
  if (/מסדר/.test(s)) return 'formation';
  if (/חינוך גופני/.test(s)) return 'pe';
  return 'regular';
}

// A .TTLesson is "<b>subject</b>&nbsp;(room)<br/>teacher" — the site already
// separates the three fields, so none of them have to be guessed.
function parseLesson(inner) {
  const parts = inner.split(/<br\s*\/?>/i);
  const head = parts[0] || '';
  const teacher = text(parts.slice(1).join(' '));
  const bold = head.match(/<b>([\s\S]*?)<\/b>/i);
  const subject = bold ? text(bold[1]) : text(head);
  let room = bold ? text(head.replace(/<b>[\s\S]*?<\/b>/i, '')) : '';
  if (room.startsWith('(') && room.endsWith(')')) room = room.slice(1, -1).trim();
  if (!subject && !teacher && !room) return null;
  return { subject, teacher, room, type: classifySubject(subject) };
}

function parseChange(inner, type) {
  const raw = text(inner);

  if (type === 'cancelled') {
    // "ביטול <subject>, <teacher>"
    const body = raw.replace(/^ביטול\s*/, '');
    const i = body.lastIndexOf(',');
    return {
      subject: (i > 0 ? body.slice(0, i) : body).trim() || 'ביטול שיעור',
      teacher: i > 0 ? body.slice(i + 1).trim() : '',
      room: '',
      type
    };
  }

  if (type === 'changed') {
    // "<original> <- <substitute>[, <subject> <room>]"
    const arrow = raw.indexOf('<-');
    if (arrow < 0) return { subject: raw || 'מילוי מקום', teacher: '', room: '', type };
    const original = raw.slice(0, arrow).trim();
    const rest = raw.slice(arrow + 2).trim();
    const comma = rest.indexOf(',');
    let substitute = rest.trim();
    let subject = '';
    let room = '';
    if (comma > 0) {
      substitute = rest.slice(0, comma).trim();
      const split = splitRoom(rest.slice(comma + 1).trim());
      subject = split.name;
      room = split.room;
    }
    // The room sometimes rides on the substitute's name instead; teacher names
    // never contain digits, so a 3-4 digit run there is the room.
    if (!room) {
      const onName = splitRoom(substitute);
      if (onName.room) { room = onName.room; substitute = onName.name; }
    }
    return { subject: subject || 'מילוי מקום', teacher: substitute, room, original, substitute, type };
  }

  // event / exam: "<name>[, <room>]"
  const i = raw.lastIndexOf(',');
  return {
    subject: (i > 0 ? raw.slice(0, i) : raw).trim(),
    teacher: '',
    room: i > 0 ? raw.slice(i + 1).trim() : '',
    type
  };
}

function parseCell(cellHtml) {
  const out = [];
  const divRe = /<div[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = divRe.exec(cellHtml)) !== null) {
    const cls = m[1];
    if (/\bTTLesson\b/.test(cls)) {
      const lesson = parseLesson(m[2]);
      if (lesson) out.push(lesson);
    } else if (/\bTTChange\b/.test(cls)) {
      const key = Object.keys(CHANGE_TYPES).find(k => cls.includes(k));
      out.push(parseChange(m[2], CHANGE_TYPES[key] || 'changed'));
    }
  }
  return out;
}

function parseGrid(html) {
  const empty = { days: [], hours: 0, hourTimes: [] };
  const table = html.match(/<table[^>]*class="TTTable"[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return empty;
  const body = table[1];
  const today = todayShort();

  const days = [];
  const titleRe = /<td[^>]*class="CTitle"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = titleRe.exec(body)) !== null) {
    const label = text(m[1]);
    const date = (label.match(/(\d{2}\.\d{2})/) || [, ''])[1];
    days.push({
      name: label.replace(/\d{2}\.\d{2}/, '').trim(),
      date,
      isToday: date === today,
      lessons: []
    });
  }
  if (!days.length) return empty;

  const hourTimes = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((m = rowRe.exec(body)) !== null) {
    const row = m[1];
    // The header row carries an empty CName corner cell, so an hour row is
    // identified by having day cells, not merely by having a CName.
    const cname = row.match(/<td[^>]*class="CName"[^>]*>([\s\S]*?)<\/td>/i);
    if (!cname || !/class="TTCell"/.test(row)) continue;
    const num = cname[1].match(/(\d+)/);
    const times = [...cname[1].matchAll(/class="hour-time"[^>]*>([\d:]+)</gi)].map(t => t[1]);
    hourTimes.push({
      index: num ? parseInt(num[1], 10) : hourTimes.length,
      start: times[0] || '',
      end: times[1] || ''
    });

    // Open a slot per day first, so a day the row omits still stays aligned.
    days.forEach(d => d.lessons.push([]));

    const cellRe = /<td([^>]*class="TTCell"[^>]*)>([\s\S]*?)<\/td>/gi;
    let cell, seq = 0;
    while ((cell = cellRe.exec(row)) !== null) {
      const attr = cell[1].match(/data-day="(\d+)"/);
      const dayIdx = attr ? parseInt(attr[1], 10) : seq;
      seq++;
      if (dayIdx >= days.length) continue;
      const lessons = days[dayIdx].lessons;
      lessons[lessons.length - 1] = parseCell(cell[2]);
    }
  }

  return { days, hours: hourTimes.length, hourTimes };
}

function parseChangeItem(raw) {
  // "03.09.2026,  שיעור 3, להב עדי,  מילוי מקום מכמלי נתנאל"
  const parts = raw.split(',').map(s => s.trim());
  const hourIdx = parts.findIndex(p => /שיעור/.test(p));
  const hour = hourIdx >= 0 ? (parts[hourIdx].match(/(\d+)/) || [, ''])[1] : '';
  return {
    date: parts[0] || '',
    hour,
    teacher: hourIdx >= 0 ? parts.slice(hourIdx + 1, parts.length - 1).join(', ') : '',
    type: parts.length > 1 ? parts[parts.length - 1] : '',
    room: '',
    raw
  };
}

function parseEventItem(inner, raw) {
  // "01.09.2026, <b>name</b> שיעור 6 לכיתות: ט-1, ט-2, חדר: אולם ספורט"
  const range = raw.match(/משיעור\s*(\d+)\s*עד\s*שיעור\s*(\d+)/);
  const single = raw.match(/שיעור\s*(\d+)/);
  const classes = (raw.match(/לכיתות:\s*([\s\S]*?)(?:,\s*חדר:|$)/) || [, ''])[1].trim();
  const name = text((inner.match(/<b>([\s\S]*?)<\/b>/i) || [, ''])[1]);
  return {
    date: (raw.match(/^(\d{2}\.\d{2}\.\d{4})/) || [, ''])[1],
    hour: range ? `${range[1]}-${range[2]}` : (single ? single[1] : ''),
    teacher: classes ? 'כיתות: ' + classes : '',
    type: name || raw,
    room: (raw.match(/חדר:\s*(.+)$/) || [, ''])[1].trim(),
    raw
  };
}

function parseList(html, view) {
  const items = [];
  const liRe = /<li[^>]*class="[^"]*ChangesInfo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const raw = text(m[1]);
    if (!raw) continue;
    items.push(view === 'Events' ? parseEventItem(m[1], raw) : parseChangeItem(raw));
  }
  return items;
}

function parseResponse(html, view) {
  const result = { days: [], hours: 0, hourTimes: [], changes: [], updateTime: '' };
  const update = html.match(/מעודכן ל:\s*([^,<]+),\s*שעה:\s*([^,<]+)/);
  if (update) result.updateTime = `${update[1].trim()} ${update[2].trim()}`;

  if (GRID_VIEWS.includes(view)) Object.assign(result, parseGrid(html), { changes: [] });
  else result.changes = parseList(html, view);

  return result;
}

// Events already come back inside the grid as .TableEventChange, but exams do not,
// so they are folded in from the Exams list.
function mergeExams(data, exams) {
  if (!data.days.length || !exams.length) return data;
  const slotOf = new Map(data.hourTimes.map((h, i) => [h.index, i]));

  for (const item of exams) {
    if (!item.date || !item.hour) continue;
    const day = data.days.find(d => d.date === item.date.substring(0, 5));
    if (!day) continue;

    const bounds = String(item.hour).split('-').map(Number);
    const start = bounds[0];
    const end = bounds.length > 1 ? bounds[1] : start;
    if (isNaN(start) || isNaN(end)) continue;

    for (let h = start; h <= end; h++) {
      const slot = day.lessons[slotOf.get(h)];
      if (!slot || slot.some(l => l.type === 'exam')) continue;
      slot.unshift({
        subject: item.type || item.raw || 'מבחן',
        teacher: item.teacher || '',
        room: item.room || '',
        type: 'exam'
      });
    }
  }
  return data;
}

async function fetchView(classId, view, week) {
  const tab = VIEW_TABS[view] || VIEW_TABS.TimeTable;
  const url = `${BASE_URL}?cls=${encodeURIComponent(classId)}&tab=${tab}&week=${week}`;
  return fetchPage(url);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const classId = req.query.classId || '1';
  const view = VIEW_TABS[req.query.view] ? req.query.view : 'TimeTable';
  const week = parseInt(req.query.week) || 0;
  const cacheKey = `${classId}_${view}_w${week}`;

  if (!req.query.flush && cache[cacheKey] && Date.now() - cache[cacheKey].time < CACHE_TTL) {
    return res.json(cache[cacheKey].data);
  }

  try {
    const data = parseResponse(await fetchView(classId, view, week), view);
    data.classId = String(classId);
    data.view = view;
    data.week = week;

    if (view === 'ChangesTable') {
      try {
        mergeExams(data, parseList(await fetchView(classId, 'Exams', week), 'Exams'));
      } catch (mergeErr) {
        // A failed merge must not cost the caller the timetable itself.
        console.error('Exam merge error:', mergeErr.message);
      }
    }

    cache[cacheKey] = { data, time: Date.now() };
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// The class dropdown is rendered into every page, so any view will do.
function parseClasses(html) {
  const select = html.match(/<select[^>]*name="cls"[^>]*>([\s\S]*?)<\/select>/i);
  if (!select) return [];
  return [...select[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)]
    .map(m => ({ id: m[1], name: text(m[2]) }))
    .filter(c => c.name);
}

async function fetchClasses() {
  return parseClasses(await fetchPage(BASE_URL));
}

module.exports.parseResponse = parseResponse;
module.exports.parseClasses = parseClasses;
module.exports.fetchClasses = fetchClasses;
module.exports.VIEW_TABS = VIEW_TABS;
