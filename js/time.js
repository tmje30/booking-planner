// time.js — helpers for dates and time zones.
//
// This file is loaded BEFORE app.js (see the <script> tags in index.html),
// so everything defined here can be used from app.js.
//
// Two ideas used throughout the project:
//
// 1. A "day key" is a calendar date written as text, like "2026-09-29".
//    It is just a date on a calendar, with no time and no time zone.
//    Text like this is easy to compare and to use as a label.
//
// 2. A real moment in time (e.g. "the start of a booking") is stored as a
//    JavaScript Date. A Date is the same instant for everyone on Earth;
//    only the way we *display* it depends on the time zone.

// The two time zones the planner supports.
// "CPH" and "SGT" are short names we use in our own code.
// "timeZone" is the official name that browsers understand. Using the
// official name means summer time (CEST) is handled automatically.
const ZONES = {
  CPH: { label: "Copenhagen (CET)", timeZone: "Europe/Copenhagen" },
  SGT: { label: "Singapore (SGT)", timeZone: "Asia/Singapore" },
};

// Add a leading zero: 7 -> "07". Used to build "2026-09-07" and "09:15".
function pad2(n) {
  return String(n).padStart(2, "0");
}

// Take a moment in time and return its calendar parts
// (year, month, day, hour, minute) as a clock in `timeZone` would show them.
// Intl.DateTimeFormat is built into every modern browser; it knows the
// rules of every time zone, including when summer time starts and ends.
function partsInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // 24-hour clock, 00–23
  });
  const parts = {};
  for (const piece of formatter.formatToParts(date)) {
    parts[piece.type] = piece.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

// Today's calendar date in the given zone, as a day key ("2026-09-29").
function todayKey(timeZone) {
  const p = partsInZone(new Date(), timeZone);
  return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
}

// Turn a day key into a Date at midnight UTC. We only use this for
// calendar maths (adding days, finding the weekday), never for display
// of real booking times, so the UTC part doesn't matter here.
function keyToCalendarDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)); // months count from 0 in JS
}

// Move a day key forwards (or backwards, with a negative number) by n days.
// addDays("2026-09-29", 3) -> "2026-10-02"
function addDays(key, n) {
  const date = keyToCalendarDate(key);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10); // keep just "YYYY-MM-DD"
}

// Weekday of a day key, with Monday = 0 ... Sunday = 6.
// (JavaScript normally counts Sunday = 0, so we shift it.)
function weekdayMondayFirst(key) {
  return (keyToCalendarDate(key).getUTCDay() + 6) % 7;
}

// The Monday on or before the given day key.
function mondayOf(key) {
  return addDays(key, -weekdayMondayFirst(key));
}

// Nice label for a day column, e.g. "Tue 29 Sep".
function formatDayHeader(key) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", // matches keyToCalendarDate, so the date doesn't shift
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(keyToCalendarDate(key));
}

// How many minutes `timeZone` is ahead of UTC at the given moment.
// Copenhagen: 60 in winter (CET), 120 in summer (CEST). Singapore: always 480.
function utcOffsetMinutes(timeZone, date) {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const wholeMinute = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((asIfUtc - wholeMinute) / 60000);
}

// Short description of a zone's current clock, e.g. "CEST, UTC+2".
function zoneStatusText(zoneKey) {
  const offset = utcOffsetMinutes(ZONES[zoneKey].timeZone, new Date());
  const hours = offset / 60;
  const utcText = "UTC+" + hours;
  if (zoneKey === "CPH") {
    return (offset === 120 ? "summer time, CEST" : "winter time, CET") + ", " + utcText;
  }
  return "SGT, " + utcText;
}

// ---------- Converting between "clock time in a zone" and real moments ----------

// Turn "this date, this many minutes after midnight, in this zone" into a
// real moment (milliseconds since 1970 UTC).
// Example: zonedTimeToMs("2026-09-29", 14 * 60, "Asia/Singapore")
//          = the moment it is 14:00 on 29 Sep in Singapore.
//
// How it works: first pretend the clock time is UTC, then subtract the
// zone's offset from UTC. We check the offset twice, because the offset
// can be different on either side of a summer-time change.
function zonedTimeToMs(dayKey, minutesFromMidnight, timeZone) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const pretendUtc = Date.UTC(y, m - 1, d, 0, minutesFromMidnight);
  let guess = pretendUtc - utcOffsetMinutes(timeZone, new Date(pretendUtc)) * 60000;
  guess = pretendUtc - utcOffsetMinutes(timeZone, new Date(guess)) * 60000;
  return guess;
}

// Which calendar day a moment falls on, in a zone ("2026-09-29").
function dayKeyInZone(ms, timeZone) {
  const p = partsInZone(new Date(ms), timeZone);
  return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
}

// Minutes after local midnight for a moment, in a zone (14:30 -> 870).
function minutesInZone(ms, timeZone) {
  const p = partsInZone(new Date(ms), timeZone);
  return p.hour * 60 + p.minute;
}

// 870 -> "14:30"
function minutesToText(minutes) {
  return pad2(Math.floor(minutes / 60)) + ":" + pad2(minutes % 60);
}

// A moment shown as a clock time in a zone, e.g. "14:30".
function timeTextInZone(ms, timeZone) {
  return minutesToText(minutesInZone(ms, timeZone));
}

// Pick a starting zone for someone who has never chosen one:
// if their computer is set to Singapore time, use SGT, otherwise Copenhagen.
function detectDefaultZone() {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return deviceZone === "Asia/Singapore" ? "SGT" : "CPH";
}
