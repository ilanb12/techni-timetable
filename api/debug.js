const https = require('https');
const { URL } = require('url');

const SCHOOL_ID = '670810';
const SCREEN_ID = '5339';
const BASE_URL = `https://view.shahaf.info/${SCHOOL_ID}/0/${SCREEN_ID}`;

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
    if (postData) req.write(postData);
    req.end();
  });
}

function extractFormFields(html) {
  const fields = {};
  const regex = /<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"/gi;
  let match;
  while ((match = regex.exec(html)) !== null) fields[match[1]] = match[2];
  return fields;
}

function buildPostData(fields, overrides) {
  return Object.entries({ ...fields, ...overrides })
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v || ''))
    .join('&');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const classId = req.query.classId || '4';
  const week = parseInt(req.query.week) || 0;
  
  try {
    const r1 = await fetchPage(BASE_URL);
    const f1 = extractFormFields(r1.body);
    const r2 = await fetchPage(BASE_URL, buildPostData(f1, {
      '__EVENTTARGET': 'TimeTableView1$ClassesList',
      '__EVENTARGUMENT': '',
      'TimeTableView1$ClassesList': classId
    }), r1.cookies);
    const f2 = extractFormFields(r2.body);
    let r3 = await fetchPage(BASE_URL, buildPostData(f2, {
      '__EVENTTARGET': 'TimeTableView1$btnChangesTable',
      '__EVENTARGUMENT': '',
      'TimeTableView1$ClassesList': classId
    }), r2.cookies || r1.cookies);
    
    // Navigate weeks
    let cookies = r3.cookies || r2.cookies || r1.cookies;
    const target = week > 0 ? 'TimeTableView1$MainControl$LinkButton1' : 'TimeTableView1$MainControl$prevweek';
    for (let i = 0; i < Math.abs(week); i++) {
      const fi = extractFormFields(r3.body);
      r3 = await fetchPage(BASE_URL, buildPostData(fi, {
        '__EVENTTARGET': target,
        '__EVENTARGUMENT': '',
        'TimeTableView1$ClassesList': classId
      }), cookies);
      cookies = r3.cookies || cookies;
    }
    
    const html = r3.body;
    
    // Find all FillChange cells with full context
    const results = [];
    const ttcells = [...html.matchAll(/<td[^>]*class="TTCell"[^>]*>([\s\S]*?)(?=<td[^>]*class="(?:TTCell|CName)"|$)/gi)];
    ttcells.forEach((m, i) => {
      if (m[1].includes('FillChange')) {
        const fillMatch = m[1].match(/FillChange[^>]*>([\s\S]*?)<\/td>/i);
        results.push({
          cellIndex: i,
          rawFillChangeHtml: fillMatch ? fillMatch[1] : 'NOT FOUND',
          rawFillChangeTd: fillMatch ? fillMatch[0].substring(0, 300) : 'NOT FOUND',
          hasTTLesson: m[1].includes('TTLesson'),
          fullCell: m[1].substring(0, 500)
        });
      }
    });
    
    res.json({ classId, week, fillChanges: results, totalTTCells: ttcells.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
