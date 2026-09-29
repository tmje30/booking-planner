// firebase-config.js — tells the page WHICH Firebase database to use.
//
// While this is null, the planner runs in TEST MODE: bookings are only
// saved in this browser, on this computer (nobody else sees them).
//
// To go live: replace `null` below with the config block Firebase gives
// you (Project settings → Your apps → Web app → "SDK setup and
// configuration" → Config). It looks like this:
//
//   const FIREBASE_CONFIG = {
//     apiKey: "AIza...",
//     authDomain: "your-project.firebaseapp.com",
//     projectId: "your-project",
//     storageBucket: "your-project.firebasestorage.app",
//     messagingSenderId: "123456789",
//     appId: "1:123456789:web:abc123",
//   };
//
// Is it OK that this is public? Yes. Despite the name, Firebase's web
// "apiKey" is not a password. It only says which project to talk to, and
// Google designs it to sit in public web pages. What protects the data is
// the security rules in firestore.rules (pasted into the Firebase console).

// (Firebase also gave a "measurementId"; that's only for Google Analytics,
// which we don't use, so it's left out.)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB_CTFK4MZ1JeSTWOiSp7xAwPHKLiAwFEw",
  authDomain: "solver-booking.firebaseapp.com",
  projectId: "solver-booking",
  storageBucket: "solver-booking.firebasestorage.app",
  messagingSenderId: "39946003177",
  appId: "1:39946003177:web:9643283fd7db9658438678",
};
