// edit.js — the "Edit booking" window that opens when you click a block.
//
// From here you can change a booking's user, day and times, delete it,
// or copy it (same start time and length) onto another day.
//
// The window is an HTML <dialog> element (see index.html). Browsers have
// dialogs built in: showModal() opens it on top of the page and dims the
// rest; close() hides it again.
//
// This file only defines functions. They run later, when app.js calls
// setUpEditDialog() and when someone clicks a booking (drag.js).

// Which booking the window is currently editing (its id), or null.
let editingId = null;

// Run once when the page opens: fill the fixed dropdowns and hook up buttons.
function setUpEditDialog() {
  fillUserOptions(document.getElementById("edit-user"));
  fillTimeOptions(document.getElementById("edit-start"));
  fillTimeOptions(document.getElementById("edit-end"));

  document.getElementById("edit-form").addEventListener("submit", handleSaveEdit);
  document.getElementById("edit-delete").addEventListener("click", handleDelete);
  document.getElementById("edit-cancel").addEventListener("click", closeEditDialog);
  document.getElementById("copy-button").addEventListener("click", handleCopy);
  document.getElementById("edit-start").addEventListener("change", updateEditNextDayHint);
  document.getElementById("edit-end").addEventListener("change", updateEditNextDayHint);
  document.getElementById("edit-day").addEventListener("change", updateEditNextDayHint);
}

// Open the window for one booking, with its current values filled in.
function openEditDialog(id) {
  const booking = findBooking(id);
  if (!booking) return;
  editingId = id;

  const timeZone = ZONES[currentZone].timeZone;
  const startDay = dayKeyInZone(booking.startMs, timeZone);

  document.getElementById("edit-user").value = booking.user;
  fillWindowDayOptions(document.getElementById("edit-day"), startDay, startDay);
  document.getElementById("edit-start").value = minutesInZone(booking.startMs, timeZone);
  document.getElementById("edit-end").value = minutesInZone(booking.endMs, timeZone);
  updateEditNextDayHint();

  // Copy section: suggest the day after the booking's day.
  fillWindowDayOptions(document.getElementById("copy-day"), addDays(startDay, 1), null);

  showEditMessage("", false);
  document.getElementById("edit-dialog").showModal();
}

function closeEditDialog() {
  editingId = null;
  document.getElementById("edit-dialog").close();
}

function updateEditNextDayHint() {
  const start = Number(document.getElementById("edit-start").value);
  const end = Number(document.getElementById("edit-end").value);
  document.getElementById("edit-next-day-hint").textContent = nextDayHintText(start, end);
  // Show the zone next to the times, e.g. "CEST", for the chosen day.
  const day = document.getElementById("edit-day").value;
  document.getElementById("edit-zone").textContent =
    zoneAbbreviation(currentZone, zonedTimeToMs(day, start, ZONES[currentZone].timeZone));
}

// A message inside the window (red if it's a problem).
function showEditMessage(text, isError) {
  const message = document.getElementById("edit-message");
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

// "Save" button: check the new values, then save them.
function handleSaveEdit(event) {
  event.preventDefault(); // stop the form from reloading the page

  // Someone else may have deleted it while this window was open.
  if (!findBooking(editingId)) {
    showEditMessage("Someone else just deleted this booking.", true);
    return;
  }

  const user = document.getElementById("edit-user").value;
  const dayKey = document.getElementById("edit-day").value;
  const startMinutes = Number(document.getElementById("edit-start").value);
  const endMinutes = Number(document.getElementById("edit-end").value);
  const { startMs, endMs } = rangeFromChoices(dayKey, startMinutes, endMinutes);

  // editingId is passed so the booking doesn't clash with its old self.
  const problem = problemWithTimes(startMs, endMs, editingId);
  if (problem) {
    showEditMessage(problem, true);
    return;
  }

  updateBooking(editingId, { user: user, startMs: startMs, endMs: endMs });
  closeEditDialog();
  showMessage("Saved " + user + ", " + formatDayHeader(dayKey) + " " +
    minutesToText(startMinutes) + "–" + minutesToText(endMinutes) + " " +
    zoneAbbreviation(currentZone, startMs) + ".", false);
  weekIndex = weekIndexOfDay(dayKey); // show the week the booking is now in
  render();
}

// "Delete" button: ask first, because this can't be undone.
function handleDelete() {
  const booking = findBooking(editingId);
  if (!booking) return;
  const description = booking.user + ", " + describeBooking(booking, ZONES[currentZone].timeZone);
  // confirm() is the browser's built-in OK/Cancel box. It returns true on OK.
  if (!confirm("Delete this booking?\n" + description)) return;

  deleteBooking(editingId);
  closeEditDialog();
  showMessage("Deleted " + description + ".", false);
  render();
}

// "Copy" button: make a NEW booking on the chosen day, with the same
// start time and the same length. The original stays where it is.
function handleCopy() {
  const booking = findBooking(editingId);
  if (!booking) return;

  const timeZone = ZONES[currentZone].timeZone;
  const copyDay = document.getElementById("copy-day").value;
  const startMs = zonedTimeToMs(copyDay, minutesInZone(booking.startMs, timeZone), timeZone);
  const endMs = startMs + (booking.endMs - booking.startMs); // same length

  // No ignoreId here: the copy must not overlap the original either.
  const problem = problemWithTimes(startMs, endMs, null);
  if (problem) {
    showEditMessage(problem, true);
    return;
  }

  const copy = { id: newBookingId(), user: booking.user, startMs: startMs, endMs: endMs };
  addBooking(copy);
  closeEditDialog();
  showMessage("Copied to " + describeBooking(copy, timeZone) + ".", false);
  weekIndex = weekIndexOfDay(copyDay);
  render();
}
