# Booking Planner — System Guide

*Last updated: 2026-10-19 · Covers changes through commit `0b452d5`*

## What this is

Booking Planner is a shared web page where a small group books time on an app they share
(plogenius.com). It shows a rolling two-week planner with real dates. Everyone opens the same
link (https://tmje30.github.io/booking-planner/, pinned in Discord) and sees the same bookings
live. A companion browser add-on script also shows on plogenius.com itself whether the app is in
use, and handles starting, extending and ending a booked session.

## What it does (features)

### The planner page

- **Two weeks, starting today.** Week 1 is today plus the next 6 days (today is always the first
  column); week 2 is the 7 days after. Days roll forward automatically. Each day covers 24 hours
  in 15-minute steps, with a red "now" line in today's column. The page opens scrolled to it.
- **Users and colours.** Three fixed users, picked from a dropdown: Baby4Life, Tripplelift,
  Red.ElinGho. Each has their own colour.
- **Add a booking.** *How do I book?* Use the form: pick user, day, start and end time. If the
  end is earlier than the start, the booking ends the next day (the form shows "(next day)").
  Maximum length is 24 hours.
- **Move a booking.** Drag its block to another time or day; it snaps to 15 minutes. Press
  Escape while dragging to cancel. To move it to the other week, click it and change its day.
- **Copy a booking.** Hold **Ctrl** when you let go of a drag, or use **Copy** in the edit window,
  to make a new booking of the same length on another day.
- **Edit or delete.** Click a block to change its user, day or times, or delete it.
- **No double bookings.** A booking that clashes is blocked with a message like "Clashes with
  Tripplelift, 14:00–16:00". Back-to-back bookings are fine.
- **Across midnight.** A booking crossing midnight is drawn on both days with "↓ continues" /
  "↑ continued" markers, but it's still one booking.
- **Time zone switch.** "Copenhagen" or "Singapore". All times show in the chosen zone with a
  label (CEST / CET / SGT). Copenhagen follows real summer time. Each device remembers its own
  choice; first-time visitors get Singapore if their computer is in Singapore, else Copenhagen.
- **Old bookings clean themselves up.** A booking is deleted once it ended before the start of
  *yesterday* in Copenhagen time. This runs whenever anyone opens the page.
- **Live.** Changes show for everyone within a second or two, without refreshing.
- **"In use / Free" banner.** "🟢 In use: <name> · open since <time>", or after 3 minutes without
  a signal "⚪ Free · next booking: <name> at <time>".
- **Help.** A "?" button top-right opens short instructions.

### The plogenius helper (Tampermonkey script)

- **Status card on opening plogenius.** Shows who is using it, who has it booked now and the next
  booking. If it's free: "Book 1 hour & start", "Book 2 hours & start" (or "until the next
  booking" when that's shorter). If someone else is on it or has it booked: no start buttons. If
  it's your own booking: "Start (your booking until …)". Always: "Open full planner" and
  "Not now". The card refreshes every minute and when you switch to the window.
- **You only count as "in use" after starting.** While in use, it sends an "I'm still here"
  signal once a minute.
- **Booking end.** When your time runs out, a card shows who's next. If someone is booked right
  after you, you're logged out. Otherwise you can extend (1 h, 2 h or until the next booking) or
  log out; no answer in 10 minutes logs you out. Your own back-to-back booking just carries on.
- **Idle check.** After 40 minutes with no mouse, key or scroll activity in any plogenius window:
  "Still using plogenius?". No answer in 10 minutes **deletes the current booking** and logs you
  out. It notices only *that* something happened, not what.
- **No-show rule.** If a booking has started and its owner hasn't been on within 20 minutes, the
  first 2 hours are removed (the whole booking if it's 2 hours or less). The next part then gets
  only 10 minutes. Any user's helper can apply this, and database checks stop two helpers doing it
  twice.
- **Menu button.** Added after "VIP" in plogenius's menu: "⏻ Log out scheduler" marks plogenius
  free (it does not log you out of plogenius) or "▶ Start scheduler" opens the card.
- **Clash-safe clicks.** Countdowns use the real clock, and Extend / Book re-check the planner at
  the moment you click; if the time was taken meanwhile, a fresh card is shown.

## How it fits together

1. The page is plain HTML, CSS and JavaScript hosted on GitHub Pages; there's no server of its
   own and no build step.
2. Bookings and presence signals live in **Firebase Firestore** (free plan), in two collections:
   `bookings` and `presence`. The page listens for changes, so everyone updates live.
3. Every booking is stored as one universal moment (`startMs`, `endMs`, milliseconds since 1970
   UTC) and only converted to Copenhagen or Singapore time for display.
4. There are no logins. Firestore **security rules** limit what can be written: only bookings and
   presence signals, in the right shape, for known users.
5. The **Tampermonkey userscript** runs on plogenius.com in each person's browser. It reads and
   writes the same Firestore collections through Firestore's web API, shows the cards, and sends
   presence signals. The planner page's banner reads those signals.

## Technical reference

Scripts load in this order from `index.html`, after the Firebase 12.19.0 compat libraries:
`firebase-config.js`, `time.js`, `bookings.js`, `edit.js`, `drag.js`, `presence.js`, `app.js`.

### `js/time.js` — dates and zones

A **day key** is a date as text (`"2026-09-29"`). Functions: `todayKey(zone)`, `addDays(key, n)`,
`formatDayHeader(key)`, `partsInZone`, `utcOffsetMinutes`, `zonedTimeToMs(dayKey, minutes, zone)`
(local time → moment), `dayKeyInZone(ms, zone)`, `minutesInZone(ms, zone)`, `minutesToText`,
`timeTextInZone(ms, zone)`, `zoneAbbreviation(zoneKey, ms)`, `zoneStatusText`,
`detectDefaultZone()`.

### `js/bookings.js` — users and storage

- **Booking shape:** `{ id, user, startMs, endMs }`; ids look like `b-<time>-<random>`.
- `USERS` list and `colorForUser(name)`.
- `startStorage(changed, status)` — starts **live** Firestore storage, or **test mode** (this
  browser only, `localStorage`) when `FIREBASE_CONFIG` is null.
- `addBooking`, `updateBooking(id, changes)`, `deleteBooking(id)`, `findBooking(id)`,
  `newBookingId()`, `removeOldBookings()` (the yesterday-in-Copenhagen cleanup),
  `findClash(startMs, endMs, ignoreId)`.

### `js/app.js` — drawing and the add form

`render()` redraws the grid; `calculateCalendar`, `drawGrid`, `drawNowLine`, `scrollToNow`,
`drawBookings`, `makeBookingBlock`. Form: `setUpAddForm`, `handleAddBooking`,
`rangeFromChoices`, `problemWithTimes` (clash/length/window check), `startsInWindow`,
`describeBooking`. Controls: `setUpControls` (zone switch, week buttons, help), zone choice saved
with `loadZoneChoice` / `saveZoneChoice`. The window length (14 days) is a setting at the top.

### `js/drag.js` — drag to move or copy

`setUpDragging`, `startDrag`, `moveDrag`, `endDrag` (Ctrl = copy; a click opens the edit window),
`pointerToMs` (screen position → moment, snapped to 15 min), `getBookingsToDraw`.

### `js/edit.js` — the edit window

`setUpEditDialog`, `openEditDialog(id)`, `handleSaveEdit`, `handleDelete`, `handleCopy`,
`closeEditDialog`.

### `js/presence.js` — the banner

`startPresence()` listens to the `presence` collection; `drawPresenceBanner()`;
`nextBookingText(now, zone)`.

### `js/firebase-config.js`

Holds `FIREBASE_CONFIG`. `null` = test mode. The Firebase web API key in it is meant to be
public; the security rules protect the data.

### `plogenius-presence.user.js` — the helper (v1.16.0)

Runs on `plogenius.com`, talks to `firestore.googleapis.com`, and updates itself from the
GitHub Pages copy. Main functions: `loadPlannerStatus`, `showStatusCard`, `refreshStatusCard`,
`bookAndStart`, `createBooking`, `extendBooking`, `changeBookingEnd`, `onBookingEnded`,
`sendSignal` / `removeSignal`, `logIn` / `logOut`, `checkIdle` / `askStillActive`,
`checkNoShows` / `removeFirstPart` (trimmed ids get `-t1`, `-t2`…), `findOverlap`,
`showNamePicker` (your name is remembered), `makeMenuButton` / `placeMenuButton`.

### `firestore.rules`

A backup copy of the database rules (the live rules are pasted into the Firebase console).
Bookings must have exactly `user`, `startMs`, `endMs`; a known user; end after start; at most
24 hours; start between 2 days ago and 16 days ahead. Presence documents are one per known user,
with `lastSeen` set to the server's clock. Anything else is refused.

### Running it locally

`python -m http.server 8123 --directory booking-planner` from the parent folder (the "planner"
entry in `.claude/launch.json`), then open http://localhost:8123.

## Setup and requirements

- A Firebase project with Firestore; its web config pasted into `js/firebase-config.js`, and
  `firestore.rules` published in the Firebase console.
- GitHub Pages serving the public repo `tmje30/booking-planner` (Pages on GitHub Free needs a
  public repo).
- Each user installs Tampermonkey and the userscript from the Pages site.
- **Changing users:** update the list in three places — `js/bookings.js`,
  `plogenius-presence.user.js` and `firestore.rules` — then re-publish the rules.
- Desktop and mouse only; phones aren't supported.

## Glossary

- **plogenius** — the shared app (plogenius.com) the group books time on.
- **Day key** — a date as text, like `2026-09-29`.
- **ms / startMs / endMs** — a moment as milliseconds since 1 Jan 1970 UTC.
- **Firestore** — Google Firebase's live database.
- **Security rules** — Firestore's rules for what may be read or written.
- **Test mode** — bookings saved only in this browser, when no Firebase config is set.
- **Presence signal** — the once-a-minute "still here" note from the helper.
- **Tampermonkey / userscript** — a browser extension and the script it runs on a website.
- **No-show** — a booking whose owner hasn't turned up within 20 minutes of its start.
- **CET / CEST / SGT** — Copenhagen winter time / Copenhagen summer time / Singapore time.

## What changed in this update

- **2026-10-19 — Initial guide.** First `SYSTEM-GUIDE.md`, built from `PRD.md`, the code
  comments and `firestore.rules`, covering everything through the 2026-10-01 clash-safe clicks
  and no-show rule. The guide lives in `booking-planner/` because that's the git repo; its parent
  folder "Poker solver scheduler" holds no other code.
