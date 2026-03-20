const https = require('https');
const { URL } = require('url');

const SCHOOL_ID = '670810';
const SCREEN_ID = '5339';
const BASE_URL = `https://view.shahaf.info/${SCHOOL_ID}/0/${SCREEN_ID}`;

// In-memory cache (persists within the same serverless instance)
let cache = {};
const CACHE_TTL = 2 * 60 * 1000;

function fetchPage(url, postData = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname, path: parsed.pathname + parsed.search,
      method: postData ? 'POST' : 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Cookie': cookies }
    };
    if (postData) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request(options, (res) => {
      let data = '';
      const ck = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ body: data, cookies: ck }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

function extractFormFields(html) {
  const fields = {};
  let m;
  const r1 = /<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"/gi;
  const r2 = /<input[^>]*value="([^"]*)"[^>]*name="([^"]*)"/gi;
  while ((m = r1.exec(html)) !== null) fields[m[1]] = m[2];
  while ((m = r2.exec(html)) !== null) if (!fields[m[2]]) fields[m[2]] = m[1];
  return fields;
}

function buildPostData(fields, extra) {
  return Object.entries({ ...fields, ...extra })
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v || '')).join('&');
}

function cleanHtml(text) {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<div[^>]*>/gi, '\n').replace(/<\/div>/gi, '')
    .replace(/<b>/gi, '').replace(/<\/b>/gi, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n\s*\n/g, '\n').trim();
}

function parseSimpleTTTable(html) {
  const data = { days: [], hours: 0 };
  const tableMatch = html.match(/<table[^>]*class="TTTable"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return data;
  const tableHTML = tableMatch[1];
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) cells.push(cleanHtml(cellMatch[1]));
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return data;
  const headerRow = rows[0], numDays = headerRow.length - 1;
  const today = new Date();
  const todayStr = `${today.getDate().toString().padStart(2,'0')}.${(today.getMonth()+1).toString().padStart(2,'0')}`;
  for (let d = 1; d <= numDays; d++) {
    const dayText = (headerRow[d]||'').trim(), dateMatch = dayText.match(/(\d{2}\.\d{2})/);
    data.days.push({ name: dayText.replace(/\d{2}\.\d{2}/,'').trim(), date: dateMatch?dateMatch[1]:'', isToday: dateMatch?dateMatch[1]===todayStr:false, lessons: [] });
  }
  for (let r = 1; r < rows.length; r++) for (let d = 0; d < numDays; d++) data.days[d].lessons.push(d+1<rows[r].length?rows[r][d+1]:'');
  data.hours = rows.length - 1;
  return data;
}

function parseChangesTableView(html) {
  const data = { days: [], hours: 0 };
  const tableMatch = html.match(/<table[^>]*class="TTTable"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return data;
  const today = new Date();
  const todayStr = `${today.getDate().toString().padStart(2,'0')}.${(today.getMonth()+1).toString().padStart(2,'0')}`;
  const ctitles = [...html.matchAll(/<td[^>]*class="CTitle"[^>]*>([\s\S]*?)<\/td>/gi)];
  if (!ctitles.length) return data;
  const numDays = ctitles.length;
  for (const ct of ctitles) {
    const dayText = cleanHtml(ct[1]), dateMatch = dayText.match(/(\d{2}\.\d{2})/);
    data.days.push({ name: dayText.replace(/\d{2}\.\d{2}/,'').trim(), date: dateMatch?dateMatch[1]:'', isToday: dateMatch?dateMatch[1]===todayStr:false, lessons: [] });
  }
  const cnameRegex = /<td[^>]*class="CName"[^>]*>/gi;
  const cnamePositions = [];
  let cnm;
  while ((cnm = cnameRegex.exec(html)) !== null) cnamePositions.push(cnm.index);
  data.hours = cnamePositions.length;
  for (let h = 0; h < cnamePositions.length; h++) {
    const startPos = cnamePositions[h];
    const endPos = h+1 < cnamePositions.length ? cnamePositions[h+1] : html.length;
    const hourSection = html.substring(startPos, endPos);
    const ttcells = [...hourSection.matchAll(/<td[^>]*class="TTCell"[^>]*>([\s\S]*?)(?=<td[^>]*class="(?:TTCell|CName)"|$)/gi)];
    for (let d = 0; d < numDays; d++) {
      if (d < ttcells.length) {
        const cellContent = ttcells[d][1];
        const lessons = [...cellContent.matchAll(/<div[^>]*class="TTLesson"[^>]*>([\s\S]*?)<\/div>/gi)];
        let lessonTexts = lessons.map(l => cleanHtml(l[1])).filter(Boolean);
        const freeChange = cellContent.match(/leFreeChange[^>]*>([\s\S]*?)<\/td>/i);
        const illChange = cellContent.match(/illChange[^>]*>([\s\S]*?)<\/td>/i);
        let changeMarker = '';
        if (freeChange) changeMarker = '❌ ' + cleanHtml(freeChange[1]);
        else if (illChange) changeMarker = '🔄 ' + cleanHtml(illChange[1]);
        let cellText = lessonTexts.join('\n');
        if (changeMarker) cellText = changeMarker + (cellText ? '\n' + cellText : '');
        data.days[d].lessons.push(cellText);
      } else data.days[d].lessons.push('');
    }
  }
  return data;
}

function parseMsgCells(html) {
  const items = [];
  const regex = /<td[^>]*class="MsgCell"[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let text = cleanHtml(match[1]);
    if (!text) continue;
    const parts = text.split(',').map(s => s.trim());
    let date = parts[0]||'', hour = '', teacher = '', type = '';
    const hourPart = parts.find(p => p.includes('שיעור'));
    if (hourPart) { const hm = hourPart.match(/(\d+)/); hour = hm?hm[1]:''; }
    type = parts[parts.length-1]||'';
    const hourIdx = parts.indexOf(hourPart);
    if (hourIdx >= 0) teacher = parts.slice(hourIdx+1, parts.length-1).join(', ');
    items.push({ date, hour, teacher, type, raw: text });
  }
  return items;
}

function parseEvents(html) {
  const items = [];
  const regex = /<td[^>]*class="MsgCell"[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let text = cleanHtml(match[1]);
    if (!text) continue;
    const dateMatch = text.match(/^(\d{2}\.\d{2}\.\d{4})/);
    const date = dateMatch?dateMatch[1]:'';
    let rest = dateMatch?text.substring(date.length).replace(/^,\s*/,''):text;
    let hourRange = '';
    const hrm = rest.match(/משיעור\s*(\d+)\s*עד\s*שיעור\s*(\d+)/);
    if (hrm) hourRange = `${hrm[1]}-${hrm[2]}`;
    let eventName = rest.split(/משיעור|לכיתות/)[0].trim();
    let classes = '';
    const cm = rest.match(/לכיתות:\s*(.*)/);
    if (cm) classes = cm[1].trim();
    items.push({ date, hour: hourRange, type: eventName, teacher: classes?'כיתות: '+classes:'', raw: text });
  }
  return items;
}

function parseResponse(html, view) {
  const result = { days: [], hours: 0, changes: [], updateTime: '' };
  const um = html.match(/מעודכן ל:\s*([^,]+),\s*שעה:\s*([^,<]+)/);
  if (um) result.updateTime = `${um[1].trim()} ${um[2].trim()}`;
  if (view === 'TimeTable') { const d = parseSimpleTTTable(html); result.days = d.days; result.hours = d.hours; }
  else if (view === 'ChangesTable') { const d = parseChangesTableView(html); result.days = d.days; result.hours = d.hours; }
  else if (view === 'Events') result.changes = parseEvents(html);
  else result.changes = parseMsgCells(html);
  return result;
}

async function fetchTimetable(classId, view) {
  const r1 = await fetchPage(BASE_URL);
  const f1 = extractFormFields(r1.body);
  const pd1 = buildPostData(f1, { '__EVENTTARGET':'TimeTableView1$ClassesList', '__EVENTARGUMENT':'', 'TimeTableView1$ClassesList':classId });
  const r2 = await fetchPage(BASE_URL, pd1, r1.cookies);
  const f2 = extractFormFields(r2.body);
  const viewTargets = { TimeTable:'TimeTableView1$btnTimeTable', ChangesTable:'TimeTableView1$btnChangesTable', Changes:'TimeTableView1$btnChanges', Exams:'TimeTableView1$btnExams', Messages:'TimeTableView1$btnMessages', Events:'TimeTableView1$btnEvents' };
  const pd2 = buildPostData(f2, { '__EVENTTARGET':viewTargets[view]||viewTargets.TimeTable, '__EVENTARGUMENT':'', 'TimeTableView1$ClassesList':classId });
  const r3 = await fetchPage(BASE_URL, pd2, r2.cookies||r1.cookies);
  return r3.body;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const classId = req.query.classId || '1';
  const view = req.query.view || 'TimeTable';
  const cacheKey = `${classId}_${view}`;

  if (cache[cacheKey] && Date.now() - cache[cacheKey].time < CACHE_TTL) {
    return res.json(cache[cacheKey].data);
  }

  try {
    const html = await fetchTimetable(classId, view);
    const data = parseResponse(html, view);
    cache[cacheKey] = { data, time: Date.now() };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
