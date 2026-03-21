const timetableHandler = require('./timetable');

// Parse lesson text (same logic as frontend) server-side
function parseSL(l) {
  let s = l, r = '', d = 0, re = -1, rs = -1;
  for (let i = l.length - 1; i >= 0; i--) {
    if (l[i] === ')') { if (re === -1) re = i; d++; }
    else if (l[i] === '(') { d--; if (d === 0) { rs = i; break; } }
  }
  if (rs > 0 && re > rs) {
    const inside = l.substring(rs + 1, re);
    if (/\d|מעבדת|חדר|אולם|מגרש|ספריה|הקבצה|מקוון/.test(inside)) {
      r = inside; s = l.substring(0, rs).trim();
    }
  }
  return { subject: s, room: r };
}

function looksLikeTeacher(l) {
  if (!l || l.startsWith('[')) return false;
  if (l.split(/\s+/).length > 5) return false;
  if (/\(\s*\d/.test(l)) return false;
  if (/\d{3}/.test(l)) return false;
  if (/מעבדת|חדר|אולם|מגרש|ספריה|הקבצה|מקוון/.test(l)) return false;
  return true;
}

function parseLessons(text) {
  if (!text || !text.trim()) return [];
  let changeType = null;
  if (text.startsWith('[ביטול]')) { changeType = 'cancelled'; text = text.substring(7).trim(); }
  else if (text.startsWith('[החלפה]')) { changeType = 'changed'; text = text.substring(7).trim(); }
  else if (text.startsWith('[מבחן]')) { changeType = 'exam'; text = text.substring(6).trim(); }
  else if (text.startsWith('[אירוע]')) { changeType = 'event'; text = text.substring(7).trim(); }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  if (changeType) {
    return [{ subject: lines[0] || '', teacher: lines.length > 1 ? lines[1] : '', room: '', type: changeType }];
  }

  const groups = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    const p = parseSL(cur);

    let type = 'regular';
    if (p.subject.includes('ארוחת צהרים')) type = 'break';
    else if (p.subject.includes('מסדר')) type = 'formation';
    else if (p.subject.includes('חינוך גופני')) type = 'pe';

    if (next && looksLikeTeacher(next)) {
      groups.push({ subject: p.subject, teacher: next, room: p.room, type });
      i += 2;
    } else {
      groups.push({ subject: p.subject, teacher: '', room: p.room, type });
      i++;
    }
  }
  return groups.length ? groups : [{ subject: lines[0], teacher: '', room: '', type: 'regular' }];
}

const HOURS = [
  { start: "08:00", end: "08:15" }, { start: "08:15", end: "09:00" },
  { start: "09:00", end: "09:45" }, { start: "09:55", end: "10:45" },
  { start: "11:00", end: "11:45" }, { start: "11:55", end: "12:40" },
  { start: "12:50", end: "13:35" }, { start: "13:45", end: "14:25" },
  { start: "14:40", end: "15:20" }, { start: "15:30", end: "16:10" },
  { start: "16:20", end: "17:00" }, { start: "17:05", end: "17:45" }
];

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const classId = req.query.classId || '1';
  const view = req.query.view || 'TimeTable';
  const week = parseInt(req.query.week) || 0;

  // Filters
  const dayFilter = req.query.day !== undefined ? parseInt(req.query.day) : null; // 0=sunday, 1=monday...
  const hourFilter = req.query.hour !== undefined ? parseInt(req.query.hour) : null; // 0-11
  const fieldFilter = req.query.fields; // comma-separated: subject,teacher,room,type
  const searchQuery = req.query.search; // search in subject/teacher names

  // Use the timetable handler internally by creating a mock req/res
  const mockReq = { method: 'GET', query: { classId, view, week: String(week), flush: req.query.flush } };
  let rawData = null;
  const mockRes = {
    setHeader: () => {},
    status: () => ({ end: () => {}, json: (d) => { rawData = d; } }),
    json: (d) => { rawData = d; }
  };

  await timetableHandler(mockReq, mockRes);

  if (!rawData || rawData.error) {
    return res.status(500).json({ error: rawData?.error || 'Failed to fetch timetable' });
  }

  // Parse all lessons into structured format
  const structured = [];

  if (rawData.days && rawData.days.length) {
    rawData.days.forEach((day, dayIdx) => {
      if (!day.name) return;
      if (dayFilter !== null && dayIdx !== dayFilter) return;

      const maxH = Math.min(day.lessons.length, 12);
      for (let h = 0; h < maxH; h++) {
        if (hourFilter !== null && h !== hourFilter) continue;
        
        const lessonText = day.lessons[h];
        if (!lessonText) continue;

        const groups = parseLessons(lessonText);
        groups.forEach((g, groupIdx) => {
          const entry = {
            day: dayIdx,
            dayName: day.name,
            date: day.date,
            hour: h,
            hourStart: HOURS[h]?.start || '',
            hourEnd: HOURS[h]?.end || '',
            subject: g.subject,
            teacher: g.teacher,
            room: g.room,
            type: g.type,
            groupIndex: groupIdx,
            totalGroups: groups.length
          };

          // Search filter
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const match = entry.subject.toLowerCase().includes(q) ||
                          entry.teacher.toLowerCase().includes(q) ||
                          entry.room.toLowerCase().includes(q);
            if (!match) return;
          }

          structured.push(entry);
        });
      }
    });
  }

  // Handle list views (changes, exams, etc.)
  if (rawData.changes && rawData.changes.length) {
    rawData.changes.forEach(c => {
      structured.push({
        date: c.date,
        hour: c.hour,
        type: c.type,
        teacher: c.teacher,
        raw: c.raw
      });
    });
  }

  // Apply field filter
  let result = structured;
  if (fieldFilter) {
    const fields = fieldFilter.split(',').map(f => f.trim());
    result = structured.map(entry => {
      const filtered = {};
      fields.forEach(f => { if (entry[f] !== undefined) filtered[f] = entry[f]; });
      return filtered;
    });
  }

  res.json({
    classId,
    view,
    week,
    filters: {
      day: dayFilter,
      hour: hourFilter,
      fields: fieldFilter || null,
      search: searchQuery || null
    },
    updateTime: rawData.updateTime || '',
    total: result.length,
    lessons: result
  });
};
