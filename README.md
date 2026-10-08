# マルのちずマスター – Maru's Map Mastery

A small, dependency-free browser game for learning the Japanese names of Japan's
regions, prefectures, major cities and famous landmarks. Instructions are in
Japanese with small English subtitles, and **Maru** the mascot cheers (or cries)
at your answers.

## Play

Open `index.html` in a browser – no build step or server needed.
(Or run any static server, e.g. `python3 -m http.server`.)

## Modes

| Mode | Content |
| --- | --- |
| 地方 Regions | 8 regions |
| 都道府県 Prefectures | all 47 |
| 都市 Cities | 48 major cities |
| 名所 Landmarks | 45 famous sights |
| ぜんぶ Everything | a mix of all of the above |
| にがて Weak spots | items you've got wrong more than right |

Question styles: **find it on the map** (tap the region / prefecture / marker),
**name what is shown** (4 choices for the glowing item) or a mix.
Wrong answers are remembered (in `localStorage`) and come up more often.
The map zooms with the wheel / pinch / buttons and pans by dragging.
A **study mode** lets you explore the map, toggle city/landmark markers and
tap anything for its reading and English name. ふりがな and English hints can be
toggled in the header.

## Project layout

- `index.html`, `css/style.css` – UI
- `js/mapview.js` – zoomable SVG map (prefecture paths, markers, effects)
- `js/game.js` – quiz logic, scoring, study mode
- `js/data.js` – regions, prefectures, cities, landmarks (edit this to add more!)
- `js/mapdata.js` – generated simplified SVG paths (Okinawa is drawn in an inset box)
- `assets/maru-happy.svg`, `assets/maru-sad.svg` – the mascot
- `tools/build_map.py` – regenerates `js/mapdata.js` from a prefecture GeoJSON

Map outlines come from [dataofjapan/land](https://github.com/dataofjapan/land).

To add a city or landmark, append a row to `CITY_ROWS` / `LANDMARK_ROWS` in
`js/data.js` as `[日本語, よみ, English, lat, lon, prefectureId, note]`.
