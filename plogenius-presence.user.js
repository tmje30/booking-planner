// ==UserScript==
// @name         Booking Planner – plogenius "in use" signal
// @namespace    https://tmje30.github.io/booking-planner/
// @version      1.3.0
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
// So that a forgotten, idle plogenius window doesn't look "in use"
// forever: every 2 hours it asks "Still using plogenius?". If nobody
// clicks "Continue" within 10 minutes, it logs you out (stops the signals
// and tells the planner straight away). Reloading plogenius, or clicking
// "Log back in", starts it again.
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

  const SIGNAL_EVERY_MS = 60 * 1000;          // send "still open" once a minute
  const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;  // ask "still using?" every 2 hours
  const ANSWER_WITHIN_MS = 10 * 60 * 1000;    // log out if no answer within 10 minutes

  const DOCS_PATH = "projects/" + PROJECT_ID + "/databases/(default)/documents";
  const API_BASE = "https://firestore.googleapis.com/v1/";

  // ---------- Pop-up panels ----------
  //
  // One function builds all our pop-ups (name choice, "still using?",
  // "logged out"). It returns { close, setText } so the caller can close
  // it or change its text (used for the countdown).
  //
  // Sizes use "vmin" = 1% of the window's shorter side, so the panel is
  // always a good share of the window, whatever zoom the site or browser
  // uses. The panel lives inside a "shadow root": a sealed-off box, so
  // the plogenius page's styles can't mess up our buttons (and ours can't
  // affect plogenius).
  function showPanel({ title, text, buttons, smallLink }) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6);
                    display: flex; align-items: center; justify-content: center;
                    font-family: system-ui, "Segoe UI", sans-serif; }
        .panel { background: #fff; color: #1f2430; border-radius: 2vmin;
                 padding: 4vmin 5vmin; box-shadow: 0 1.5vmin 4vmin rgba(0,0,0,.45);
                 width: 60vmin; max-width: 90vw; text-align: center; }
        h2 { margin: 0 0 1.2vmin; font-size: 4.2vmin; }
        p { margin: 0 0 3vmin; font-size: 2.4vmin; color: #4b5563; line-height: 1.4; }
        button.big { display: block; width: 100%; margin: 1.6vmin 0; padding: 2.4vmin;
                     font-size: 3.4vmin; font-weight: 700; color: #fff; border: none;
                     border-radius: 1.4vmin; cursor: pointer; }
        button.big:hover { filter: brightness(1.1); }
        button.small { margin-top: 1.2vmin; background: none; border: none;
                       color: #6b7280; font-size: 2vmin; cursor: pointer; }
        /* Invisible 100px-wide ruler, used to detect page zoom (see below). */
        .probe { position: absolute; width: 100px; height: 1px; visibility: hidden; }
      </style>
      <div class="probe"></div>
      <div class="backdrop">
        <div class="panel">
          <h2></h2>
          <p></p>
          <div class="buttons"></div>
        </div>
      </div>`;

    // textContent (not innerHTML) so text is always shown as plain text.
    root.querySelector("h2").textContent = title;
    root.querySelector("p").textContent = text;

    const close = () => host.remove();

    const buttonBox = root.querySelector(".buttons");
    for (const b of buttons) {
      const button = document.createElement("button");
      button.className = "big";
      button.textContent = b.label;
      button.style.background = b.color;
      button.addEventListener("click", () => { close(); b.onClick(); });
      buttonBox.appendChild(button);
    }
    if (smallLink) {
      const link = document.createElement("button");
      link.className = "small";
      link.textContent = smallLink.label;
      link.addEventListener("click", () => { close(); if (smallLink.onClick) smallLink.onClick(); });
      buttonBox.appendChild(link);
    }

    // Attach to the very top of the page (<html>), not <body>: some sites
    // shrink or zoom <body>, which would shrink our panel too.
    document.documentElement.appendChild(host);

    // If the site zooms the whole page, our 100px ruler comes out smaller
    // (or bigger). Zoom our panel by the opposite amount to undo it.
    const realWidth = root.querySelector(".probe").getBoundingClientRect().width;
    if (realWidth > 0 && Math.abs(realWidth - 100) > 2) {
      host.style.zoom = String(100 / realWidth);
    }

    return { close, setText: (newText) => { root.querySelector("p").textContent = newText; } };
  }

  // ---------- Who am I? ----------

  // Ask which user this browser belongs to. The answer is remembered
  // (GM_setValue stores it inside Tampermonkey, on this computer only).
  function showNamePicker(onChosen) {
    showPanel({
      title: "Booking Planner",
      text: "Who is using plogenius on this computer? (You only choose this once.)",
      buttons: USERS.map((user) => ({
        label: user.name,
        color: user.color, // same colours as the planner
        onClick: () => { GM_setValue("userName", user.name); onChosen(user.name); },
      })),
      smallLink: { label: "Not now" },
    });
  }

  // ---------- Talking to Firebase ----------

  // Send one "still open" signal: write to the document presence/<name>.
  // "REQUEST_TIME" means "use the database server's clock", so a wrong
  // clock on this computer can't confuse the planner.
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
    firestoreRequest("POST", API_BASE + DOCS_PATH + ":commit", { writes: [write] });
  }

  // Remove this user's signal, so the planner shows "free" straight away
  // (instead of waiting 3 minutes for the signals to go stale).
  function removeSignal(userName) {
    firestoreRequest("DELETE", API_BASE + DOCS_PATH + "/presence/" + encodeURIComponent(userName));
  }

  // GM_xmlhttpRequest is Tampermonkey's way of contacting another website
  // (here: Firebase) from inside the plogenius page.
  function firestoreRequest(method, url, body) {
    GM_xmlhttpRequest({
      method: method,
      url: url + "?key=" + API_KEY,
      headers: { "Content-Type": "application/json" },
      data: body ? JSON.stringify(body) : undefined,
      onload: (response) => {
        if (response.status !== 200) {
          console.warn("[Booking Planner] request refused:", response.status, response.responseText);
        }
      },
      onerror: () => console.warn("[Booking Planner] couldn't reach Firebase"),
    });
  }

  // ---------- Logged in / logged out ----------

  let signalTimer = null; // the once-a-minute signal
  let checkTimer = null;  // the 2-hour "still using?" timer
  let loggedIn = false;

  // Start sending: once now, then once a minute. `isFresh` = a new
  // session (sets "open since" to now); false when you click "Continue",
  // so the planner keeps showing when you really started.
  function logIn(userName, isFresh = true) {
    stopTimers();
    loggedIn = true;
    sendSignal(userName, isFresh);
    signalTimer = setInterval(() => sendSignal(userName, false), SIGNAL_EVERY_MS);
    checkTimer = setTimeout(() => askStillUsing(userName), CHECK_EVERY_MS);
  }

  function logOut(userName, becauseIdle) {
    stopTimers();
    loggedIn = false;
    removeSignal(userName);
    showPanel({
      title: becauseIdle ? "Logged out (no answer)" : "Logged out",
      text: "The Booking Planner now shows plogenius as free. Reloading plogenius also logs you back in.",
      buttons: [{ label: "Log back in", color: "#1a7f37", onClick: () => logIn(userName) }],
      smallLink: { label: "Close" },
    });
  }

  function stopTimers() {
    clearInterval(signalTimer);
    clearTimeout(checkTimer);
  }

  // Every 2 hours: "Still using plogenius?" with a 10-minute countdown.
  function askStillUsing(userName) {
    let secondsLeft = ANSWER_WITHIN_MS / 1000;
    const countdownText = () => {
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = String(secondsLeft % 60).padStart(2, "0");
      return "If you don't answer, you'll be logged out in " + minutes + ":" + seconds +
             ", so an idle window doesn't show as \"in use\".";
    };

    const panel = showPanel({
      title: "Still using plogenius?",
      text: countdownText(),
      buttons: [
        { label: "Continue", color: "#1a7f37", onClick: () => { clearInterval(countdown); logIn(userName, false); } },
        { label: "Log out", color: "#6b7280", onClick: () => { clearInterval(countdown); logOut(userName, false); } },
      ],
    });

    // Tick the countdown once a second; log out when it reaches 0.
    const countdown = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(countdown);
        panel.close();
        logOut(userName, true);
      } else {
        panel.setText(countdownText());
      }
    }, 1000);
  }

  // ---------- Start ----------

  // Items in the Tampermonkey icon's menu.
  GM_registerMenuCommand("Change my Booking Planner name", () => {
    showNamePicker(() => location.reload());
  });
  GM_registerMenuCommand("Log out of the Booking Planner", () => {
    const name = GM_getValue("userName", null);
    if (name && loggedIn) logOut(name, false);
  });

  const savedName = GM_getValue("userName", null);
  if (USERS.some((u) => u.name === savedName)) {
    logIn(savedName);
  } else {
    showNamePicker((name) => logIn(name)); // first time: ask, then start
  }
})();
