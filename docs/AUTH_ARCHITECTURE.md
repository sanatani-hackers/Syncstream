# SyncStream Authentication — Architecture Document

**Status:** Phase 1 (auth blueprint) and Phase 2 (preferences API) are implemented, tested against the fake client, and verified end-to-end against the real Supabase instance. Phases 3–5 below are planned, not built.

**Revision 2 — architectural reversal, read this first if you read the original version:** the original §7 stated "no WebSocket changes, by design" as a deliberate boundary. That boundary has been explicitly overridden by product decision: **anonymous users may browse the app freely but may not create or join rooms, and this is now enforced at the WebSocket connection layer, not just hidden in the UI.** This is a real, intentional exception to the "room/account identity stay decoupled" principle — narrowly scoped to *connection admission* only, not to in-room identity (see §7 for the precise boundary). Sections 4, 6, 7, 10, and 15 are rewritten below to reflect this. A new §4a covers the application-shell restructuring this also requires.

---

## 1. Complete Authentication Flow

```
┌─────────────┐     POST /api/auth/send-otp      ┌──────────────────────┐
│   Browser   │ ───────────────────────────────► │  Rate limit check     │
│             │                                    │  (email + IP)         │
└─────────────┘                                    └──────────┬───────────┘
                                                                │ allowed
                                                                ▼
                                          Invalidate prior unused OTP for
                                          this email → generate new 6-digit
                                          code → sha256 hash → store with
                                          5-min expiry → email raw code
                                                                │
                                          Response: always the SAME generic
                                          message, regardless of what
                                          happened above (enumeration-safe)
                                                                │
┌─────────────┐    POST /api/auth/verify-otp      ▼
│   Browser   │ ───────────────────────────────► Look up latest unused OTP
│ (user types │                                   for email → check expiry,
│  the code)  │                                   attempts < 5, constant-
└─────────────┘                                   time hash compare
                                                                │
                                    ┌───────────────────────────┴───────────────────────────┐
                                    │ fail: wrong code / expired / max attempts               │  success
                                    ▼                                                          ▼
                          attempts++ (or invalidate               find-or-create user by email
                          if 5th failure) → 400,                  (login/signup = same flow)
                          client-safe message                     → create session (30-day
                                                                      fixed expiry, sha256-hashed
                                                                      token) → audit log
                                                                              │
                                                                              ▼
                                                              Response: Set-Cookie (HttpOnly,
                                                              Secure, SameSite=Lax) + token in
                                                              body (localStorage fallback) +
                                                              {id, email}

┌─────────────┐   GET /api/auth/validate (cookie   ┌──────────────────────┐
│   Browser   │   or Authorization: Bearer)        │ hash token → look up  │
│ (every page │ ──────────────────────────────────►│ session → check       │
│  load)      │                                     │ expires_at → bump     │
└─────────────┘                                     │ last_seen             │
                                                      └──────────┬───────────┘
                                                       valid │       │ invalid/missing
                                                             ▼       ▼
                                                       200 + user   401

┌─────────────┐    POST /api/auth/logout           ┌──────────────────────┐
│   Browser   │ ───────────────────────────────────►│ DELETE session row   │
└─────────────┘                                     │ clear cookie          │
                                                      │ audit log "logout"    │
                                                      └───────────────────────┘
```

**Re-authentication:** there is no refresh-token flow. When a session's fixed 30-day window ends, `validate_session` simply starts returning `None` — the user goes through the OTP flow again from scratch. This is deliberate (see §14).

---

## 2. Database Tables and Relationships

```
users
 ├── id (PK)
 ├── email (unique)
 └── created_at
      │
      │ 1 : many                          │ 1 : 1 (PK = user_id)
      ▼                                    ▼
   sessions                            preferences
    ├── id (PK)                         ├── user_id (PK, FK → users.id)
    ├── user_id (FK → users.id)         ├── volume
    ├── token_hash                      ├── eq_settings (json)
    ├── expires_at                      ├── theme
    ├── created_at                      ├── last_room_id
    ├── last_seen                       └── updated_at
    └── device_name (nullable)

      │ 1 : many (nullable FK)
      ▼
   audit_log
    ├── id (PK)
    ├── user_id (FK → users.id, NULLABLE)
    ├── event_type
    ├── ip_address
    ├── user_agent
    └── created_at

otp_codes                    ← deliberately NOT linked to users by FK
 ├── id (PK)
 ├── email                   ← correlated to users.email by VALUE only
 ├── code_hash
 ├── expires_at
 ├── attempts
 ├── used
 └── created_at
```

**Why `otp_codes` has no foreign key to `users`:** an OTP is requested *before* we know whether the person is a new or returning user — that's the whole point of "login and signup are the same flow." Forcing a FK here would mean creating a user row speculatively before verification, which is both unnecessary and a minor enumeration risk (a row would exist for an email that never actually completed verification).

**Why `audit_log.user_id` is nullable:** pre-authentication events (`otp_requested`, `otp_verify_failed`, `otp_request_rate_limited`) don't have a resolved user yet — sometimes because the email doesn't correspond to any account, sometimes because verification simply failed. Once a session exists, subsequent events (`session_created`, `logout`) do carry a real `user_id`.

**`preferences` design decision:** one row per user, created alongside the user row at first successful login (not lazily on first `PUT`). This means `GET /preferences` never has to special-case "row doesn't exist yet" — it always returns a real row, populated with sensible defaults. Simpler than conditional creation logic, at the cost of one extra insert at signup time (negligible).

---

## 3. Every New API Endpoint

| Endpoint | Phase | Auth required | Purpose |
|---|---|---|---|
| `POST /api/auth/send-otp` | 1 (done) | No | Request a login code. Always returns the same generic message. |
| `POST /api/auth/verify-otp` | 1 (done) | No | Submit the code. Creates user if new, creates session, sets cookie. |
| `GET /api/auth/validate` | 1 (done) | Yes | Returns the caller's own user record. Used on page load to check "am I still logged in." |
| `POST /api/auth/logout` | 1 (done) | No* | Deletes the session if a token is present. Always returns success (idempotent). |
| `GET /api/auth/preferences` | 2 | Yes | Returns the current user's preferences row. |
| `PUT /api/auth/preferences` | 2 | Yes | Partial update — client sends only the fields that changed. |

\* `logout` doesn't *require* auth in the decorator sense (a missing/invalid token is a no-op, not a 401) — it just does nothing if there's nothing to delete. This matches "always return success" behavior and avoids a pointless error for a client that's already logged out.

No endpoints for session listing/revocation, account deletion, or email change exist in this plan — see §14.

---

## 4. Every Frontend Change Required (Phase 4)

- **New `js/auth.js` module.** Holds auth state (`isAuthenticated`, `currentUser`), and exposes `checkExistingSession()` (calls `/validate` on page load), `sendOtp(email)`, `verifyOtp(email, code)`, `logout()`.
- **New OTP UI.** A two-step email → code flow, reachable from the header (not gating page load — see §4a). **Architectural decision, reaffirmed:** account identity (email) and room identity (the freeform display name typed at join time) stay decoupled. Signing in doesn't change how you appear inside a room, it's purely the gate on whether you can enter one at all, plus what unlocks preference persistence.
- **Header changes.** Needs, simultaneously: a signed-in-state indicator (avatar badge + "Logout"), and — new in this revision — a **Leave Room** action, kept structurally and visually separate from Logout (§4a). Suggested placement: Sign In/Logout lives with the identity pill (account-level); Leave Room lives near the role badge (room-level) — same account-vs-room separation visually that's being enforced functionally.
- **Preference hydration on load.** If a valid session exists, `GET /preferences` should run *before or alongside* `initAudioEngine()` — which, in this revision, is now called at **shell load**, not at room-join time (§4a).
- **Debounced preference writes.** EQ sliders fire on every drag tick — writing to the API on every tick would hammer the endpoint. Recommended: debounce EQ/volume writes (~1–2s after the last change) and flush explicitly on tab-switch-away-from-EQ and on `visibilitychange`/`beforeunload`.
- **`last_room_id` convenience.** Written to preferences on successful room join, if authenticated. Displayed as "Last Room: XXXXX" with an explicit "Join Again" button — **never** an automatic reconnect. Purely a frontend convenience; the room/WS backend never reads or writes this field.
- **Token handling for the localStorage fallback path.** Cookie is primary and needs zero manual handling. If a client can't use cookies, `verify-otp`'s `token` field must be stored and manually attached as `Authorization: Bearer <token>` on REST calls. For the WebSocket connection specifically, see §7 — this is no longer a hypothetical wrinkle, it's now a real requirement.
- **Feature flag.** A simple config constant (e.g. `AUTH_ENABLED`) gating whether the sign-in UI even appears — needed for Phase 5's anonymous-mode regression testing, and as a kill switch if something goes wrong post-launch. Note this flag now has sharper teeth than before: with the flag off, room creation/joining would need its own bypass, or nobody could use rooms at all during flag-off testing — worth deciding how the flag interacts with the new WS gate before Phase 5, not during it.

---

## 4a. Application Shell Restructuring

This is new in this revision, and is the biggest single frontend change in the whole plan — bigger than the OTP UI itself.

**The problem:** today, `#app-screen` (Discover, Search, Queue, EQ, the Player — the entire app shell) is only reachable through `joinApp()`, which *always* creates or joins a room in the same action. There is currently no code path that reaches the shell without also joining a room. "Anonymous users can browse everything except rooms" is not achievable without decoupling these.

**The restructuring:**
- The full-screen setup gate is removed as a mandatory first step. The app shell (header, tab navigation, Discover/Search/EQ) is reachable immediately on page load, for anyone, logged in or not.
- **Queue and the Player become room-dependent, not shell-dependent.** When there is no active room connection, they render a dedicated **empty state** ("Join or create a room to start listening" / similar) instead of their normal content — never a redirect back to a setup screen. The user stays exactly where they are in the shell.
- **"Create Room" / "Join Room" becomes an in-shell action** (e.g. a modal, or a dedicated panel), not the gateway into the shell. Triggering it while logged out prompts sign-in first (frontend nudge); triggering it while logged in but with the WS connection then rejected (shouldn't happen if the frontend check is correct, but see §7 for why the backend check exists regardless) surfaces the server's rejection reason.
- **`initAudioEngine()` moves from room-join-triggered to shell-load-triggered.** EQ needs a live Web Audio graph to be interactive at all, and EQ is now supposed to work "solo." Open detail for Phase 4 to resolve, not this document: browser autoplay policy requires a user gesture to start an `AudioContext` — either initialize eagerly behind a lightweight "tap to enable audio" affordance on shell load, or lazily on first interaction with the EQ tab specifically. Either way, the EQ sliders are interactive and audible-when-a-song-is-eventually-playing regardless of room state; without a room, there's simply no song loaded yet to filter.

**Leave Room — a genuinely new, dedicated action:**

```
┌─────────────┐   User taps "Leave Room"          ┌──────────────────────┐
│   Browser   │ ──────────────────────────────────►│ ws.close()            │
└─────────────┘                                     └──────────┬───────────┘
                                                                 │
                              Backend's EXISTING `finally` block in
                              websocket_endpoint() fires — this already
                              runs on ANY disconnect (page close, network
                              drop, or now, this explicit close) and
                              already does exactly the right thing:
                              remove client from room.clients, reassign
                              host if needed, broadcast_room_state to
                              remaining participants.

                              NO NEW BACKEND CODE for the leave mechanism
                              itself — it's a pure frontend action that
                              rides the existing disconnect-handling path.
                                                                 │
                                                                 ▼
                              Frontend resets ONLY room-scoped state:
                              state.roomId, state.queue, state.currentSongId,
                              state.serverState, state.isHost; stops
                              runtime.syncInterval / pingInterval; pauses
                              audio and clears its src; Queue/Player
                              revert to their "not in a room" empty states.

                              Does NOT touch: state.userName, any auth
                              state, the WS connection to any OTHER
                              future room, or which shell tab is open.
                              The user stays in the shell, in place.
```

**Why "no new backend code for leaving" is correct, not just convenient:** `backend/websocket.py`'s `finally` block already handles "a client is gone" uniformly regardless of *why* the connection ended. An explicit `ws.close()` from the frontend and an accidental network drop look identical to the backend — which is exactly the property that makes Leave Room require zero backend changes while Room Join (§7) requires a real one. Join is a new *admission* decision the backend has to make; Leave is just the existing *departure* handling, triggered on purpose instead of by accident.

---

## 5. Every Backend Change Required

**Phase 2:**
- New `backend/preferences/routes.py` blueprint (`GET`/`PUT`, both under the `/api/auth/preferences` path per the given API surface — note the blueprint folder is named `preferences/` but the URL stays under `/api/auth/`, which is intentional per your spec, just worth flagging as a naming/path mismatch that's easy to forget when navigating the codebase later).
- A `preferences_service.py` for get/upsert against the `preferences` table.
- Server-side validation of the `eq_settings` JSON shape (band count, gain ranges) before writing — the API must not blindly trust client-submitted JSON into a column that later gets read back and applied directly to Web Audio filter nodes.

**Phase 3:**
- `backend/auth/session_cache.py` — a short-TTL cache in front of `validate_session`, reusing the exact `TTLCache` class already in `backend/cache.py` (correct to actually import/reuse here, unlike Phase 1 where auth intentionally stayed dependency-free from `backend/`).
- An `optional_auth` decorator variant alongside the existing `require_auth`: attaches `g.session` if a valid token is present, never blocks the request if absent. This is what lets existing anonymous routes become auth-*aware* without becoming auth-*required*.
- A cache-eviction hook on logout (see §9 — this is the one place a short TTL alone isn't sufficient).

---

## 6. Every SyncStream Integration Point

- `main.py`: blueprint registrations (`preferences`, Phase 3 wiring) — additive, same pattern as Phase 1's single new line.
- `joinApp()`-equivalent (frontend, restructured per §4a): gains a preference-hydration step. `initAudioEngine()` moves to shell-load time.
- **`backend/websocket.py`: one new gate, precisely scoped (see §7 for the full mechanics).** This is the one place this revision adds a real backend integration point where previously there was deliberately none.
- `last_room_id`: still just a client-side convenience value round-tripped through the preferences API. The in-memory `rooms` dict in `backend/room.py` never becomes aware that preferences or accounts exist — this part of the design is unchanged.

---

## 7. Every WebSocket Change

**This section reverses the original version of this document, by explicit product decision.** The original stated no WS changes were needed, as a deliberate boundary. That boundary is now narrowed, not eliminated: **connection admission is authenticated; in-room identity is not.**

**What changes — one gate, at one point, nothing else:**

`websocket_endpoint(ws, room_id, client_id)` in `backend/websocket.py` validates the caller's session **before** doing anything else — before `get_or_create_room`, before entering the `while True: ws.receive()` loop, before any message (including `join`) is ever processed:

```
┌─────────────┐   WS connect: /ws/<room_id>/<client_id>   ┌──────────────────────┐
│   Browser   │ ──────────────────────────────────────────►│ Extract session token │
└─────────────┘   (cookie sent automatically — same-origin, │ (cookie, or ?token=   │
                    browsers include it on the WS handshake  │ query param fallback  │
                    request same as any other same-origin    │ for non-cookie/       │
                    request)                                 │ localStorage clients) │
                                                               └──────────┬───────────┘
                                                                          │
                                                          validate_session(token)
                                                                          │
                                          ┌───────────────────────────────┴───────────────────────────────┐
                                          │ invalid / missing                                               │ valid
                                          ▼                                                                  ▼
                          Send one structured message, THEN close          Proceed exactly as before:
                          with a specific application close code           get_or_create_room, enter the
                          (not a generic 1000/1006) so the frontend         message loop. client_id remains
                          can distinguish "rejected" from "network          the same ephemeral, per-tab,
                          blip" and NOT auto-retry:                         account-independent identifier
                                                                             it always was. _handle_join
                          {"type": "error", "code": "unauthorized",         and every other message handler
                           "message": "Sign in to join a room"}             are UNCHANGED — by the time any
                          → ws.close(code=4001, ...)                        message reaches them, admission
                                                                             has already been decided.
```

**Why the close code detail matters, concretely:** `socket.js`'s existing `window.ws.onclose` handler unconditionally retries every 3 seconds (`setTimeout(connectWebSocket, 3000)`), with no distinction today between "the network hiccupped" and "this connection was refused." Without a way to tell those apart, an unauthenticated user attempting to join would silently retry forever with no visible explanation. The rejection message + a distinct WS close code is the minimum needed to fix that — the frontend must special-case this close code to stop retrying and show a sign-in prompt instead.

**What does NOT change, and why this is still a narrow exception, not a reopening of the whole boundary:**
- `_handle_join`, `_handle_sync`, `_handle_vote`, `_handle_next` — every individual message handler — are **untouched**. The gate is entirely at connection admission; nothing about in-room message handling becomes auth-aware.
- `client_id` is still the same random, ephemeral, per-tab string it always was. Authentication decides **whether** a connection is admitted, never **who** you are once admitted. A logged-in user is still, from the room's point of view, indistinguishable from any other participant once inside.
- Host-reassignment logic, queue voting, sync/drift-correction — all of it is exactly as it was. This was already true before and remains true: none of it is touched.

**What still would require a further change (still out of scope, unchanged from the original doc):** a signed-in user's host status persisting across a reconnect/refresh still isn't part of this — that would need `join` itself to carry a stable identity, which is a different and larger change than an admission gate. Not happening now.

**Sequencing note:** because this gate calls `validate_session` on every single room-connection attempt (not just occasional API calls), the Phase 3 session cache (§9) now matters more, not less, than it did in the original plan — it's reasonable to build the cache and the WS gate together rather than treating the cache as a nice-to-have added later.

---

## 8. How Preferences Will Be Synced

- **Pull-based, not push-based.** Preferences are fetched once on page load (if authenticated) and written on explicit change events (debounced). There is no WebSocket or polling mechanism keeping multiple open tabs/devices live-synced — if you change your EQ on your phone while your laptop tab is open, the laptop won't update until it next reloads or re-fetches. This is a deliberate simplification (§14), not a bug to fix later without discussion.
- **`volume` has no current UI hook.** SyncStream today has no dedicated volume control — only per-band EQ gains and playback transport. This preference field is schema-ready but Phase 4 will need to either add a volume control or quietly wire it to the `<audio>` element's native `.volume` property with no visible UI. Flagging this now so it isn't discovered mid-Phase-4.
- **`theme` has no current UI hook either.** SyncStream has exactly one visual theme today. This field exists for a future feature, not a current one.

---

## 9. How Sessions Are Validated and Cached

- **Phase 1 (now):** every `require_auth`-protected call hits Supabase directly — no caching. Correct for this phase; premature to cache before there's a reason to (SyncStream isn't calling it yet).
- **Phase 3:** a short-TTL (recommend 60–120s) in-memory cache keyed by `token_hash`, sitting in front of validation for SyncStream's own (optional-auth) touchpoints specifically — **not** in front of the auth blueprint's own routes. `/validate`, `/logout`, and the preferences endpoints stay DB-authoritative on every call, since those are exactly the places where a stale cached "still valid" read would be most wrong (e.g., you would not want a race where a `/logout` call in one tab doesn't immediately reflect in another tab's next `/validate` call).
- **The important nuance: TTL alone is not enough.** A short cache window means a revoked session could still validate successfully for up to the TTL duration purely by timing out naturally — logout must **proactively evict** the corresponding cache entry the moment the session row is deleted, not just rely on the TTL to eventually catch up. This is a specific, named requirement for Phase 3, not an incidental detail.

---

## 10. How Logout Affects Active Rooms — and How Leave Room Affects Login

These are now two explicitly separate actions (per product decision), and the document needs to state both directions clearly.

**Logout never leaves the room.** Because room/WS *in-room identity* is still decoupled from account identity even after §7's admission gate:
- deletes the session row and clears the cookie,
- makes the next preferences read/write, and the next room-join attempt, fail (until signing in again),
- does **not** disconnect the current WebSocket, does **not** remove the user from the room's client list, does **not** reassign host status, does **not** interrupt playback.

One nuance introduced by §7 that didn't exist in the original version of this section: a user who logs out **while already inside a room** stays in that room uninterrupted — the admission gate only runs at *connection time*, not continuously. Logging out mid-session doesn't retroactively evict you. You'd only be blocked from joining a *new* room, or rejoining after your current connection ends for any reason, until you sign in again.

**Leave Room never logs the user out.** Per §4a's flow: it closes the WebSocket, resets only room-scoped frontend state, and leaves auth/session state completely untouched. The user remains signed in, still in the app shell, free to browse or immediately join another room.

**Correction to the original document:** §7's earlier text described a logged-out room participant as "anonymous-looking" — that framing no longer applies, since anonymous users can no longer reach a room at all. Every room participant is now, by construction, someone who was authenticated *at the moment they joined* — even though, per §7, the room itself still has no idea who they are afterward, and even though they may since have logged out (see above).

---

## 11. How Future Features Fit In Without Redesign

The core identity tables (`users`, `sessions`, `otp_codes`) are kept deliberately minimal. Every future feature attaches via a **new table with a `user_id` foreign key**, never by modifying the shape of the core tables:

| Future feature | New table(s) | Touches auth core? |
|---|---|---|
| Playlists | `playlists` (user_id FK), `playlist_songs` (join table) | No |
| Play history | `play_history` (user_id FK, video_id, played_at) | No — populated by a light hook that fires when a *logged-in* participant's song starts, not a WS protocol change |
| Favorites | `favorites` (user_id FK, video_id) | No |
| Profile picture | New nullable `avatar_url` column on `users`; Supabase Storage bucket | Additive column only, falls back to initials when null |
| Username | New nullable, unique `username` column on `users` | Additive column only; email remains the true login identity regardless |

The property that makes this work: **email is permanently the login identity**; nothing above changes what "who is this user" means, they all just hang more data off `user_id`.

---

## 12. What Changed Since Phase 1, and Why

**The headline change, not a gap-fill this time — an explicit product decision overriding a prior architectural boundary:**

0. **Room join/create now requires authentication, enforced at the WebSocket connection layer.** The original document's §7 stated this would never happen, as a deliberate design boundary keeping room identity and account identity fully decoupled. That boundary has been explicitly narrowed by product decision: anonymous users may browse Discover/Search/EQ freely, but connection *admission* to a room is now gated on a valid session, checked backend-side, not just hidden in the UI. In-room identity itself remains exactly as decoupled as before (§7) — this is a narrow, precise exception (can you connect at all), not a reopening of the whole boundary (who are you once connected).

Everything below is unchanged from the original changelog — smaller, spec-silent gaps filled during implementation, not product-level reversals:

1. **"New OTP invalidates the previous unused OTP for that email."** Added because without it, a user requesting two codes in quick succession would have their still-valid *older* code silently fail verification against the wrong (newest) database row, burning one of their five attempts unfairly.
2. **`COOKIE_SECURE` env toggle.** A `Secure` cookie is never set over plain HTTP — needed so local dev/testing doesn't silently break; defaults to secure/production-safe.
3. **A background cleanup thread for rate-limit counters, sessions, and OTPs.** Mirrors the exact pattern `backend/room.py` already uses for its empty-room sweep.

---

## 13. What Technical Debt Has Been Removed

From the old FastAPI system, entirely eliminated (not patched):

- **Password hashing** — gone as a category, not fixed, since there are no passwords anywhere.
- **Timing-unsafe comparison** — replaced with `hmac.compare_digest` everywhere a secret is compared.
- **Verification codes leaking in API responses** — structurally impossible now; the raw OTP exists only in memory long enough to be emailed, and is asserted-absent from every response body in the Phase 1 test suite.
- **No rate limiting** — added (email + IP sliding windows).
- **IDOR on user lookup** — structurally eliminated, not just patched: no route accepts a client-supplied user ID at all; identity always comes from the validated session (`g.session["user_id"]`).
- **Wide-open CORS** — not fixed, *eliminated as a problem class*: because this is a same-origin deployment, no CORS configuration exists at all in the new auth blueprint. There's nothing to misconfigure because there's no cross-origin request happening.

---

## 14. What Has Been Intentionally Simplified

Listed plainly so nothing here is mistaken for an oversight:

- No password reset flow (no passwords exist).
- No refresh tokens / sliding expiry — fixed 30-day session, full OTP re-auth after that.
- No session management UI (view/revoke other devices) — the `sessions` table supports multiple rows per user already, but no endpoint exposes it.
- No real-time, push-based preference sync across tabs/devices — pull-based only (§8).
- No account deletion or data export flow.
- No email-change flow — email is fixed at signup, since it's also the login identity; changing it safely is a meaningfully bigger flow (re-verification, session invalidation) that's out of scope until asked for.
- Rate limiting is single-instance/in-memory — correct at 100-200 users, would need revisiting only if Render scaling to multiple dynos.
- No CAPTCHA or bot protection beyond rate limiting — acceptable at this scale, flagged as a future hardening item if abuse ever appears.
- Audit log is write-only from the app's side — no admin viewer endpoint, by design (forensics/manual DB inspection only, for now).

---

## 15. Remaining Phases — Complexity Estimate

| Phase | Scope | Complexity | Why |
|---|---|---|---|
| **3 — SyncStream integration** | Session cache, `optional_auth` for anonymous routes, **and the WebSocket join gate (§7)** | **Medium–High** *(upgraded — this phase now includes a real security boundary, not just internal plumbing)* | The WS gate itself is a small code change (one check, at one point, in one function), but it's the first place in this entire project where a wrong implementation could either (a) let unauthenticated users through — a real security bug, not a cosmetic one, or (b) break every legitimate room join — a total outage of the app's core feature. Needs the close-code/rejection-message handling done correctly (§7) or logged-out users get a silent infinite-retry loop instead of a clear error. Deserves its own focused testing pass before moving on, not a quick pass alongside other work. |
| **4 — Frontend** | OTP UI, header changes, preference hydration/writes, token handling, **and the full application-shell restructuring (§4a) + Leave Room** | **High** *(upgraded — shell restructuring is now the largest single piece of frontend work in this whole plan, larger than the OTP UI itself)* | Every other frontend item in this plan is additive to the existing shell. This one changes what the shell *is* — decoupling it from room membership, moving `initAudioEngine()`'s trigger point, building room-aware empty states for Queue/Player, and adding Leave Room as a genuinely new user-facing action. Needs to be built and tested as its own coherent piece, not layered in alongside the OTP modal. |
| **5 — Testing** | OTP/session/preference flows against real Supabase, anonymous-mode regression, **plus: unauthenticated WS-join rejection, authenticated WS-join success, and "browse everything except rooms while logged out" as its own explicit regression suite** | **Medium–High** | The anonymous-mode regression is no longer just "does the old UI still work with the flag off" — it now has to prove a specific, security-relevant negative (anonymous users genuinely cannot get a WS connection to a room, not just that the button is hidden). |

---

## Open Decisions

**Resolved by this revision:**

1. ~~Does signing in ever become mandatory?~~ **Resolved:** No — anonymous browsing of Discover/Search/EQ remains permanent and first-class. Authentication is required only for room creation/joining.
2. ~~Does "Your Name" stay independent of the authenticated email identity?~~ **Resolved:** Yes, unchanged — room display name and account email remain fully decoupled, even though room *admission* is now gated on the account.
4. ~~Is "logout doesn't affect your current room" the intended behavior?~~ **Resolved, and sharpened:** yes, plus the reverse is now equally explicit — Leave Room never logs you out either. See §10.

**Still open, blocks Phase 4 starting cleanly:**

3. Should `volume` get a real UI control in Phase 4, or apply silently to `audio.volume` with no visible slider?

**New, raised by this revision — needs an answer before Phase 3 starts:**

5. **Query-param token fallback for the WS handshake (§7):** cookie-based sessions authenticate the WS handshake automatically (same-origin, browser sends the cookie). A localStorage-only client cannot attach a custom header to a WS handshake request, so it needs *some* fallback — the natural one is a `?token=` query parameter on the `/ws/<room_id>/<client_id>` URL. Query parameters can end up in server access logs and browser history, which is a mild token-exposure concern worth a conscious yes/no rather than a silent default. Given the cookie path covers the primary, intended use case, an option worth considering: skip the query-param fallback entirely for v1 and simply require cookie-based sessions for room joining specifically (even if localStorage remains supported for everything else). Needs a decision before Phase 3's WS gate is implemented, not after.
