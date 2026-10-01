# Booking Planner — PRD

Live link: https://tmje30.github.io/booking-planner/
Repo (public): https://github.com/tmje30/booking-planner

## What we're building
A shared web page where our group books time slots for an app we share.
It shows a rolling 2-week planner with real dates. Everyone opens the same
link (pinned in our Discord), and everyone sees the same bookings live.

## Why
We need to coordinate who is using the app when. Discord has no built-in
drag-and-drop booking grid, and a plain HTML file pinned in Discord would
only save bookings on each person's own computer, so we need shared storage.

## Already exists — do not rebuild
- Nothing for this planner yet. It is a brand-new project.
- I have a github-backup skill for pushing projects to GitHub. Check whether
  it fits here (see open question about public repos). Do not rewrite it.

## Scope — v1
- Rolling 14-day window starting today. Each day shows its date.
  When a day passes, it disappears and a new day appears at the far end.
- Bookings on days that have passed are deleted automatically.
- Each day covers 24 hours in 15-minute steps. A booking can be any length
  (in 15-minute steps).
- Users (fixed list, chosen from a dropdown): Baby4Life, Tripplelift,
  Red.ElinGho. Each user gets their own colour on the planner.
- Add a booking with manual inputs: dropdowns for user, day, start time,
  end time.
- Drag a booking block to move it to a different time or day.
- Copy a booking block (same duration) onto a different day to create a
  new booking.
- Click a booking block to change its times or delete it.
- A time zone switch at the top: "Copenhagen (CET)" or "Singapore (SGT)".
  All times on the planner and in the dropdowns show in the chosen zone.
  Each person's choice is remembered on their own device.
- Changes show up for everyone within a second or two, without refreshing.
- A "?" help button in the top-right corner opens a pop-up with short,
  plain instructions on how to use the planner (added 2026-09-29).
- Every time shown carries its zone label (CEST / CET / SGT) (added
  2026-09-29).
- "plogenius in use / free" banner (added 2026-09-29). The shared app is
  plogenius.com. A web page can't see other open sites, so each person
  installs a free Tampermonkey userscript (plogenius-presence.user.js,
  served from GitHub Pages) that sends a "still open" signal under their
  name once a minute while plogenius.com is open (stored in Firestore
  collection "presence", using the server's clock). The banner shows
  "🟢 in use: <name> · open since <time>", or, when no signal for 3
  minutes, "⚪ free · next booking: <name> at <time>" (or "booked now by
  <name> until <time>"). Cost: free (Tampermonkey is free; about one
  database write per minute per open plogenius tab, far below the free
  Firebase limits).
  Status card on opening plogenius (added 2026-09-29): shows who is using
  it, who has it booked now, and the next booking. You only count as "in
  use" after pressing Start. If free: "Book 1 hour & start", "Book 2 hours
  & start" (from the current quarter hour; disabled with a reason if it
  would clash). CHANGED later the same day: "Start without booking" was
  removed — you can only start by booking (1 hour, 2 hours, or "until the
  next booking" when that's shorter), or with your own booking that's on
  now. If someone else is using it or
  has it booked right now: NO start buttons (one user at a time). If it's
  your own booking now: "Start (your booking until ...)". Always: "Open
  full planner" and "Not now". Also shown after being logged out.
  Card stays current (added 2026-09-30): an open status card refreshes
  itself once a minute and immediately when you switch to that plogenius
  window, so its times, bookings and Book buttons are never stale.
  Menu button (added 2026-09-30): the helper adds a button after "VIP" in
  plogenius's top menu. In a session: "⏻ Log out scheduler" = quietly mark
  plogenius as free in the planner (no card; does NOT log out of
  plogenius). Not in a session: "▶ Start session" = open the booking
  card. It re-adds itself if plogenius redraws its menu.
  No card during your own booking (added 2026-09-30): opening plogenius
  (e.g. an extra window) during your own booked time, with nobody else on
  it, starts you straight away with no card. If someone else is still on
  it during your booked time, the card shows that and offers "Start".
  After logging out, the card always shows (no automatic start).
  Back-to-back own bookings (added 2026-10-01): when your booking ends
  and your OWN next booking starts within a minute, the session simply
  carries on into it — no card, no log-out.
  Booking end (added 2026-09-29): when your booking runs out, a card
  shows who's next. Someone booked straight after you = logged out at
  once (card shows who). Otherwise: "Extend 1 hour", "Extend 2 hours" or
  "Extend until <next booking>" (extends the same booking), or "Log out";
  no answer in 10 minutes = logged out. If the booking was extended in
  the planner meanwhile, it just waits for the new end.
  Idle check (CHANGED 2026-09-30, replaces the old 2-hour check): the
  helper notices activity on plogenius (mouse, clicks, keys, scroll —
  only that something happened, not what), shared across all plogenius
  windows. After 40 minutes with no activity: "Still using plogenius?"
  [I'm still here] [Log out scheduler]. No answer within 10 minutes = the
  current booking is DELETED, the session is logged out (planner shows
  "free" at once) and the status card appears. Activity in another
  plogenius window also closes the question. Closing the window stops the
  signals too (free after ~3 minutes); the chosen name stays remembered.

## Explicitly out of scope
- User logins / passwords
- Discord bot or notifications/reminders
- Recurring (repeat weekly) bookings
- Adding/removing users from inside the app (edit the list in the code)
- Time zones other than Copenhagen and Singapore

## Decisions already made
- Hosting: GitHub Pages. Free, and anyone with the link can open it.
- Database: Firebase (Firestore) free plan. No credit card, doesn't pause
  when unused, and has live updates built in. Supabase was ruled out because
  free projects pause after low activity. Notion was ruled out because its
  secret key can't be hidden in a public web page.
- No logins in v1. Anyone with the link can edit. The user dropdown shows
  who booked what. Firestore security rules should still restrict what can
  be written (only booking data, in the right shape).
- Time zones: viewers can switch between Copenhagen and Singapore time.
  Store every booking in one universal time behind the scenes and only
  convert for display, so a booking is the same real moment for everyone.
  "CET" should follow Copenhagen's real local time, including summer time
  (CEST), not a fixed CET all year.
- Keep it simple for a beginner: plain HTML, CSS and JavaScript, no build
  tools or frameworks unless there's a strong reason (explain it first).

## Answers to open questions
- Layout CHANGED (2026-09-29, later the same day): weeks now start on
  TODAY, not Monday. Week 1 = today + next 6 days (today is always the
  first column); Week 2 = the 7 days after. No greyed-out days any more.
  A red "now" line shows the current time in today's column (in the
  chosen zone) and moves every minute; the page opens scrolled to it.
  The original answer below is kept for history.
- Layout (answered 2026-09-29, superseded above): Calendar-style weeks that start on Monday.
  Days outside the rolling 14-day window are shown greyed out.
  The grid shows 1-hour lines; bookings snap to 15-minute steps when
  clicked or dragged, and can be moved freely.
  Because a 14-day window usually spans 3 Monday-Sunday weeks, the planner
  shows ONE week at a time with "‹ Previous week" / "Next week ›" buttons
  and a "Week of <date>" label. Dragging works within the visible week;
  to move a booking to another week, click it and change its day.
- Overlaps (answered 2026-09-29): Only one person can book a given time.
  Adding, moving, copying or editing a booking into a taken time is blocked
  with a message like "Clashes with Tripplelift, 14:00–16:00". Back-to-back
  bookings are fine (one ends 14:00, next starts 14:00). Known limitation:
  the check happens in the page, so two saves in the same second could in
  rare cases both get through; accepted for v1 with 3 users.
- Midnight (answered 2026-09-29): A booking that crosses midnight in the
  viewed zone is drawn split across both days, same colour, with small
  "↓ continues" / "↑ continued" markers. It is still ONE booking: clicking
  either piece opens the same edit form; dragging either piece moves the
  whole booking; deleting removes both pieces. Bookings may cross midnight
  on purpose: if end time is earlier than start time, it ends the next day
  (form shows "(next day)"). Maximum booking length is 24 hours. A piece
  that lands on a greyed-out day is still drawn there.
- Deleting past bookings (answered 2026-09-29): Use the zone that is
  furthest behind (Copenhagen) and add a 24-hour safety buffer. A booking
  is deleted only once it ended before the start of YESTERDAY in Copenhagen
  time (e.g. Tuesday's bookings go when Thursday starts in Copenhagen).
  Cleanup runs whenever anyone opens the page (there is no server of our
  own). Yesterday's bookings may still show, faded, on the greyed-out day.
- Visible window: the 14 days follow each viewer's chosen zone ("today" is
  their today).
- Default zone for first-time visitors: detected from the computer's time
  zone (Singapore → SGT, anything else → Copenhagen), then remembered on
  that device.
- Phone use (answered 2026-09-29): Not used on phones. Desktop and mouse
  only, so no touch-drag support is needed in v1.
- GitHub (answered 2026-09-29): One PUBLIC repo. Checked GitHub docs: on
  GitHub Free, Pages needs a public repo (and a Pages site is always public
  anyway). We create the repo once as public; after that the github-backup
  skill works unchanged, because it pushes to an existing remote without
  creating a new one. Note: its secrets check will flag the Firebase web
  API key (starts with "AIza"). That is a false positive: Firebase web
  keys are meant to be public; the Firestore security rules protect the
  data. Confirm it as a false positive when the skill asks.

All open questions are answered.

## Done means
- Two people on different devices open the Discord link, and a booking made
  by one appears for the other within a few seconds.
- Adding, moving, copying, editing and deleting a booking all work.
- Switching between Copenhagen and Singapore time shows the same bookings
  at the correct local times.
- The dates roll forward correctly, and past bookings are gone the next day.
- I understand what each file does, well enough to explain it back.
