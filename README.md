# Focus Nest

A calm Pomodoro focus companion with a single lo-fi soundtrack, cookie-backed timer restore, and settings for durations and music.

## How to run

```bash
python -m http.server 5500
```

Open [http://localhost:5500](http://localhost:5500).

## What’s included

- Focus / short break / long break with Start, Pause, Reset
- Countdown from an **end timestamp** (accurate after tab throttling)
- **Session cookie** (`fn_session_v1`) restores mode, remaining time, running/paused state, and completed focus count across refreshes
- Preferences in `localStorage`: durations, selected track, mute, volume, repeat
- One lo-fi track at a time (switching stops the previous track)
- Header: mute + settings only
- Track picker, volume, and repeat live in Settings
- No autoplay after refresh — a one-click **Resume music** prompt when needed

## Project structure

```
├── index.html
├── styles.css
├── script.js
├── README.md
└── assets/audio/          ← lo-fi MP3s + license notes
```

## Cookies vs localStorage

| Data | Storage | Why |
|------|---------|-----|
| Timer mode, phase, remaining / end timestamp, session count | Cookie `fn_session_v1` (7-day expiry) | Compact session restore as requested |
| Durations, track, mute, volume, repeat | `localStorage` | Larger prefs; keeps the cookie small |

The cookie is versioned (`v: 1`). Invalid cookies fall back to a fresh idle focus session.

## Lo-fi audio

Real Mixkit MP3s are included. See [`assets/audio/README.md`](assets/audio/README.md) for filenames, artists, and license links.

## Fonts & icons

- **Space Grotesk** — headings and timer digits  
- **Sora** — body and UI text  
- **Font Awesome 6** — every icon  
