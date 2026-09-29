// app.js — draws the planner on the page and handles the buttons.
//
// It draws the calendar (weeks, days, hours), the booking blocks, and
// handles the time zone switch, the week buttons and the "Add booking" form.

// ---------- Settings ----------

// How many days the rolling window covers, starting today.
const WINDOW_DAYS = 14;

// Where we remember this person's time zone choice in their browser.
// localStorage is a small storage box each browser keeps per website.
// It only lives on this one device — which is exactly what we want here.
const ZONE_STORAGE_KEY = "bookingPlanner.zone";

// ---------- State (things that can change while the page is open) ----------

let currentZone = loadZoneChoice(); // "CPH" or "SGT"
let weekIndex = null;               // which week is shown (0 = first); null = "pick the week with today"
let lastTodayKey = null;            // used to notice when the date rolls over

// ---------- Remembering the time zone choice ----------

function loadZoneChoice() {
  // try/catch: some browsers (private windows, strict settings) block
  // localStorage and throw an error. If so, we just use the default.
  try {
    const saved = localStorage.getItem(ZONE_STORAGE_KEY);
    if (saved === "CPH" || saved === "SGT") return saved;
  } catch (error) {
    // Ignore — fall through to the default below.
  }
  return detectDefaultZone();
}

function saveZoneChoice(zoneKey) {
  try {
    localStorage.setItem(ZONE_STORAGE_KEY, zoneKey);
  } catch (error) {
    // Couldn't save; the choice still works until the page is closed.
  }
}

// ---------- Working out which days and weeks to show ----------

// Returns everything the drawing code needs to know about the calendar
// right now, in the currently chosen zone.
function calculateCalendar() {
  const timeZone = ZONES[currentZone].timeZone;
  const firstDay = todayKey(timeZone);                   // today
  const lastDay = addDays(firstDay, WINDOW_DAYS - 1);    // today + 13

  // Two "weeks" of 7 days each, both rolling: week 1 starts today,
  // week 2 starts 7 days from today. So today is always the first column.
  const weekStarts = [firstDay, addDays(firstDay, 7)];

  return { firstDay, lastDay, weekStarts };
}

// ---------- Drawing ----------

function render() {
  const { firstDay, lastDay, weekStarts } = calculateCalendar();
  lastTodayKey = firstDay;

  // Keep the week number inside the allowed range (week 1, which starts
  // today, is index 0).
  if (weekIndex === null) weekIndex = 0;
  weekIndex = Math.max(0, Math.min(weekIndex, weekStarts.length - 1));

  const weekStart = weekStarts[weekIndex];
  const weekEnd = addDays(weekStart, 6);

  // Top bar: time zone status and week label/buttons.
  document.getElementById("zone-status").textContent =
    "Copenhagen is on " + zoneStatusText("CPH") + ". Singapore is " + zoneStatusText("SGT") + ".";
  document.getElementById("week-label").textContent =
    "Week " + (weekIndex + 1) + ": " + formatDayHeader(weekStart) + " – " + formatDayHeader(weekEnd);
  document.getElementById("prev-week").disabled = weekIndex === 0;
  document.getElementById("next-week").disabled = weekIndex === weekStarts.length - 1;

  drawGrid(weekStart, firstDay, lastDay);
  drawBookings();
  drawNowLine();
  drawPresenceBanner(); // in presence.js (times follow the chosen zone)
  fillDayOptions();
  updateNextDayHint();
}

// Which week (0 = days 1–7, 1 = days 8–14) contains the given day? Used
// to jump to a booking's week after adding it.
function weekIndexOfDay(dayKey) {
  const { firstDay } = calculateCalendar();
  return dayKey >= addDays(firstDay, 7) ? 1 : 0;
}

// Build the grid: a time column on the left and 7 day columns.
function drawGrid(weekStart, firstDay, lastDay) {
  const planner = document.getElementById("planner");
  planner.innerHTML = ""; // clear whatever was drawn before

  // --- Header row: an empty corner cell + one header per day ---
  const head = document.createElement("div");
  head.className = "planner-head";
  // The corner above the hours says which zone the times are in, e.g. "CEST".
  const corner = document.createElement("div");
  corner.className = "zone-corner";
  corner.textContent = zoneAbbreviation(currentZone, Date.now());
  head.appendChild(corner);

  const dayKeys = [];
  for (let i = 0; i < 7; i++) dayKeys.push(addDays(weekStart, i));

  for (const key of dayKeys) {
    const cell = document.createElement("div");
    cell.className = "day-header" + dayClasses(key, firstDay, lastDay);
    cell.textContent = formatDayHeader(key);
    if (key === firstDay) cell.textContent += " · Today";
    head.appendChild(cell);
  }
  planner.appendChild(head);

  // --- Body: hour labels + day columns ---
  const body = document.createElement("div");
  body.className = "planner-body";

  const hoursColumn = document.createElement("div");
  hoursColumn.className = "hours-column";
  for (let hour = 0; hour < 24; hour++) {
    const label = document.createElement("div");
    label.className = "hour-label";
    label.textContent = pad2(hour) + ":00";
    hoursColumn.appendChild(label);
  }
  body.appendChild(hoursColumn);

  for (const key of dayKeys) {
    const column = document.createElement("div");
    column.className = "day-column" + dayClasses(key, firstDay, lastDay);
    column.dataset.day = key; // remember which date this column is (used later for bookings)
    for (let hour = 0; hour < 24; hour++) {
      const hourCell = document.createElement("div");
      hourCell.className = "hour-cell";
      column.appendChild(hourCell);
    }
    body.appendChild(column);
  }
  planner.appendChild(body);
}

// Extra CSS class names for a day: greyed out if outside the 14-day
// window, highlighted if it's today.
function dayClasses(key, firstDay, lastDay) {
  let classes = "";
  if (key < firstDay || key > lastDay) classes += " outside-window";
  if (key === firstDay) classes += " is-today";
  return classes;
}

// ---------- The red "now" line ----------

// Draw a red line across today's column at the current time (in the
// chosen zone). Called on every redraw and once a minute, so it moves.
function drawNowLine() {
  document.querySelectorAll(".now-line").forEach((line) => line.remove());

  const timeZone = ZONES[currentZone].timeZone;
  const todayColumn = document.querySelector('.day-column[data-day="' + todayKey(timeZone) + '"]');
  if (!todayColumn) return; // today isn't on screen (e.g. week 2 is showing)

  const line = document.createElement("div");
  line.className = "now-line";
  line.style.top = (minutesInZone(Date.now(), timeZone) / (24 * 60)) * 100 + "%";
  todayColumn.appendChild(line);
}

// Scroll the page so the "now" line is near the top of the screen, with
// about an hour of the planner visible above it.
function scrollToNow() {
  const line = document.querySelector(".now-line");
  if (!line) return;
  const headerHeight = document.querySelector(".planner-head").offsetHeight;
  const oneHour = document.querySelector(".hour-cell").offsetHeight;
  const lineTopOnPage = line.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, Math.max(0, lineTopOnPage - headerHeight - oneHour));
}

// ---------- Drawing booking blocks ----------
//
// For every day column on screen, find the bookings that overlap that
// day (in the chosen zone) and draw the part that falls inside the day.
// A booking that crosses midnight therefore gets drawn as two pieces:
// the end of one day and the start of the next.
//
// This is also called over and over while you drag a booking, so it
// first removes the blocks it drew last time.
function drawBookings() {
  const timeZone = ZONES[currentZone].timeZone;
  const columns = document.querySelectorAll(".day-column");
  document.querySelectorAll(".booking").forEach((block) => block.remove());

  // Normally this is just allBookings; during a drag it also includes
  // the booking in its new (not yet saved) position. See drag.js.
  const bookingsToDraw = getBookingsToDraw();

  for (const column of columns) {
    const dayKey = column.dataset.day;
    const dayStartMs = zonedTimeToMs(dayKey, 0, timeZone);            // this day 00:00
    const dayEndMs = zonedTimeToMs(addDays(dayKey, 1), 0, timeZone);  // next day 00:00

    for (const booking of bookingsToDraw) {
      // Skip bookings that don't touch this day at all.
      if (booking.endMs <= dayStartMs || booking.startMs >= dayEndMs) continue;

      const startsBeforeToday = booking.startMs < dayStartMs; // began on an earlier day
      const endsAfterToday = booking.endMs > dayEndMs;        // carries on into the next day

      // Where the piece starts and stops, in minutes after this day's midnight.
      const topMinutes = startsBeforeToday ? 0 : minutesInZone(booking.startMs, timeZone);
      const bottomMinutes = endsAfterToday ? 24 * 60 : minutesInZone(booking.endMs, timeZone);
      if (bottomMinutes <= topMinutes) continue; // safety net for odd summer-time edge cases

      column.appendChild(makeBookingBlock(booking, topMinutes, bottomMinutes,
        startsBeforeToday, endsAfterToday, timeZone));
    }
  }
}

// Build one coloured booking block (or one piece of a split booking).
function makeBookingBlock(booking, topMinutes, bottomMinutes, continued, continues, timeZone) {
  const block = document.createElement("div");
  block.className = "booking";
  if (booking.isPreview) block.classList.add("is-preview");   // being dragged
  if (booking.hasProblem) block.classList.add("has-problem"); // can't be dropped here
  block.dataset.id = booking.id; // lets us find the booking again when clicked
  block.style.background = colorForUser(booking.user);

  // Position as a percentage of the day's height: 0% = 00:00, 100% = 24:00.
  const minutesInDay = 24 * 60;
  block.style.top = (topMinutes / minutesInDay) * 100 + "%";
  block.style.height = ((bottomMinutes - topMinutes) / minutesInDay) * 100 + "%";

  // The label always shows the WHOLE booking's times, even on a piece.
  const timesText = timeTextInZone(booking.startMs, timeZone) + "–" +
                    timeTextInZone(booking.endMs, timeZone) + " " +
                    zoneAbbreviation(currentZone, booking.startMs);
  let text = booking.user + " " + timesText;
  if (continued) text = "↑ continued · " + text;
  if (continues) text += " · ↓ continues";
  block.textContent = text;
  block.title = text; // shown when you hover, handy for short blocks

  return block;
}

// ---------- Helpers shared by the Add form and the Edit window ----------

// Fill a dropdown with the users.
function fillUserOptions(select) {
  for (const user of USERS) select.appendChild(new Option(user.name, user.name));
}

// Fill a dropdown with 96 times: 00:00, 00:15 ... 23:45.
// Each option's value is "minutes after midnight" (e.g. 14:15 -> 855).
function fillTimeOptions(select) {
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    select.appendChild(new Option(minutesToText(minutes), minutes));
  }
}

// Fill a dropdown with the 14 days of the window (in the chosen zone),
// then select `wantedDay` if it's in the list, otherwise today.
// If `extraDay` is given and isn't in the window (e.g. an old booking
// from yesterday that is being edited), it's added at the top so the
// dropdown can still show it.
function fillWindowDayOptions(select, wantedDay, extraDay) {
  const { firstDay } = calculateCalendar();
  select.innerHTML = "";
  if (extraDay && extraDay < firstDay) {
    select.appendChild(new Option(formatDayHeader(extraDay) + " (past)", extraDay));
  }
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const key = addDays(firstDay, i);
    select.appendChild(new Option(formatDayHeader(key), key));
  }
  const inList = [...select.options].some((o) => o.value === wantedDay);
  select.value = inList ? wantedDay : firstDay;
}

// Turn "day + start minutes + end minutes" (clock times in the chosen
// zone) into real moments. If the end isn't after the start, the end is
// on the next day (same start and end = 24 hours).
function rangeFromChoices(dayKey, startMinutes, endMinutes) {
  const timeZone = ZONES[currentZone].timeZone;
  const startMs = zonedTimeToMs(dayKey, startMinutes, timeZone);
  const endDay = endMinutes > startMinutes ? dayKey : addDays(dayKey, 1);
  const endMs = zonedTimeToMs(endDay, endMinutes, timeZone);
  return { startMs, endMs };
}

// The "(next day)" text shown next to an End dropdown.
function nextDayHintText(startMinutes, endMinutes) {
  if (endMinutes === startMinutes) return "(next day, 24 hours)";
  if (endMinutes < startMinutes) return "(next day)";
  return "";
}

// Does a booking starting at `startMs` start on one of the 14 window days?
function startsInWindow(startMs) {
  const { firstDay, lastDay } = calculateCalendar();
  const day = dayKeyInZone(startMs, ZONES[currentZone].timeZone);
  return day >= firstDay && day <= lastDay;
}

// Check a proposed booking time before saving it. Returns an error
// message, or null if it's fine. `ignoreId` = the booking being moved or
// edited, so it doesn't clash with itself.
function problemWithTimes(startMs, endMs, ignoreId) {
  if (!startsInWindow(startMs)) return "That's outside the 14-day window.";
  const clash = findClash(startMs, endMs, ignoreId);
  if (clash) {
    return "Clashes with " + clash.user + ", " + describeBooking(clash, ZONES[currentZone].timeZone);
  }
  return null;
}

// e.g. "Tue 29 Sept 14:00–16:00" in the given zone.
function describeBooking(booking, timeZone) {
  return formatDayHeader(dayKeyInZone(booking.startMs, timeZone)) + " " +
    timeTextInZone(booking.startMs, timeZone) + "–" + timeTextInZone(booking.endMs, timeZone) +
    " " + zoneAbbreviation(currentZone, booking.startMs);
}

// Show a short message next to the Add button (red if it's a problem).
// Also used for messages after dragging, editing and copying.
function showMessage(text, isError) {
  const message = document.getElementById("add-message");
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

// ---------- The "Add booking" form ----------

// Fill the User, Start and End dropdowns once, when the page opens.
function setUpAddForm() {
  fillUserOptions(document.getElementById("add-user"));
  const startSelect = document.getElementById("add-start");
  const endSelect = document.getElementById("add-end");
  fillTimeOptions(startSelect);
  fillTimeOptions(endSelect);

  // Sensible starting values: the next full hour, for one hour.
  const now = minutesInZone(Date.now(), ZONES[currentZone].timeZone);
  const nextHour = (Math.floor(now / 60) + 1) % 24;
  startSelect.value = nextHour * 60;
  endSelect.value = ((nextHour + 1) % 24) * 60;

  document.getElementById("add-form").addEventListener("submit", handleAddBooking);
  startSelect.addEventListener("change", updateNextDayHint);
  document.getElementById("add-day").addEventListener("change", updateNextDayHint);
  endSelect.addEventListener("change", updateNextDayHint);
}

// Refill the Day dropdown (redone on every redraw, because the 14 days
// change when the zone or date changes), keeping the current choice.
function fillDayOptions() {
  const daySelect = document.getElementById("add-day");
  fillWindowDayOptions(daySelect, daySelect.value, null);
}

function updateNextDayHint() {
  const start = Number(document.getElementById("add-start").value);
  const end = Number(document.getElementById("add-end").value);
  document.getElementById("next-day-hint").textContent = nextDayHintText(start, end);
  // Show the zone next to the times, e.g. "CEST", for the chosen day.
  const day = document.getElementById("add-day").value;
  if (day) {
    document.getElementById("add-zone").textContent =
      zoneAbbreviation(currentZone, zonedTimeToMs(day, start, ZONES[currentZone].timeZone));
  }
}

// Runs when the "Add" button is pressed.
function handleAddBooking(event) {
  // A form normally reloads the page when submitted; this stops that.
  event.preventDefault();

  const user = document.getElementById("add-user").value;
  const dayKey = document.getElementById("add-day").value;
  const startMinutes = Number(document.getElementById("add-start").value);
  const endMinutes = Number(document.getElementById("add-end").value);
  const { startMs, endMs } = rangeFromChoices(dayKey, startMinutes, endMinutes);

  const problem = problemWithTimes(startMs, endMs, null);
  if (problem) {
    showMessage(problem, true);
    return;
  }

  addBooking({ id: newBookingId(), user: user, startMs: startMs, endMs: endMs });
  showMessage("Booked " + user + ", " + formatDayHeader(dayKey) + " " +
    minutesToText(startMinutes) + "–" + minutesToText(endMinutes) + " " +
    zoneAbbreviation(currentZone, startMs) + ".", false);

  weekIndex = weekIndexOfDay(dayKey); // show the week the booking is in
  render();
}

// ---------- Buttons and switches ----------

function setUpControls() {
  setUpAddForm();
  setUpEditDialog();  // in edit.js
  setUpDragging();    // in drag.js

  const zoneSelect = document.getElementById("zone-select");

  // Fill the time zone dropdown from the ZONES list in time.js.
  for (const key of Object.keys(ZONES)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = ZONES[key].label;
    zoneSelect.appendChild(option);
  }
  zoneSelect.value = currentZone;

  // "change" fires when the person picks a different option.
  zoneSelect.addEventListener("change", () => {
    currentZone = zoneSelect.value;
    saveZoneChoice(currentZone);
    weekIndex = null; // jump back to week 1 (starts today)
    render();
    scrollToNow();
  });

  document.getElementById("prev-week").addEventListener("click", () => {
    weekIndex -= 1;
    render();
  });
  document.getElementById("next-week").addEventListener("click", () => {
    weekIndex += 1;
    render();
  });

  // The "?" button opens the help window. (Its Close button closes it by
  // itself, because it's inside a <form method="dialog">.)
  document.getElementById("help-button").addEventListener("click", () => {
    document.getElementById("help-dialog").showModal();
  });
}

// Show the storage status in the top bar, e.g. "Live: shared with everyone".
// `kind` is "test", "connecting", "live" or "error" and picks the colour.
function showStatus(kind, text) {
  const status = document.getElementById("storage-status");
  status.textContent = text;
  status.className = "storage-status status-" + kind;
}

// ---------- Start ----------

setUpControls();
render();
scrollToNow(); // start the page at the current time instead of at 00:00

// Load the bookings (from Firebase, or this browser in test mode). Every
// time the bookings change — including changes made by other people —
// the blocks are redrawn.
startStorage(() => {
  drawBookings();
  drawPresenceBanner(); // "next booking" may have changed
}, showStatus);

// Start the "plogenius in use / free" banner (presence.js).
startPresence();

// Once a minute: move the "now" line, and check whether the date has
// changed (e.g. it's past midnight). If it has, redraw so the window
// rolls forward by itself.
setInterval(() => {
  if (todayKey(ZONES[currentZone].timeZone) !== lastTodayKey) {
    removeOldBookings();
    weekIndex = null;
    render();
  } else {
    drawNowLine();
  }
}, 60 * 1000);
