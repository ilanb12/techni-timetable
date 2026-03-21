module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const hours = [
    {index: 0, start: "08:00", end: "08:15"},
    {index: 1, start: "08:15", end: "09:00"},
    {index: 2, start: "09:00", end: "09:45"},
    {index: 3, start: "09:55", end: "10:45"},
    {index: 4, start: "11:00", end: "11:45"},
    {index: 5, start: "11:55", end: "12:40"},
    {index: 6, start: "12:50", end: "13:35"},
    {index: 7, start: "13:45", end: "14:25"},
    {index: 8, start: "14:40", end: "15:20"},
    {index: 9, start: "15:30", end: "16:10"},
    {index: 10, start: "16:20", end: "17:00"},
    {index: 11, start: "17:05", end: "17:45"}
  ];

  res.json({ hours, total: hours.length });
};
