// ==UserScript==
// @name         Booking Planner – plogenius "in use" signal
// @namespace    https://tmje30.github.io/booking-planner/
// @version      1.4.0
// @description  Shows the Booking Planner status when plogenius.com opens, and tells the planner who is using it.
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
//
// 1. When you open plogenius.com, it shows a "Booking Planner" card:
//    is someone using plogenius right now, who has it booked now, and
//    whose booking is next. If nobody is using it, you can book 1 or 2
//    hours from the card. You only count as "in use" once you press one
//    of the Start buttons.
//
// 2. While you're "in use", it sends a tiny "I'm still here" signal to our
//    Firebase database once a minute, under your name. The Booking Planner
//    watches those signals and shows "In use: <your name>". When you close
//    plogenius (or your computer sleeps), the signals stop, and after
//    3 minutes the planner shows "Free".
//
// 3. So that a forgotten, idle window doesn't look "in use" forever:
//    every 2 hours it asks "Still using plogenius?". If nobody clicks
//    "Continue" within 10 minutes, it logs you out and shows the card again.
//
// It sends ONLY your chosen name, the time, and bookings you make from the
// card. It does not read anything from the plogenius page.
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
  const PLANNER_URL = "https://tmje30.github.io/booking-planner/";

  const SIGNAL_EVERY_MS = 60 * 1000;          // send "still here" once a minute
  const IN_USE_TIMEOUT_MS = 3 * 60 * 1000;    // same as the planner: no signal for 3 min = not in use
  const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;  // ask "still using?" every 2 hours
  const ANSWER_WITHIN_MS = 10 * 60 * 1000;    // log out if no answer within 10 minutes
  const QUARTER_HOUR_MS = 15 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  const DOCS_PATH = "projects/" + PROJECT_ID + "/databases/(default)/documents";
  const API_BASE = "https://firestore.googleapis.com/v1/";

  // Show times in Singapore time if this computer is set to Singapore,
  // otherwise Copenhagen time (the same default the planner uses).
  const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Singapore"
    ? "Asia/Singapore" : "Europe/Copenhagen";

  // ---------- Pop-up panels ----------
  //
  // One function builds all our pop-ups. It returns { close, setText } so
  // the caller can close it or change its text (used for the countdown).
  //
  //   title    — big heading
  //   lines    — list of text lines (the first one is shown bigger/bold)
  //   buttons  — list of { label, color, onClick, disabled, note, keepOpen }
  //   smallLink — optional small grey link at the bottom, e.g. "Not now"
  //
  // Sizes use "vmin" = 1% of the window's shorter side, so the panel is
  // always a good share of the window, whatever zoom the site or browser
  // uses. The panel lives inside a "shadow root": a sealed-off box, so the
  // plogenius page's styles can't mess up our buttons (and ours can't
  // affect plogenius).
  function showPanel({ title, lines, buttons, smallLink }) {
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
                 width: 64vmin; max-width: 90vw; max-height: 92vh; overflow: auto;
                 text-align: center; }
        h2 { margin: 0 0 1.6vmin; font-size: 4.2vmin; }
        .lines p { margin: 0 0 1vmin; font-size: 2.4vmin; color: #4b5563; line-height: 1.4; }
        .lines p:first-child { font-size: 3vmin; font-weight: 700; color: #1f2430; }
        .buttons { margin-top: 2.6vmin; }
        button.big { display: block; width: 100%; margin: 1.4vmin 0 0; padding: 2.2vmin;
                     font-size: 3.2vmin; font-weight: 700; color: #fff; border: none;
                     border-radius: 1.4vmin; cursor: pointer; }
        button.big:hover:not(:disabled) { filter: brightness(1.1); }
        button.big:disabled { opacity: .45; cursor: default; }
        .note { font-size: 1.9vmin; color: #6b7280; margin: .6vmin 0 0; }
        button.small { margin-top: 2vmin; background: none; border: none;
                       color: #6b7280; font-size: 2.2vmin; cursor: pointer; }
        /* Invisible 100px-wide ruler, used to detect page zoom (see below). */
        .probe { position: absolute; width: 100px; height: 1px; visibility: hidden; }
      </style>
      <div class="probe"></div>
      <div class="backdrop">
        <div class="panel">
          <h2></h2>
          <div class="lines"></div>
          <div class="buttons"></div>
        </div>
      </div>`;

    const close = () => host.remove();

    // textContent (not innerHTML) so text is always shown as plain text.
    root.querySelector("h2").textContent = title;
    const setText = (newLines) => {
      const box = root.querySelector(".lines");
      box.innerHTML = "";
      for (const line of [].concat(newLines)) {
        const p = document.createElement("p");
        p.textContent = line;
        box.appendChild(p);
      }
    };
    setText(lines);

    const buttonBox = root.querySelector(".buttons");
    for (const b of buttons) {
      const button = document.createElement("button");
      button.className = "big";
      button.textContent = b.label;
      button.style.background = b.color;
      button.disabled = Boolean(b.disabled);
      button.addEventListener("click", () => {
        if (!b.keepOpen) close();
        b.onClick();
      });
      buttonBox.appendChild(button);
      if (b.note) {
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = b.note;
        buttonBox.appendChild(note);
      }
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

    return { close, setText };
  }

  // ---------- Time helpers ----------

  // A moment shown as a clock time, e.g. "14:05 CEST".
  function timeText(ms) {
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(ms));
    return clock + " " + zoneName(ms);
  }

  // "CEST" / "CET" / "SGT" for a moment.
  function zoneName(ms) {
    if (TIME_ZONE === "Asia/Singapore") return "SGT";
    const name = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, timeZoneName: "short" })
      .formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value;
    return name === "CEST" || name === "GMT+2" ? "CEST" : "CET";
  }

  // "today", "tomorrow" or e.g. "Thu 1 Oct" for a moment.
  function dayText(ms) {
    const dayKey = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(t));
    if (dayKey(ms) === dayKey(Date.now())) return "today";
    if (dayKey(ms) === dayKey(Date.now() + 24 * HOUR_MS)) return "tomorrow";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short",
    }).format(new Date(ms));
  }

  // ---------- Talking to Firebase ----------

  // GM_xmlhttpRequest is Tampermonkey's way of contacting another website
  // (here: Firebase) from inside the plogenius page. This wraps it in a
  // "Promise", so we can write `await firestoreRequest(...)` and wait for
  // the answer.
  function firestoreRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method,
        url: url + (url.includes("?") ? "&" : "?") + "key=" + API_KEY,
        headers: { "Content-Type": "application/json" },
        data: body ? JSON.stringify(body) : undefined,
        onload: (response) => {
          if (response.status === 200) {
            resolve(response.responseText ? JSON.parse(response.responseText) : {});
          } else {
            console.warn("[Booking Planner] request refused:", response.status, response.responseText);
            reject(new Error("refused (" + response.status + ")"));
          }
        },
        onerror: () => reject(new Error("couldn't reach Firebase")),
      });
    });
  }

  // Firestore sends numbers as text inside { integerValue: "123" } or
  // { doubleValue: 123 }, and times as { timestampValue: "2026-..." }.
  function readNumber(field) {
    return field ? Number(field.integerValue ?? field.doubleValue) : NaN;
  }
  function readTime(field) {
    return field && field.timestampValue ? Date.parse(field.timestampValue) : 0;
  }

  // Everything the status card needs: who is in use, and all bookings.
  async function loadPlannerStatus() {
    const [presence, bookings] = await Promise.all([
      firestoreRequest("GET", API_BASE + DOCS_PATH + "/presence"),
      firestoreRequest("GET", API_BASE + DOCS_PATH + "/bookings?pageSize=500"),
    ]);
    const now = Date.now();
    const activeUsers = (presence.documents || [])
      .map((doc) => ({
        user: doc.fields.user.stringValue,
        openedAtMs: readTime(doc.fields.openedAt),
        lastSeenMs: readTime(doc.fields.lastSeen),
      }))
      .filter((p) => now - p.lastSeenMs < IN_USE_TIMEOUT_MS);
    const allBookings = (bookings.documents || [])
      .map((doc) => ({
        user: doc.fields.user.stringValue,
        startMs: readNumber(doc.fields.startMs),
        endMs: readNumber(doc.fields.endMs),
      }))
      .filter((b) => b.endMs > now) // only current and future ones
      .sort((a, b) => a.startMs - b.startMs);
    return { activeUsers, upcomingBookings: allBookings };
  }

  // Send one "still here" signal: write to the document presence/<name>.
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
    firestoreRequest("POST", API_BASE + DOCS_PATH + ":commit", { writes: [write] }).catch(() => {});
  }

  // Remove this user's signal, so the planner shows "free" straight away
  // (instead of waiting 3 minutes for the signals to go stale).
  function removeSignal(userName) {
    firestoreRequest("DELETE", API_BASE + DOCS_PATH + "/presence/" + encodeURIComponent(userName))
      .catch(() => {});
  }

  // Save a booking in the planner (same shape the planner itself uses).
  function createBooking(userName, startMs, endMs) {
    const id = "b-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    return firestoreRequest("POST", API_BASE + DOCS_PATH + "/bookings?documentId=" + id, {
      fields: {
        user: { stringValue: userName },
        startMs: { integerValue: String(startMs) },
        endMs: { integerValue: String(endMs) },
      },
    });
  }

  // ---------- The status card ----------

  // Shown when plogenius opens, and after you've been logged out.
  async function showStatusCard(userName, heading) {
    let status;
    try {
      status = await loadPlannerStatus();
    } catch (error) {
      showPanel({
        title: heading || "Booking Planner",
        lines: ["Couldn't load the planner (" + error.message + ").",
                "You can still start, or check the planner yourself."],
        buttons: [
          { label: "Start using plogenius", color: "#1a7f37", onClick: () => logIn(userName) },
          openPlannerButton(),
        ],
        smallLink: { label: "Not now" },
      });
      return;
    }

    const now = Date.now();
    const lines = [];
    const others = status.activeUsers.filter((p) => p.user !== userName);
    const meInAnotherTab = status.activeUsers.some((p) => p.user === userName);

    // Line 1: is anyone using it right now?
    if (others.length > 0) {
      lines.push("🟢 " + others.map((p) => p.user + " is using plogenius (since " +
                 timeText(p.openedAtMs) + ")").join(" · "));
    } else if (meInAnotherTab) {
      lines.push("🟢 You're already logged in (in another tab or window).");
    } else {
      lines.push("⚪ Nobody is using plogenius right now.");
    }

    // Line 2: who has it booked right now, and whose booking is next.
    const bookedNow = status.upcomingBookings.find((b) => b.startMs <= now);
    const next = status.upcomingBookings.find((b) => b.startMs > now);
    if (bookedNow) {
      lines.push("Booked now: " + (bookedNow.user === userName ? "you" : bookedNow.user) +
                 " until " + timeText(bookedNow.endMs));
    }
    if (next) {
      lines.push("Next booking: " + (next.user === userName ? "you" : next.user) + ", " +
                 dayText(next.startMs) + " at " + timeText(next.startMs));
    } else if (!bookedNow) {
      lines.push("No upcoming bookings.");
    }

    // Buttons. Only one person can use plogenius at a time, so there are
    // NO start buttons while someone else is using it, or while someone
    // else has it booked right now.
    const buttons = [];
    const someoneElseUsing = others.length > 0;
    const someoneElseBookedNow = bookedNow && bookedNow.user !== userName;
    if (someoneElseUsing) {
      lines.push("Only one person can use plogenius at a time. Check the planner for a free slot.");
    } else if (someoneElseBookedNow) {
      lines.push("It's " + bookedNow.user + "'s booked time. Check the planner for a free slot.");
    } else if (bookedNow) {
      // It's your own booking right now: just start.
      buttons.push({
        label: "Start (your booking until " + timeText(bookedNow.endMs) + ")",
        color: "#1a7f37",
        onClick: () => logIn(userName),
      });
    } else {
      // Offer 1 or 2 hours, starting at the current quarter hour.
      const startMs = Math.floor(now / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
      for (const hours of [1, 2]) {
        const endMs = startMs + hours * HOUR_MS;
        // Does it overlap someone else's booking? (Your own is fine: you'd
        // just be double-booking yourself, so we block that too.)
        const clash = status.upcomingBookings.find((b) => b.startMs < endMs && startMs < b.endMs);
        buttons.push({
          label: "Book " + hours + " hour" + (hours > 1 ? "s" : "") + " & start (" +
                 timeText(startMs).slice(0, 5) + "–" + timeText(endMs) + ")",
          color: hours === 1 ? "#2a9d8f" : "#1f7a70",
          disabled: Boolean(clash),
          note: clash ? "Not possible: " + (clash.user === userName ? "you have" : clash.user + " has") +
                        " a booking " + timeText(clash.startMs) + "–" + timeText(clash.endMs) : null,
          onClick: () => bookAndStart(userName, startMs, endMs),
        });
      }
      buttons.push({ label: "Start without booking", color: "#1a7f37", onClick: () => logIn(userName) });
    }
    buttons.push(openPlannerButton());

    showPanel({
      title: heading || "Booking Planner",
      lines: lines,
      buttons: buttons,
      smallLink: { label: "Not now (you won't show as \"in use\")" },
    });
  }

  function openPlannerButton() {
    return {
      label: "Open full planner",
      color: "#3b6fd8",
      keepOpen: true, // leave the card open; the planner opens in a new tab
      onClick: () => window.open(PLANNER_URL, "_blank"),
    };
  }

  async function bookAndStart(userName, startMs, endMs) {
    try {
      await createBooking(userName, startMs, endMs);
      logIn(userName);
    } catch (error) {
      showPanel({
        title: "Booking didn't work",
        lines: ["The planner refused the booking (" + error.message + ").",
                "Check the planner, then try again."],
        buttons: [openPlannerButton()],
        smallLink: { label: "Close", onClick: () => showStatusCard(userName) },
      });
    }
  }

  // ---------- Who am I? ----------

  // Ask which user this browser belongs to. The answer is remembered
  // (GM_setValue stores it inside Tampermonkey, on this computer only).
  function showNamePicker(onChosen) {
    showPanel({
      title: "Booking Planner",
      lines: ["Who is using plogenius on this computer?", "(You only choose this once.)"],
      buttons: USERS.map((user) => ({
        label: user.name,
        color: user.color, // same colours as the planner
        onClick: () => { GM_setValue("userName", user.name); onChosen(user.name); },
      })),
      smallLink: { label: "Not now" },
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
    showStatusCard(userName, becauseIdle ? "Logged out (no answer)" : "Logged out");
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
      return ["If you don't answer, you'll be logged out in " + minutes + ":" + seconds + ",",
              "so an idle window doesn't show as \"in use\"."];
    };

    const panel = showPanel({
      title: "Still using plogenius?",
      lines: countdownText(),
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
  GM_registerMenuCommand("Show Booking Planner status", () => {
    const name = GM_getValue("userName", null);
    if (name) showStatusCard(name);
  });
  GM_registerMenuCommand("Log out of the Booking Planner", () => {
    const name = GM_getValue("userName", null);
    if (name && loggedIn) logOut(name, false);
  });
  GM_registerMenuCommand("Change my Booking Planner name", () => {
    showNamePicker(() => location.reload());
  });

  // When plogenius opens: show the status card (asking for your name first
  // if this computer hasn't chosen one yet).
  const savedName = GM_getValue("userName", null);
  if (USERS.some((u) => u.name === savedName)) {
    showStatusCard(savedName);
  } else {
    showNamePicker((name) => showStatusCard(name));
  }
})();
