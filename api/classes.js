module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const classes = [
    {id:"1",name:"ט - 1"},{id:"2",name:"ט - 2"},{id:"3",name:"ט - 3"},{id:"4",name:"ט - 4"},
    {id:"5",name:"ט - 5"},{id:"6",name:"ט - 6"},{id:"46",name:"ט - 7"},{id:"54",name:"ט - 8"},
    {id:"57",name:"י - 1 תוכנה"},{id:"11",name:"י - 2 אלק'"},{id:"13",name:"י - 3 חשמל"},
    {id:"14",name:"י - 4 חשמל"},{id:"15",name:"י - 5 חשמל"},{id:"16",name:"י - 6 מכטרוניקה"},
    {id:"47",name:"י - 7 תעופה"},{id:"48",name:"י - 8 תעופה"},
    {id:"19",name:"יא-1 תוכנה"},{id:"20",name:"יא - 2 אלק'"},{id:"21",name:"יא - 3 חשמל"},
    {id:"22",name:"יא - 4 חשמל"},{id:"23",name:"יא - 5 חשמל"},{id:"24",name:"יא - 6 מכטרוניקה"},
    {id:"50",name:"יא - 7 תעופה"},{id:"51",name:"יא - 8 תעופה"},
    {id:"59",name:"יב-1 תעופה"},{id:"30",name:"יב - 2 תעופה"},{id:"31",name:"יב - 3 תעופה"},
    {id:"32",name:"יב - 4 מכטרוניקה"},{id:"33",name:"יב - 5 חשמל"},{id:"34",name:"יב - 6 חשמל"},
    {id:"52",name:"יב - 7 אלק'"},{id:"53",name:"יב - 8 תוכנה"},
    {id:"39",name:"יג-1 אלק'"},{id:"40",name:"יג-2 חשמל"},{id:"41",name:"יג-3 תעופה"},
    {id:"55",name:"יג-3 מכטרוניקה"},
    {id:"43",name:"יד-1 אלק'"},{id:"44",name:"יד-2 חשמל"},{id:"45",name:"יד-3 תעופה"},
    {id:"56",name:"יד-3 מכטרוניקה"}
  ];

  res.json({ classes, total: classes.length });
};
