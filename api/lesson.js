const timetableHandler = require('./timetable');

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

// Call the timetable handler in-process so this endpoint shares its cache.
function loadTimetable(query) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (data) => { if (!settled) { settled = true; resolve(data); } };
    const mockRes = {
      setHeader: () => {},
      status: () => ({ end: () => finish(null), json: finish }),
      json: finish
    };
    timetableHandler({ method: 'GET', query }, mockRes).then(() => finish(null), reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const classId = req.query.classId || '1';
  const view = req.query.view || 'TimeTable';
  const week = parseInt(req.query.week) || 0;

  const dayFilter = req.query.day !== undefined ? parseInt(req.query.day) : null;
  const hourFilter = req.query.hour !== undefined ? parseInt(req.query.hour) : null;
  const typeFilter = req.query.type || null;
  const fieldFilter = req.query.fields;
  const searchQuery = req.query.search;

  let raw;
  try {
    raw = await loadTimetable({ classId, view, week: String(week), flush: req.query.flush });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!raw || raw.error) {
    return res.status(500).json({ error: (raw && raw.error) || 'Failed to fetch timetable' });
  }

  const structured = [];

  // The timetable endpoint already returns one structured object per lesson, so
  // this only has to flatten the day/hour grid and apply the filters.
  (raw.days || []).forEach((day, dayIdx) => {
    if (!day.name) return;
    if (dayFilter !== null && dayIdx !== dayFilter) return;

    day.lessons.forEach((slot, slotIdx) => {
      const time = (raw.hourTimes || [])[slotIdx] || {};
      const hour = time.index !== undefined ? time.index : slotIdx;
      if (hourFilter !== null && hour !== hourFilter) return;

      slot.forEach((lesson, groupIndex) => {
        structured.push({
          day: dayIdx,
          dayName: day.name || DAY_NAMES[dayIdx] || '',
          date: day.date,
          hour,
          hourStart: time.start || '',
          hourEnd: time.end || '',
          subject: lesson.subject,
          teacher: lesson.teacher,
          room: lesson.room,
          type: lesson.type,
          original: lesson.original || '',
          substitute: lesson.substitute || '',
          groupIndex,
          totalGroups: slot.length
        });
      });
    });
  });

  (raw.changes || []).forEach(c => {
    structured.push({ date: c.date, hour: c.hour, type: c.type, teacher: c.teacher, room: c.room || '', raw: c.raw });
  });

  let result = structured;
  if (typeFilter) {
    const wanted = typeFilter.split(',').map(t => t.trim());
    result = result.filter(e => wanted.includes(e.type));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(e => ['subject', 'teacher', 'room'].some(
      f => (e[f] || '').toLowerCase().includes(q)
    ));
  }
  if (fieldFilter) {
    const fields = fieldFilter.split(',').map(f => f.trim());
    result = result.map(entry => {
      const filtered = {};
      fields.forEach(f => { if (entry[f] !== undefined) filtered[f] = entry[f]; });
      return filtered;
    });
  }

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.json({
    classId,
    view,
    week,
    filters: {
      day: dayFilter,
      hour: hourFilter,
      type: typeFilter,
      fields: fieldFilter || null,
      search: searchQuery || null
    },
    updateTime: raw.updateTime || '',
    total: result.length,
    lessons: result
  });
};
