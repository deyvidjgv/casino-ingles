# 🌌 Random Classroom (Casino Inglés)

> **Cosmic Gamified Classroom Casino for English Learning**  
> An interactive web application built with React 19, TypeScript, Vite, GSAP, and Firebase. The teacher projects cosmic mini-games to randomly select students, pairs, teams, topics, and English challenges with authentic casino-style animations and zero real-money gambling.

---

## 🚀 Key Features & Highlights

- **Crypto-First Randomness:** All random outcomes are strictly generated via `crypto.getRandomValues` (`src/lib/random.ts`), completely avoiding `Math.random`. Outcomes are deterministic before animation begins and accurately settled into class logs.
- **Teacher Points Authority:** Points are exclusively awarded by the teacher through judged validations (`useJudgedAward`), preventing unauthorized student mutations.
- **Real-Time Multiplayer (Stellar Derby):** Low-latency live race synchronization powered by Firebase Realtime Database. The teacher acts as the physics authority on the projector while students mash taps on their phones or PCs, raise hands, and answer English prompts for turbo boosts.
- **Dual-Mode Games:**
  - **Lunar Roulette:** Features a dynamic **Selector Wheel** (every student gets an adapting slice and can be eliminated) alongside a full **European Casino Roulette** (37 pockets: 0–36) with an interactive virtual betting board (Colors, Parity, Ranges, Dozens, Straight Up).
  - **Card Comet:** Offers **Card Draw** for quick holographic draws and **Cosmic Blackjack** with a 52-card shoe without replacement, Soft Rule English questions, and Natural Blackjack management.
- **Strict Internationalization:** 100% of interface copy is externalized in `src/locales/en.json` and `src/locales/es.json` with dynamic runtime switching (English by default).
- **Responsive & Accessible:** Full projector mode (high contrast, bold typography), mobile touch optimizations, vibration feedback, screen wake lock, and strict support for `prefers-reduced-motion`.

---

## 🪐 The 6 Cosmic Worlds

| World | Island Key | Engine & Mode Highlights |
|---|---|---|
| **Jackpot Nebula** | `slot` | Cosmic slot machine (3–5 reels). Presets: 2 students + 1 topic, group draw, custom reels. Duplicate-free student picks per spin. |
| **Stellar Derby** | `derby` | **Live Multiplayer Race (Priority 1):** Teacher authority physics loop + student phone/PC mashing (`DerbyPlayerView.tsx`). Synchronized 3-2-1 countdown, checkpoints (25%, 50%, 75%) or manual Q freeze, hand-raising, English turbo validation, photo-finish unclipped tie-breaker. Single-device fallback with keys 1–6 (ignoring repeat). |
| **Mystery Black Hole** | `mystery` | Floating singularity boxes. Persistent state tracked by unique `boxId` rather than index. Guaranteed auto-closing of all lids before shuffle. Eliminate mode support. |
| **Card Comet** | `blackjack` | 52-card crypto shoe without replacement. **Mode A:** Holographic card draw. **Mode B:** Cosmic Blackjack with Soft Rule (incorrect English answer passes turn safely), initial 21 Natural Blackjack handling, and complete round elimination. |
| **Lunar Roulette** | `roulette` | **Mode A (Selector Wheel):** Adapting slices for active student pool, top pointer needle, tick sounds per slice, elimination per spin. **Mode B (Real Casino):** European sequence (0–36), ball counter-rotation with deflector bounces, virtual betting board (Red/Black, Even/Odd, Dozens, Numbers). |
| **Dice Asteroid** | `dice` | 3D crystal dice on asteroid terrain. Seamless forward 3D rotations without snapping `% 360` jerks, guaranteed distinct student landings on multi-dice presets (`pickDistinct`), and leak-proof audio intervals. |

---

## 🛠️ Tech Stack & Architecture

- **Frontend:** React 19, TypeScript, Vite.
- **Physics & Animation:** GSAP (Timelines, Easing curves, 3D CSS transforms).
- **Audio & SFX:** Web Audio API sound synthesis and effects (`src/lib/sfx.ts`).
- **State Management:** Zustand (`useClassStore`, `useAuthStore`).
- **Database & Backend:**
  - **Firebase Authentication:** Anonymous auth for students + Email/Password/Google for teachers.
  - **Cloud Firestore:** Courses, rosters, questions, topics, points, and round history logs.
  - **Firebase Realtime Database:** High-frequency live race telemetry (`/races/{courseId}`), throttled position broadcasts (~8 Hz), student taps, raised hands, and presence tracking (`/presence/{courseId}`).

---

## 📦 Project Setup

### 1. Prerequisites
- **Node.js** `>= 18.x`
- **npm** `>= 9.x`

### 2. Installation
```bash
git clone https://github.com/deyvidjgv/casino-ingles.git
cd casino-ingles
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=random-classroom.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=random-classroom
VITE_FIREBASE_STORAGE_BUCKET=random-classroom.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

### 4. Development & Build Commands
```bash
# Run local development server
npm run dev

# Compile TypeScript and build for production
npm run build

# Run linter (oxlint)
npm run lint
```

---

## 🔒 Firebase Console & Security Setup

### 1. Enable Realtime Database in Firebase Console
1. Navigate to the [Firebase Console](https://console.firebase.google.com/) and open the `random-classroom` project.
2. In the left navigation menu, go to **Build** > **Realtime Database**.
3. Click **Create Database**.
4. Choose your database location (e.g., `us-central1` or default).
5. Start in **Locked mode** (rules will be deployed in the next step).

### 2. Deploy Database & Firestore Security Rules
Make sure you have the Firebase CLI installed and logged in:
```bash
npm install -g firebase-tools
firebase login
firebase use random-classroom
```

Deploy the configured security rules:
```bash
# Deploy Realtime Database rules (database.rules.json)
firebase deploy --only database

# Deploy Firestore security rules (firestore.rules)
firebase deploy --only firestore
```

---

## 🎮 How to Test Stellar Derby Multiplayer (1 Teacher + 3 Students)

1. **Teacher Setup (Projector / Desktop):**
   - Log in as Teacher and select/create a course (e.g. Code `ENG-TEST`).
   - Add English questions to the course library.
   - Enter **The Galaxy** and warp to **Stellar Derby**.
   - In Settings, set Control Mode to *"Student Phones / Devices"* and choose checkpoints (e.g. 25%, 50%, 75%).
2. **Student Join (Mobile Phones / Incognito Windows):**
   - Open 3 separate mobile browsers or incognito tabs at the application URL.
   - Enter student names (e.g., *Alex*, *Ben*, *Chloe*) and the course code `ENG-TEST`.
   - The green presence dot lights up next to their names on the teacher's screen.
3. **Lobby & Ready Up:**
   - Teacher selects the 3 students into lanes 1, 2, and 3.
   - On their phones, each chosen student sees their assigned horse color, practice tapping area, and taps **"I'm Ready!"**.
   - Teacher clicks **"Start Race"** (or *"Start Anyway"*).
4. **Live Race & English Checkpoint:**
   - Synchronized `3 - 2 - 1 - GO!` countdown appears on all devices.
   - Students tap their screen (or press Space/Enter on PC) to accelerate their horse.
   - At checkpoint (or when teacher presses **Q**), race freezes across all screens.
   - Students see a huge **"Raise Hand"** button. The teacher views the order of hands, nominates a student to answer, and clicks ✔ or ✘.
   - Correct answer grants turbo boost and class points. Race resumes with a *"Ready... GO!"* countdown.
5. **Photo Finish & Podium:**
   - Horses cross the finish line; tie-breakers use unclipped progress.
   - Teacher awards points to the winner, and student screens display their final rank and celebratory podium.
