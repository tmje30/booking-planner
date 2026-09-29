// ==UserScript==
// @name         Booking Planner – plogenius "in use" signal
// @namespace    https://tmje30.github.io/booking-planner/
// @version      1.2.0
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
  const USERS = [
    { name: "Baby4Life",   color: "#e76f51" },
    { name: "Tripplelift", color: "#2a9d8f" },
    { name: "Red.ElinGho", color: "#7b61ff" },
  ];

  // Same public Firebase details as js/firebase-config.js.
  const API_KEY = "AIzaSyB_CTFK4MZ1JeSTWOiSp7xAwPHKLiAwFEw";
  const PROJECT_ID = "solver-booking";

  const SIGNAL_EVERY_MS = 60 * 1000; // send "still open" once a minute

  const DOCS_PATH = "projects/" + PROJECT_ID + "/databases/(default)/documents";
  const COMMIT_URL = "https://firestore.googleapis.com/v1/" + DOCS_PATH + ":commit?key=" + API_KEY;

  // ---------- Who am I? ----------

  // Show a small panel with one button per user. When a button is
  // clicked, the name is remembered (GM_setValue stores it inside
  // Tampermonkey, on this computer only) and `onChosen(name)` runs.
  //
  // The panel lives inside a "shadow root": a sealed-off box, so the
  // plogenius page's own styles can't mess up our buttons (and ours
  // can't affect plogenius).
  function showNamePicker(onChosen) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55);
                    display: flex; align-items: center; justify-content: center;
                    font-family: system-ui, "Segoe UI", sans-serif; }
        .panel { background: #fff; color: #1f2430; border-radius: 18px;
                 padding: 36px 44px; box-shadow: 0 14px 40px rgba(0,0,0,.45);
                 width: 480px; max-width: 90vw; text-align: center; }
        h2 { margin: 0 0 10px; font-size: 32px; }
        p { margin: 0 0 24px; font-size: 18px; color: #6b7280; line-height: 1.4; }
        button.name { display: block; width: 100%; margin: 14px 0; padding: 20px;
                      font-size: 26px; font-weight: 700; color: #fff; border: none;
                      border-radius: 12px; cursor: pointer; }
        button.name:hover { filter: brightness(1.1); }
        button.later { margin-top: 10px; background: none; border: none;
                       color: #6b7280; font-size: 16px; cursor: pointer; }
        /* Invisible 100px-wide ruler, used to detect page zoom (see below). */
        .probe { position: absolute; width: 100px; height: 1px; visibility: hidden; }
      </style>
      <div class="probe"></div>
      <div class="backdrop">
        <div class="panel">
          <h2>Booking Planner</h2>
          <p>Who is using plogenius on this computer?<br>(You only choose this once.)</p>
          <div class="buttons"></div>
          <button class="later">Not now</button>
        </div>
      </div>`;

    // One coloured button per user (same colours as the planner).
    const buttons = root.querySelector(".buttons");
    for (const user of USERS) {
      const button = document.createElement("button");
      button.className = "name";
      button.textContent = user.name;
      button.style.background = user.color;
      button.addEventListener("click", () => {
        GM_setValue("userName", user.name);
        host.remove();
        onChosen(user.name);
      });
      buttons.appendChild(button);
    }
    root.querySelector(".later").addEventListener("click", () => host.remove());

    // Attach to the very top of the page (<html>), not <body>: some sites
    // shrink or zoom <body>, which would shrink our panel too.
    document.documentElement.appendChild(host);

    // plogenius scales its page down. Measure how wide our 100px ruler
    // really is; if it came out smaller (e.g. 40px), zoom our panel back up
    // by the same amount so it shows at normal size.
    const realWidth = root.querySelector(".probe").getBoundingClientRect().width;
    if (realWidth > 0 && Math.abs(realWidth - 100) > 2) {
      host.style.zoom = String(100 / realWidth);
    }
  }

  // A menu item in the Tampermonkey icon, in case the name needs changing.
  GM_registerMenuCommand("Change my Booking Planner name", () => {
    showNamePicker(() => location.reload());
  });

  const savedName = GM_getValue("userName", null);
  if (USERS.some((u) => u.name === savedName)) {
    startSignals(savedName);
  } else {
    showNamePicker(startSignals); // first time: ask, then start
  }

  // ---------- Sending the signal ----------

  // Firestore's REST API: we send one "write" to the document
  // presence/<userName>. "REQUEST_TIME" means "use the database server's
  // clock", so a wrong clock on this computer can't confuse the planner.
  function sendSignal(userName, isFirst) {
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

  // Start sending: once now ("just opened"), then once a minute ("still open").
  function startSignals(userName) {
    sendSignal(userName, true);
    setInterval(() => sendSignal(userName, false), SIGNAL_EVERY_MS);
  }
})();
