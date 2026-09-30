// ==UserScript==
// @name         Booking Planner – plogenius "in use" signal
// @namespace    https://tmje30.github.io/booking-planner/
// @version      1.9.0
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
//    whose booking is next. If it's free, you book 1 or 2 hours (or until
//    the next booking) from the card, and that starts your session. You
//    only count as "in use" after booking (or starting your own booking).
//
//    When your booking time runs out, a card shows who is next. If
//    someone is booked straight after you, you're logged out. If not,
//    you can extend by 1 or 2 hours (or until the next booking).
//
// 2. While you're "in use", it sends a tiny "I'm still here" signal to our
//    Firebase database once a minute, under your name. The Booking Planner
//    watches those signals and shows "In use: <your name>". When you close
//    plogenius (or your computer sleeps), the signals stop, and after
//    3 minutes the planner shows "Free".
//
// 3. So that a forgotten, idle window doesn't look "in use" forever:
//    it notices activity on plogenius (mouse, clicks, keys, scrolling — it
//    only notices THAT you did something, not what). After 40 minutes with
//    no activity it asks "Still using plogenius?". If nobody answers within
//    10 minutes, your session ends and your current booking is DELETED, so
//    the slot is free for others.
//
// 4. It adds a button to plogenius's top menu, right after "VIP":
//    "Log out session" (marks plogenius as free in the planner — it does
//    NOT log you out of plogenius itself), or "Start session" when you're
//    not in one (opens the booking card).
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
  const IDLE_AFTER_MS = 40 * 60 * 1000;       // no activity for 40 min = ask "still using?"
  const ANSWER_WITHIN_MS = 10 * 60 * 1000;    // no answer within 10 min = log out + delete booking
  const IDLE_CHECK_EVERY_MS = 30 * 1000;      // how often we check for idleness
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

    return { close, setText, isOpen: () => host.isConnected };
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

  // Everything the status card needs: who is in use, and all bookings
  // that haven't ended yet (earliest first).
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
    const upcomingBookings = (bookings.documents || [])
      .map((doc) => ({
        id: doc.name.split("/").pop(), // the document's name is the booking id
        user: doc.fields.user.stringValue,
        startMs: readNumber(doc.fields.startMs),
        endMs: readNumber(doc.fields.endMs),
      }))
      .filter((b) => b.endMs > now)
      .sort((a, b) => a.startMs - b.startMs);
    return { activeUsers, upcomingBookings };
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

  // Save a new booking in the planner (same shape the planner uses).
  // Returns the booking, including its id.
  async function createBooking(userName, startMs, endMs) {
    const id = "b-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    await firestoreRequest("POST", API_BASE + DOCS_PATH + "/bookings?documentId=" + id, {
      fields: {
        user: { stringValue: userName },
        startMs: { integerValue: String(startMs) },
        endMs: { integerValue: String(endMs) },
      },
    });
    return { id, user: userName, startMs, endMs };
  }

  // Make an existing booking end later (used for "Extend").
  // updateMask = "only change endMs, leave the rest as it is".
  function changeBookingEnd(bookingId, newEndMs) {
    return firestoreRequest("PATCH",
      API_BASE + DOCS_PATH + "/bookings/" + bookingId + "?updateMask.fieldPaths=endMs",
      { fields: { endMs: { integerValue: String(newEndMs) } } });
  }

  // ---------- Booking choices (used on both cards) ----------

  // Buttons for booking time starting at `fromMs`: 1 hour, 2 hours, and
  // "until the next booking" if that's shorter than 2 hours. Choices that
  // would run into the next booking are left out. `ignoreId` = your own
  // current booking (when extending, it doesn't count as "in the way").
  // `verb` is "Book" or "Extend". Returns { buttons, nextBooking }.
  function bookingChoices(fromMs, upcomingBookings, ignoreId, verb, onPick) {
    const nextBooking = upcomingBookings.find((b) => b.id !== ignoreId && b.endMs > fromMs);
    const limitMs = nextBooking ? nextBooking.startMs : Infinity; // can't go past this
    const buttons = [];
    for (const hours of [1, 2]) {
      const endMs = fromMs + hours * HOUR_MS;
      if (endMs <= limitMs) {
        buttons.push({
          label: verb + " " + hours + " hour" + (hours > 1 ? "s" : "") + " (until " + timeText(endMs) + ")",
          color: hours === 1 ? "#2a9d8f" : "#1f7a70",
          onClick: () => onPick(endMs),
        });
      }
    }
    // "Until the next booking", if that's at least 15 minutes and less
    // than 2 hours away (and not exactly 1 hour, which is already offered).
    const gapMs = limitMs - fromMs;
    if (nextBooking && gapMs >= QUARTER_HOUR_MS && gapMs < 2 * HOUR_MS && gapMs !== HOUR_MS) {
      buttons.push({
        label: verb + " until " + timeText(limitMs) + " (" + nextBooking.user + " is next)",
        color: "#3a8f5a",
        onClick: () => onPick(limitMs),
      });
    }
    return { buttons, nextBooking };
  }

  // ---------- The status card (when plogenius opens) ----------

  // The status card that's showing right now (so it can be refreshed):
  // { panel, userName, heading }, or null.
  let statusCard = null;

  // Shown when plogenius opens, and after you've been logged out.
  // `isOpening` = plogenius was just opened (not after a log-out). Then,
  // if it's your own booked time and nobody else is on plogenius, we start
  // straight away with no pop-up (handy when you open extra windows).
  // `isRefresh` = redraw an open card with up-to-date times and bookings.
  async function showStatusCard(userName, heading, isOpening = false, isRefresh = false) {
    let status;
    try {
      status = await loadPlannerStatus();
    } catch (error) {
      if (isRefresh) return; // keep the card that's there; try again next time
      replaceStatusCard(userName, heading, showPanel({
        title: heading || "Booking Planner",
        lines: ["Couldn't load the planner (" + error.message + ").",
                "Check your internet connection, then try again."],
        buttons: [
          { label: "Try again", color: "#1a7f37", onClick: () => showStatusCard(userName, heading, isOpening) },
          openPlannerButton(),
        ],
        smallLink: { label: "Not now" },
      }));
      return;
    }

    // A refresh, but meanwhile you clicked something on the card (or
    // started a session)? Then don't bring the card back.
    if (isRefresh && (loggedIn || !statusCard || !statusCard.panel.isOpen())) return;

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
    const myBookingNow = bookedNow && bookedNow.user === userName;

    // Your own booked time, nobody else on plogenius, just opened: start
    // quietly, no card.
    if (isOpening && myBookingNow && others.length === 0) {
      logIn(userName, bookedNow);
      return;
    }
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

    // Buttons. Only one person can use plogenius at a time, and you can
    // only start by booking (or with your own booking that's on now).
    let buttons = [];
    if (myBookingNow) {
      // It's your own booking right now: you can start (even if someone
      // else is still on plogenius past their time).
      if (others.length > 0) {
        lines.push("It's your booked time, but " + others.map((p) => p.user).join(" and ") +
                   " is still on plogenius.");
      }
      buttons.push({
        label: "Start (your booking until " + timeText(bookedNow.endMs) + ")",
        color: "#1a7f37",
        onClick: () => logIn(userName, bookedNow),
      });
    } else if (others.length > 0) {
      lines.push("Only one person can use plogenius at a time. Check the planner for a free slot.");
    } else if (bookedNow) {
      lines.push("It's " + bookedNow.user + "'s booked time. Check the planner for a free slot.");
    } else {
      // Free: book from the current quarter hour (the planner's 15-minute steps).
      const startMs = Math.floor(now / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
      const choices = bookingChoices(startMs, status.upcomingBookings, null, "Book",
        (endMs) => bookAndStart(userName, startMs, endMs));
      buttons = choices.buttons;
      if (buttons.length === 0) {
        lines.push("The next booking starts in less than 15 minutes, so there's no time to book.");
      }
    }
    buttons.push(openPlannerButton());

    replaceStatusCard(userName, heading, showPanel({
      title: heading || "Booking Planner",
      lines: lines,
      buttons: buttons,
      smallLink: { label: "Not now (you won't show as \"in use\")" },
    }));
  }

  // Remember the new card, and remove the previous one if it's still open
  // (so a refresh swaps the card instead of stacking a second one on top).
  function replaceStatusCard(userName, heading, panel) {
    if (statusCard && statusCard.panel !== panel && statusCard.panel.isOpen()) statusCard.panel.close();
    statusCard = { panel, userName, heading };
  }

  // Redraw the card with current times, if it's open. Runs once a minute,
  // and straight away when you switch back to this plogenius window.
  function refreshStatusCard() {
    if (statusCard && statusCard.panel.isOpen() && !loggedIn) {
      showStatusCard(statusCard.userName, statusCard.heading, false, true);
    }
  }
  setInterval(refreshStatusCard, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatusCard(); });
  window.addEventListener("focus", refreshStatusCard);

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
      const booking = await createBooking(userName, startMs, endMs);
      logIn(userName, booking);
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

  // ---------- When your booking runs out ----------

  async function onBookingEnded(userName) {
    let status;
    try {
      status = await loadPlannerStatus();
    } catch (error) {
      // Can't check who's next: log out to be safe (one user at a time).
      logOut(userName, "Your booking has ended");
      return;
    }

    // Maybe the booking was extended in the planner meanwhile: if it now
    // ends later, just wait for the new end time.
    const mine = status.upcomingBookings.find((b) => currentBooking && b.id === currentBooking.id);
    if (mine && mine.endMs > Date.now() + 30 * 1000) {
      currentBooking = mine;
      scheduleBookingEnd(userName);
      return;
    }

    const endedAt = currentBooking ? currentBooking.endMs : Date.now();
    const choices = bookingChoices(endedAt, status.upcomingBookings,
      currentBooking && currentBooking.id, "Extend",
      (newEndMs) => extendBooking(userName, newEndMs));

    // Someone is booked straight after you (no time left to extend):
    // log out, and the card shows who's next.
    if (choices.buttons.length === 0 && choices.nextBooking) {
      logOut(userName, "Your booking has ended");
      return;
    }

    let secondsLeft = ANSWER_WITHIN_MS / 1000;
    const next = choices.nextBooking;
    const infoLines = () => [
      next ? "Next booking: " + next.user + ", " + dayText(next.startMs) + " at " + timeText(next.startMs)
           : "Nobody is booked after you.",
      "Extend your booking, or log out. You'll be logged out automatically in " +
        Math.floor(secondsLeft / 60) + ":" + String(secondsLeft % 60).padStart(2, "0") + ".",
    ];

    const panel = showPanel({
      title: "Your booking has ended",
      lines: infoLines(),
      buttons: choices.buttons
        .map((b) => ({ ...b, onClick: () => { clearInterval(countdown); b.onClick(); } }))
        .concat([{ label: "Log out", color: "#6b7280",
                   onClick: () => { clearInterval(countdown); logOut(userName); } }]),
    });

    // Tick the countdown once a second; log out when it reaches 0.
    const countdown = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(countdown);
        panel.close();
        logOut(userName, "Logged out (no answer)");
      } else {
        panel.setText(infoLines());
      }
    }, 1000);
  }

  async function extendBooking(userName, newEndMs) {
    try {
      await changeBookingEnd(currentBooking.id, newEndMs);
      currentBooking.endMs = newEndMs;
      scheduleBookingEnd(userName);
    } catch (error) {
      logOut(userName, "Couldn't extend (" + error.message + ")");
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

  let signalTimer = null;     // the once-a-minute signal
  let idleTimer = null;       // checks every 30 s whether you've gone idle
  let endTimer = null;        // fires when your booking runs out
  let currentBooking = null;  // the booking you're using now { id, startMs, endMs }
  let loggedIn = false;

  // Start a session for `booking`: signal once now, then once a minute.
  // `isFresh` = a new session (sets "open since" to now).
  function logIn(userName, booking, isFresh = true) {
    stopTimers();
    loggedIn = true;
    updateMenuButton();
    if (booking) currentBooking = booking;
    sendSignal(userName, isFresh);
    signalTimer = setInterval(() => sendSignal(userName, false), SIGNAL_EVERY_MS);
    noteActivity(true); // starting a session counts as activity
    idleTimer = setInterval(() => checkIdle(userName), IDLE_CHECK_EVERY_MS);
    scheduleBookingEnd(userName);
  }

  // Set the timer for the end of the current booking.
  function scheduleBookingEnd(userName) {
    clearTimeout(endTimer);
    if (!currentBooking) return;
    endTimer = setTimeout(() => onBookingEnded(userName), Math.max(0, currentBooking.endMs - Date.now()));
  }

  // `silent` = don't show the card afterwards (used by the menu button).
  function logOut(userName, heading, silent = false) {
    stopTimers();
    loggedIn = false;
    currentBooking = null;
    removeSignal(userName);
    updateMenuButton();
    if (!silent) showStatusCard(userName, heading || "Logged out");
  }

  function stopTimers() {
    clearInterval(signalTimer);
    clearInterval(idleTimer);
    clearTimeout(endTimer);
  }

  // ---------- Idle check ----------
  //
  // We remember when you last did something on plogenius. That time is
  // shared between all your plogenius windows (GM_setValue storage lives in
  // Tampermonkey), so being active in ANY plogenius window counts.

  let lastActivityHere = Date.now(); // last activity in this window
  let lastSharedSave = 0;            // when we last saved it to shared storage
  let idlePanelOpen = false;         // the "still using?" pop-up is showing

  // Called on every mouse move, click, key press or scroll. It's cheap:
  // it only saves to shared storage at most every 30 seconds.
  function noteActivity(force = false) {
    if (idlePanelOpen && !force) return; // only a button click answers the pop-up
    lastActivityHere = Date.now();
    if (force || lastActivityHere - lastSharedSave > 30 * 1000) {
      lastSharedSave = lastActivityHere;
      GM_setValue("lastActivity", lastActivityHere);
    }
  }
  for (const type of ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"]) {
    // `capture: true` = we hear it before the page does; `passive` = we
    // never block it. We don't look at WHAT you did, only that you did.
    window.addEventListener(type, () => noteActivity(), { capture: true, passive: true });
  }

  // The latest activity in any plogenius window.
  function lastActivityAnywhere() {
    return Math.max(lastActivityHere, GM_getValue("lastActivity", 0));
  }

  // Runs every 30 seconds during a session.
  function checkIdle(userName) {
    if (idlePanelOpen) return;
    if (Date.now() - lastActivityAnywhere() >= IDLE_AFTER_MS) askStillActive(userName);
  }

  // "Still using plogenius?" with a 10-minute countdown. No answer =
  // log out and delete your current booking.
  function askStillActive(userName) {
    idlePanelOpen = true;
    const shownAt = Date.now();
    let secondsLeft = ANSWER_WITHIN_MS / 1000;
    const countdownText = () => [
      "No activity on plogenius for 40 minutes.",
      "If you don't answer within " + Math.floor(secondsLeft / 60) + ":" +
        String(secondsLeft % 60).padStart(2, "0") +
        ", your session ends and your booking is deleted, so the slot is free for others.",
    ];

    const finish = () => { clearInterval(countdown); idlePanelOpen = false; };

    const panel = showPanel({
      title: "Still using plogenius?",
      lines: countdownText(),
      buttons: [
        { label: "I'm still here", color: "#1a7f37",
          onClick: () => { finish(); noteActivity(true); } },
        { label: "Log out session", color: "#6b7280",
          onClick: () => { finish(); logOut(userName); } },
      ],
    });

    const countdown = setInterval(() => {
      // Answered in another plogenius window (or active there)? Then close.
      if (GM_getValue("lastActivity", 0) > shownAt) {
        finish();
        panel.close();
        return;
      }
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        finish();
        panel.close();
        const booking = currentBooking;
        // Wait for the deletion to finish before showing the card, so the
        // card doesn't still show the booking.
        (booking ? deleteBooking(booking.id) : Promise.resolve()).then(() =>
          logOut(userName, "Logged out: no activity" + (booking ? " (your booking was removed)" : "")));
      } else {
        panel.setText(countdownText());
      }
    }, 1000);
  }

  // Delete a booking from the planner.
  // Returns a Promise that finishes when the deletion is done (or failed).
  function deleteBooking(bookingId) {
    return firestoreRequest("DELETE", API_BASE + DOCS_PATH + "/bookings/" + bookingId).catch(() => {});
  }

  // ---------- The button in plogenius's top menu ----------
  //
  // plogenius builds its page with JavaScript and may redraw its menu at
  // any time, which would wipe out our button. So we keep an eye on the
  // page (a "MutationObserver" = "tell me whenever the page changes") and
  // put the button back after "VIP" whenever it has gone missing.

  let menuButtonHost = null; // the element holding our button
  let menuButton = null;     // the button itself

  function makeMenuButton() {
    menuButtonHost = document.createElement("span");
    menuButtonHost.style.cssText = "display:inline-flex;align-items:center;margin-left:14px;";
    // Shadow root again: plogenius's styles can't change our button.
    const root = menuButtonHost.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        button { font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
                 padding: 5px 12px; border-radius: 8px; border: 1px solid currentColor;
                 background: transparent; white-space: nowrap; }
        button.out { color: #f87171; }   /* red-ish: "Log out session" */
        button.in  { color: #4ade80; }   /* green: "Start session" */
        button:hover { background: rgba(255, 255, 255, 0.08); }
      </style>
      <button type="button"></button>`;
    menuButton = root.querySelector("button");
    menuButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation(); // don't let plogenius react to this click
      const name = GM_getValue("userName", null);
      if (!name) { showNamePicker((n) => showStatusCard(n)); return; }
      if (loggedIn) {
        logOut(name, null, true); // quietly mark the session as free
      } else {
        showStatusCard(name);     // show the card to book / start
      }
    });
    updateMenuButton();
  }

  // Set the button's text to match whether you're in a session.
  function updateMenuButton() {
    if (!menuButton) return;
    menuButton.textContent = loggedIn ? "⏻ Log out session" : "▶ Start session";
    menuButton.className = loggedIn ? "out" : "in";
    menuButton.title = loggedIn
      ? "Tell the Booking Planner you're done (you stay logged in to plogenius)"
      : "Book time and start a Booking Planner session";
  }

  // Find plogenius's "VIP" menu item near the top of the page. Returns the
  // outermost element that contains just "VIP" (so we go after its icon too).
  function findVipMenuItem() {
    // XPath: "any element whose own text is exactly VIP".
    const found = document.evaluate("//body//*[normalize-space(text())='VIP']",
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < found.snapshotLength; i++) {
      let el = found.snapshotItem(i);
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.top > 150) continue; // hidden, or not in the top menu
      while (el.parentElement && el.parentElement.textContent.trim() === "VIP") {
        el = el.parentElement;
      }
      return el;
    }
    return null;
  }

  // Put the button after "VIP" if it isn't on the page right now.
  function placeMenuButton() {
    if (menuButtonHost && menuButtonHost.isConnected) return; // already there
    const vip = findVipMenuItem();
    if (!vip) return; // menu not drawn yet; we'll try again on the next change
    if (!menuButtonHost) makeMenuButton();
    vip.insertAdjacentElement("afterend", menuButtonHost);
  }

  function startMenuButton() {
    placeMenuButton();
    let waiting = false;
    new MutationObserver(() => {
      if (waiting) return; // at most one check every 0.2 seconds
      waiting = true;
      setTimeout(() => { waiting = false; placeMenuButton(); }, 200);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------- Start ----------

  startMenuButton();

  // Items in the Tampermonkey icon's menu.
  GM_registerMenuCommand("Show Booking Planner status", () => {
    const name = GM_getValue("userName", null);
    if (name) showStatusCard(name);
  });
  GM_registerMenuCommand("Log out of the Booking Planner", () => {
    const name = GM_getValue("userName", null);
    if (name && loggedIn) logOut(name);
  });
  GM_registerMenuCommand("Change my Booking Planner name", () => {
    showNamePicker(() => location.reload());
  });

  // When plogenius opens: show the status card (asking for your name first
  // if this computer hasn't chosen one yet).
  const savedName = GM_getValue("userName", null);
  if (USERS.some((u) => u.name === savedName)) {
    showStatusCard(savedName, null, true);
  } else {
    showNamePicker((name) => showStatusCard(name, null, true));
  }
})();
