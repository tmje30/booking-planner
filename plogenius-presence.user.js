// ==UserScript==
// @name         Booking Planner – plogenius "in use" signal
// @namespace    https://tmje30.github.io/booking-planner/
// @version      1.0.0
// @description  While plogenius.com is open, tells the Booking Planner who is using it.
// @match        https://plogenius.com/*
// @match        https://*.plogenius.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      firestore.googleapis.com
// @updateURL    https://tmje30.github.io/booking-planner/plogenius-presence.user.js
// @downloadURL  https://tmje30.github.io/booking-planner/plogenius-presence.user.js
// ==/UserScript==

// plogenius-presence.user.js — a "userscript" for the Tampermonkey extension.
//
// What it does, in plain words:
// Tampermonkey runs this little program whenever a plogenius.com page is
// open in your browser. Once a minute it sends a tiny "I'm still open"
// signal to our Firebase database, under your name. The Booking Planner
// watches those signals: if one arrived in the last 3 minutes, it shows
// "In use: <your name>". When you close plogenius (or your computer
// sleeps), the signals stop, and after 3 minutes the planner shows "Free".
//
// It sends ONLY your chosen name and the time. It does not read anything
// from the plogenius page.
//
// The @lines at the top are instructions for Tampermonkey: which sites to
// run on (@match), what it's allowed to do (@grant), which server it may
// talk to (@connect), and where to fetch updates (@updateURL).

(function () {
  "use strict";

  // ---------- Settings ----------

  // Must match USERS in js/bookings.js (and the list in firestore.rules).
  const USERS = ["Baby4Life", "Tripplelift", "Red.ElinGho"];

  // Same public Firebase details as js/firebase-config.js.
  const API_KEY = "AIzaSyB_CTFK4MZ1JeSTWOiSp7xAwPHKLiAwFEw";
  const PROJECT_ID = "solver-booking";

  const SIGNAL_EVERY_MS = 60 * 1000; // send "still open" once a minute

  const DOCS_PATH = "projects/" + PROJECT_ID + "/databases/(default)/documents";
  const COMMIT_URL = "https://firestore.googleapis.com/v1/" + DOCS_PATH + ":commit?key=" + API_KEY;

  // ---------- Who am I? ----------

  // Ask once which user this browser belongs to, and remember the answer
  // (GM_setValue stores it inside Tampermonkey, on this computer only).
  function askForName() {
    const list = USERS.map((name, i) => (i + 1) + " = " + name).join("\n");
    const answer = prompt("Booking Planner: who are you on this computer?\n" + list + "\n\nType the number:");
    const name = USERS[Number(answer) - 1];
    if (name) GM_setValue("userName", name);
    return name || null;
  }

  let userName = GM_getValue("userName", null);
  if (!USERS.includes(userName)) userName = askForName();
  if (!userName) return; // no name chosen: do nothing this time

  // A menu item in the Tampermonkey icon, in case the name needs changing.
  GM_registerMenuCommand("Change my Booking Planner name (now: " + userName + ")", () => {
    const name = askForName();
    if (name) location.reload();
  });

  // ---------- Sending the signal ----------

  // Firestore's REST API: we send one "write" to the document
  // presence/<userName>. "REQUEST_TIME" means "use the database server's
  // clock", so a wrong clock on this computer can't confuse the planner.
  function sendSignal(isFirst) {
    const write = {
      update: {
        name: DOCS_PATH + "/presence/" + encodeURIComponent(userName),
        fields: { user: { stringValue: userName } },
      },
      // Only change these fields; keep "openedAt" from the first signal.
      updateMask: { fieldPaths: ["user"] },
      updateTransforms: [{ fieldPath: "lastSeen", setToServerValue: "REQUEST_TIME" }],
    };
    if (isFirst) {
      write.updateTransforms.push({ fieldPath: "openedAt", setToServerValue: "REQUEST_TIME" });
    }

    // GM_xmlhttpRequest is Tampermonkey's way of contacting another
    // website (here: Firebase) from inside the plogenius page.
    GM_xmlhttpRequest({
      method: "POST",
      url: COMMIT_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ writes: [write] }),
      onload: (response) => {
        if (response.status !== 200) {
          console.warn("[Booking Planner] signal refused:", response.status, response.responseText);
        }
      },
      onerror: () => console.warn("[Booking Planner] couldn't reach Firebase"),
    });
  }

  sendSignal(true);                                  // "just opened"
  setInterval(() => sendSignal(false), SIGNAL_EVERY_MS); // "still open"
})();
