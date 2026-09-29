// bookings.js — the users list and everything about storing bookings.
//
// Loaded after time.js and before app.js.
//
// What a booking looks like (this is the same shape we'll save in
// Firebase later):
//   {
//     id:      "b-1727600000000-4821",  // unique name for this booking
//     user:    "Tripplelift",           // who booked it
//     startMs: 1727604000000,           // when it starts
//     endMs:   1727611200000,           // when it ends
//   }
//
// "Ms" means milliseconds since 1 Jan 1970 UTC. That's how computers
// usually store a moment in time: one big number that is the SAME for
// everyone, no matter their time zone. We only turn it into "14:00 in
// Singapore" or "08:00 in Copenhagen" when showing it on screen.

// ---------- Users ----------

// The fixed list of users and their colours on the planner.
// To add or remove a user, edit this list AND the list in firestore.rules
// (then re-publish the rules in the Firebase console).
const USERS = [
  { name: "Baby4Life",   color: "#e76f51" }, // orange
  { name: "Tripplelift", color: "#2a9d8f" }, // teal
  { name: "Red.ElinGho", color: "#7b61ff" }, // purple
];

function colorForUser(name) {
  const user = USERS.find((u) => u.name === name);
  return user ? user.color : "#888888"; // grey for unknown names
}

// ---------- Storage ----------
//
// The planner can run in two modes:
//
// LIVE mode (FIREBASE_CONFIG in firebase-config.js is filled in):
//   bookings are stored in Firebase's Firestore database, in a
//   "collection" (think: a folder) called "bookings". Each booking is one
//   "document" (think: a small record) named by its id. Firestore tells
//   every open page about changes within a second or so; that's the
//   "live updates" part.
//
// TEST mode (FIREBASE_CONFIG is null):
//   bookings are kept in this browser's localStorage, so only YOU see them.
//
// The rest of the app doesn't care which mode is on: it only uses
// allBookings and the add/update/delete functions below.

const BOOKINGS_COLLECTION = "bookings";                  // name of the collection in Firestore
const BOOKINGS_STORAGE_KEY = "bookingPlanner.testBookings"; // where TEST mode keeps bookings

// Every booking we know about. Other files read this list.
let allBookings = [];

// The Firestore connection in LIVE mode (null in TEST mode).
let db = null;

// Functions app.js gives us, so we can tell it about changes:
// onBookingsChanged() = "redraw please"; onStatus(kind, text) = update the status label.
let onBookingsChanged = () => {};
let onStatus = () => {};

// Called once by app.js when the page opens.
function startStorage(changedCallback, statusCallback) {
  onBookingsChanged = changedCallback;
  onStatus = statusCallback;

  if (!FIREBASE_CONFIG) {
    startTestStorage();
  } else if (typeof firebase === "undefined") {
    // The Firebase scripts in index.html didn't load (e.g. no internet).
    onStatus("error", "Couldn't load Firebase. Check your internet connection and reload.");
  } else {
    startLiveStorage();
  }
}

function startTestStorage() {
  try {
    const text = localStorage.getItem(BOOKINGS_STORAGE_KEY);
    allBookings = text ? JSON.parse(text) : [];
  } catch (error) {
    allBookings = []; // storage blocked or data unreadable: start empty
  }
  onStatus("test", "Test mode: bookings are only saved on this computer");
  removeOldBookings();
  onBookingsChanged();
}

function startLiveStorage() {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
  onStatus("connecting", "Connecting…");

  let firstTime = true;

  // onSnapshot = "keep me updated". Firestore calls the first function
  // straight away with all bookings, and again every time anyone adds,
  // changes or deletes a booking.
  db.collection(BOOKINGS_COLLECTION).onSnapshot(
    (snapshot) => {
      allBookings = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      onStatus("live", "Live: shared with everyone");
      if (firstTime) {
        firstTime = false;
        removeOldBookings();
      }
      onBookingsChanged();
    },
    (error) => {
      // Called if Firestore refuses or can't be reached.
      onStatus("error", "Can't reach the database: " + error.message);
    }
  );
}

// TEST mode only: write the whole list to localStorage.
function saveTestBookings() {
  try {
    // JSON.stringify turns the list into text so it can be stored.
    localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(allBookings));
  } catch (error) {
    // Couldn't save; bookings still work until the page is closed.
  }
}

// If a write to Firestore fails (e.g. the security rules refused it),
// show why, and let the live update put the screen back to the truth.
function reportWriteError(error) {
  onStatus("error", "Couldn't save that change: " + error.message);
}

// Only these fields are stored in Firestore (the id is the document's name).
function bookingFields(booking) {
  return { user: booking.user, startMs: booking.startMs, endMs: booking.endMs };
}

// Add a booking. We also update our own list straight away, so the screen
// changes instantly instead of waiting for the database to reply.
function addBooking(booking) {
  allBookings.push(booking);
  if (db) {
    db.collection(BOOKINGS_COLLECTION).doc(booking.id).set(bookingFields(booking)).catch(reportWriteError);
  } else {
    saveTestBookings();
  }
}

// Change some fields of an existing booking (e.g. new times).
// `changes` holds just the fields that change, e.g. { startMs: ..., endMs: ... }.
function updateBooking(id, changes) {
  const booking = findBooking(id);
  if (!booking) return;
  Object.assign(booking, changes); // copy the changed fields onto the booking
  if (db) {
    db.collection(BOOKINGS_COLLECTION).doc(id).update(changes).catch(reportWriteError);
  } else {
    saveTestBookings();
  }
}

// Remove a booking for good.
function deleteBooking(id) {
  allBookings = allBookings.filter((b) => b.id !== id);
  if (db) {
    db.collection(BOOKINGS_COLLECTION).doc(id).delete().catch(reportWriteError);
  } else {
    saveTestBookings();
  }
}

// Look up a booking by its id (or undefined if it doesn't exist).
function findBooking(id) {
  return allBookings.find((b) => b.id === id);
}

// Make a unique id, e.g. "b-1727600000000-4821".
function newBookingId() {
  return "b-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
}

// ---------- Cleaning up old bookings ----------
//
// Rule from the PRD: a booking is deleted once it ended before the start
// of YESTERDAY in Copenhagen time. (Copenhagen is the zone that's behind,
// and "yesterday" gives an extra 24 hours of safety.)
// There's no server of our own, so this runs whenever someone opens the
// page (and at midnight if the page is left open).
function removeOldBookings() {
  const copenhagen = ZONES.CPH.timeZone;
  const yesterday = addDays(todayKey(copenhagen), -1);
  const cutoffMs = zonedTimeToMs(yesterday, 0, copenhagen); // yesterday 00:00 Copenhagen

  const oldOnes = allBookings.filter((b) => b.endMs < cutoffMs);
  for (const booking of oldOnes) deleteBooking(booking.id);
}

// ---------- Overlap check ----------
//
// Two bookings clash if one starts before the other ends, AND the other
// starts before the first ends. Back-to-back (one ends 14:00, next starts
// 14:00) does NOT count as a clash.
//
// Returns the first clashing booking, or null if there's no clash.
// `ignoreId` lets us skip a booking when checking itself (needed later,
// when moving or editing a booking).
function findClash(startMs, endMs, ignoreId) {
  for (const other of allBookings) {
    if (other.id === ignoreId) continue;
    if (startMs < other.endMs && other.startMs < endMs) return other;
  }
  return null;
}
