# מערכת שעות — המכללה הטכנולוגית של חיל האוויר

A custom timetable display for the Air Force Technological College (Beer Sheva), powered by data from the Shahaf (שחף) timetable system.

## Features

- 📅 Full weekly timetable with all study groups (הקבצות)
- 🔄 Live changes view (מערכת ושינויים) with cancellation/substitution markers
- 📋 Changes, exams, messages, and events tabs
- 🌙 Dark theme, RTL Hebrew, mobile-optimized
- 📱 PWA support — add to home screen on iPhone/Android
- ⚡ Auto-refresh every 5 minutes
- 🕐 Current hour highlighting
- 🖨️ Print to a one-page landscape PDF

## Architecture

- **Frontend**: Static HTML/CSS/JS in `public/`
- **Backend**: Vercel serverless functions in `api/`
- The backend scrapes `techni-bs.shahaf.site` and normalises it to JSON
- Results are cached for 2 minutes

### Upstream

Shahaf moved this school off the old WebForms viewer (`view.shahaf.info`, which needed
a 3-step `__VIEWSTATE` postback handshake plus one postback per week of navigation) onto
a stateless ASP.NET Core site. Every view is now a single GET:

```
https://techni-bs.shahaf.site/?cls=<classId>&tab=<tab>&week=<offset>
```

The new markup also separates each lesson into subject / room / teacher
(`<div class="TTLesson"><b>subject</b>&nbsp;(room)<br/>teacher</div>`), and flags
changed cells with a class — `TableFreeChange` (cancellation), `TableFillChange`
(substitution), `TableEventChange` (event). The scraper reads those directly, so
none of the three fields has to be inferred from a text blob any more.

## API

```
GET /api/timetable?classId=1&view=TimeTable
GET /api/lesson?classId=1&day=1&hour=3     # structured + filterable
GET /api/classes                            # read live from Shahaf, static fallback
GET /api/hours
```

**Views:** `TimeTable`, `ChangesTable`, `Changes`, `Exams`, `Messages`, `Events`

`days[].lessons` is an array with one slot per hour (aligned to `hourTimes`); each slot
is an array of `{subject, teacher, room, type}` — one entry per study group. See
`public/api-docs.html` for the full reference.

## Deployment

Deployed on Vercel. Push to `main` to auto-deploy.

## Local Development

```bash
npm i -g vercel
vercel dev
```

Opens on `http://localhost:3000`.
