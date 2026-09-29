// drag.js — moving (and copying) bookings by dragging them with the mouse.
//
// How it works, in plain words:
// 1. You press the mouse button on a booking block ("pointerdown").
// 2. As you move the mouse ("pointermove"), we work out which day and
//    time is under the pointer, and draw the booking there as a preview.
//    The new start snaps to the nearest 15 minutes.
// 3. When you let go ("pointerup"), we check for clashes and save.
//    If the mouse barely moved, it was a click, so we open the Edit window.
//
// Hold Ctrl while you let go to COPY instead of move.
// Press Escape while dragging to cancel.
//
// Browsers call these "pointer" events; they cover mouse, pen and touch.

// Information about the drag in progress, or null when not dragging.
let dragState = null;

// How far (in pixels) the mouse must move before a press counts as a drag.
const DRAG_THRESHOLD_PX = 5;

// 15 minutes in milliseconds (15 × 60 × 1000).
const SNAP_MS = 15 * 60 * 1000;

// Run once when the page opens.
function setUpDragging() {
  // We listen on the whole planner rather than on each block, because the
  // blocks are redrawn often. event.target tells us what was pressed.
  document.getElementById("planner").addEventListener("pointerdown", startDrag);
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dragState) {
      dragState = null;
      drawBookings(); // put the booking back where it was
    }
  });
}

function startDrag(event) {
  if (event.button !== 0) return; // left mouse button only
  const block = event.target.closest(".booking"); // the block that was pressed, if any
  if (!block) return;
  const booking = findBooking(block.dataset.id);
  if (!booking) return;

  event.preventDefault(); // stop the browser selecting text while dragging

  // Remember WHERE on the booking you grabbed it (e.g. 30 minutes after
  // its start), so it doesn't jump when you start moving.
  const pointerMs = pointerToMs(event.clientX, event.clientY);

  dragState = {
    booking: booking,
    grabOffsetMs: pointerMs - booking.startMs,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    newStartMs: booking.startMs,
    copy: false,
  };
}

function moveDrag(event) {
  if (!dragState) return;

  // Ignore tiny wobbles, so a normal click still counts as a click.
  if (!dragState.moved) {
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (distance < DRAG_THRESHOLD_PX) return;
    dragState.moved = true;
  }

  const pointerMs = pointerToMs(event.clientX, event.clientY);
  // Snap to 15 minutes. Both our zones are a whole number of hours from
  // UTC, so snapping the real moment also snaps the clock time.
  dragState.newStartMs = Math.round((pointerMs - dragState.grabOffsetMs) / SNAP_MS) * SNAP_MS;
  dragState.copy = event.ctrlKey;
  drawBookings(); // redraw with the preview in its new spot
}

function endDrag(event) {
  if (!dragState) return;
  const state = dragState;
  dragState = null;

  if (!state.moved) {
    openEditDialog(state.booking.id); // it was a click, not a drag
    return;
  }

  const booking = state.booking;
  const copy = event.ctrlKey;
  const startMs = state.newStartMs;
  const endMs = startMs + (booking.endMs - booking.startMs); // same length
  const timeZone = ZONES[currentZone].timeZone;

  if (startMs === booking.startMs && !copy) {
    drawBookings(); // dropped where it started: nothing to do
    return;
  }

  // When moving, the booking may overlap its own old position, so ignore it.
  // When copying, the copy must not overlap the original.
  const problem = problemWithTimes(startMs, endMs, copy ? null : booking.id);
  if (problem) {
    showMessage(problem, true);
    drawBookings(); // snap back to where it was
    return;
  }

  if (copy) {
    const newBooking = { id: newBookingId(), user: booking.user, startMs: startMs, endMs: endMs };
    addBooking(newBooking);
    showMessage("Copied to " + describeBooking(newBooking, timeZone) + ".", false);
  } else {
    updateBooking(booking.id, { startMs: startMs, endMs: endMs });
    showMessage("Moved " + booking.user + " to " + describeBooking(booking, timeZone) + ".", false);
  }
  render();
}

// Work out which moment in time is under the mouse pointer: which day
// column it's over, and how far down that column (00:00 at the top,
// 24:00 at the bottom).
function pointerToMs(clientX, clientY) {
  const columns = [...document.querySelectorAll(".day-column")];

  // Find the column under the pointer. If the pointer is off to the side,
  // use the nearest column (first or last).
  let column = columns.find((c) => {
    const box = c.getBoundingClientRect();
    return clientX >= box.left && clientX < box.right;
  });
  if (!column) {
    const firstBox = columns[0].getBoundingClientRect();
    column = clientX < firstBox.left ? columns[0] : columns[columns.length - 1];
  }

  const box = column.getBoundingClientRect();
  const fraction = Math.min(Math.max((clientY - box.top) / box.height, 0), 1); // 0 to 1
  const minutes = fraction * 24 * 60;
  return zonedTimeToMs(column.dataset.day, minutes, ZONES[currentZone].timeZone);
}

// The list of bookings drawBookings() should draw. Normally that's just
// every booking; during a drag, the dragged booking is shown at its new
// position (and for a copy, the original stays too).
function getBookingsToDraw() {
  if (!dragState || !dragState.moved) return allBookings;

  const original = dragState.booking;
  const startMs = dragState.newStartMs;
  const endMs = startMs + (original.endMs - original.startMs);
  const problem = problemWithTimes(startMs, endMs, dragState.copy ? null : original.id);

  const preview = {
    id: original.id,
    user: original.user,
    startMs: startMs,
    endMs: endMs,
    isPreview: true,
    hasProblem: problem !== null,
  };

  if (dragState.copy) return allBookings.concat([preview]);
  return allBookings.filter((b) => b.id !== original.id).concat([preview]);
}
