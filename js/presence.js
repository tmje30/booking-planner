// presence.js — the "In use / Free" banner at the top of the planner.
//
// The Tampermonkey script (plogenius-presence.user.js) sends a signal
// once a minute while someone has plogenius.com open. Those signals are
// stored in Firestore in a collection called "presence" (one document
// per user, holding "lastSeen" = when the latest signal arrived).
//
// This file listens to those documents and shows:
//   🟢 In use: Tripplelift · open since 14:05 CEST
// or, if no signal arrived in the last few minutes:
//   ⚪ Free · next booking: Red.ElinGho at 18:00 CEST
//
// Loaded before app.js; app.js calls startPresence() after the bookings
// storage has started (it needs the `db` connection from bookings.js).

// If no signal arrived for this long, the app counts as closed.
// (Signals come once a minute; browsers may slow down background tabs,
// so we allow a few missed ones.)
const PRESENCE_TIMEOUT_MS = 3 * 60 * 1000;

// The latest presence documents from Firestore, e.g.
// [{ user: "Tripplelift", openedAtMs: ..., lastSeenMs: ... }]
let presenceList = [];

function startPresence() {
  if (!db) return; // test mode: there's no shared database, so no banner

  document.getElementById("presence-banner").hidden = false;

  db.collection("presence").onSnapshot(
    (snapshot) => {
      presenceList = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          user: data.user,
          // Firestore times come as "Timestamp" objects; toMillis() turns
          // them into our usual milliseconds-since-1970 numbers.
          openedAtMs: data.openedAt ? data.openedAt.toMillis() : null,
          lastSeenMs: data.lastSeen ? data.lastSeen.toMillis() : 0,
        };
      });
      drawPresenceBanner();
    },
    (error) => console.warn("Presence unavailable:", error.message)
  );

  // Re-check every 15 seconds, so "In use" turns into "Free" by itself
  // when the signals stop (no new data arrives in that case).
  setInterval(drawPresenceBanner, 15 * 1000);
}

// Fill in the banner text and colour.
function drawPresenceBanner() {
  const banner = document.getElementById("presence-banner");
  const timeZone = ZONES[currentZone].timeZone;
  const now = Date.now();

  const activeUsers = presenceList.filter((p) => now - p.lastSeenMs < PRESENCE_TIMEOUT_MS);

  if (activeUsers.length > 0) {
    const parts = activeUsers.map((p) => {
      let text = p.user;
      if (p.openedAtMs) {
        text += " · open since " + timeTextInZone(p.openedAtMs, timeZone) + " " +
                zoneAbbreviation(currentZone, p.openedAtMs);
      }
      return text;
    });
    banner.textContent = "🟢 plogenius in use: " + parts.join("  and  ");
    banner.className = "presence-banner presence-in-use";
  } else {
    banner.textContent = "⚪ plogenius is free · " + nextBookingText(now, timeZone);
    banner.className = "presence-banner presence-free";
  }
}

// "next booking: Red.ElinGho at 18:00 CEST", or who has it booked right now.
function nextBookingText(now, timeZone) {
  // Bookings that haven't ended yet, earliest first.
  const upcoming = allBookings
    .filter((b) => b.endMs > now)
    .sort((a, b) => a.startMs - b.startMs);

  if (upcoming.length === 0) return "no upcoming bookings";

  const next = upcoming[0];
  const zone = " " + zoneAbbreviation(currentZone, next.startMs);

  if (next.startMs <= now) {
    return "booked now by " + next.user + " until " + timeTextInZone(next.endMs, timeZone) + zone;
  }

  // Add the day if it isn't today, e.g. "Wed 30 Sept 18:00".
  const day = dayKeyInZone(next.startMs, timeZone);
  const dayText = day === todayKey(timeZone) ? "" : formatDayHeader(day) + " ";
  return "next booking: " + next.user + " at " + dayText + timeTextInZone(next.startMs, timeZone) + zone;
}
