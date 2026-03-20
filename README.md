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

## Architecture

- **Frontend**: Static HTML/CSS/JS in `public/`
- **Backend**: Vercel serverless function in `api/timetable.js`
- The backend scrapes `view.shahaf.info` using ASP.NET postback simulation (3-step: GET → POST class → POST view)
- Results are cached for 2 minutes

## Deployment

Deployed on Vercel. Push to `main` to auto-deploy.

## API

```
GET /api/timetable?classId=1&view=TimeTable
```

**Views:** `TimeTable`, `ChangesTable`, `Changes`, `Exams`, `Messages`, `Events`

**Class IDs:** See `public/index.html` for the full list.

## Local Development

```bash
npm i -g vercel
vercel dev
```

Opens on `http://localhost:3000`.
