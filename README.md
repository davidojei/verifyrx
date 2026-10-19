# VerifyRx

A screening aid that helps people in Nigeria check whether a medicine is *likely* genuine, by scanning
the code on the pack. It is **not** a medical or regulatory decision, and it never says a medicine is
"safe" or "100% real". It only reports what its reference data supports.

## Product rules

Three results only:

1. **VERIFIED** ("Matches our records"): the code is in the reference database and nothing looked unusual.
2. **SUSPICIOUS**: the code is known but flagged: recalled batch, expired, confirmed fake, reported by
   several people, or scanned on many phones / in many areas / many times (possible copied code).
3. **CAN'T CONFIRM**: the code is not found. This is the default for anything unknown. The app tells the
   user to ask a pharmacist and offers to report it.

A disclaimer is visible on the scan, result, report and privacy screens. Every user-facing sentence lives in
`packages/decision/src/copy.ts` and is tested so it cannot say "safe", "100%", "guarantee" or "definitely".

## How it works

    Phone (Expo)                         Supabase                        Admin web (Next.js)
    scan / type code --verify_code()-->  decide + log scan               login, CSV import,
    result screen    <--- result -----   (one SQL function holds          report triage, recalls,
    offline: hashed copy of codes        the rules: decide_reasons)      settings
    report + photos --> outbox --------> reports table + private bucket

- The public never reads tables. Everything goes through `verify_code` and `sync_bundle`.
- Anonymous sign-in gives each install a random ID. No name, phone or email is collected.
- Offline: the phone keeps salted hashes of up to 2,000 codes plus their status. Offline results say
  they may be out of date. Scans and reports made offline wait in an outbox and are sent later.

## Folder map

    apps/mobile        Expo (React Native, TypeScript): scan, result, report, history, privacy
    apps/admin         Next.js admin page (kept out of the npm workspace on purpose)
    packages/decision  Decision rules in TypeScript, user-facing copy, golden test cases
    supabase/          migrations, seed.sql (demo data), tests/
    scripts/           gen-parity-sql.cjs (turns golden cases into a database test)

## Requirements

Node.js 22 LTS, a free Supabase account, an Android phone with Expo Go (same Wi-Fi as the computer).

## Setup (hosted Supabase, no local database needed)

1. **Create a Supabase project.** In **Authentication**, turn on **Anonymous sign-ins**.
2. **Create the database.** In the SQL Editor, run these files from `supabase/`, one at a time, in order:
   `migrations/20261014000001_schema.sql`, `20261014000002_rls.sql`, `20261014000003_functions.sql`,
   then `seed.sql` (demo data only; never run it on a database with real data).
3. **Create an admin.** In **Authentication > Users** add a user (tick Auto Confirm), then run:

       insert into admins (user_id) select id from auth.users where email = 'YOUR-EMAIL';

4. **Environment files** (never commit them; the anon key is public by design, the service_role key must
   never be used in any app):

       apps/mobile/.env        EXPO_PUBLIC_SUPABASE_URL=...   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
       apps/admin/.env.local   NEXT_PUBLIC_SUPABASE_URL=...   NEXT_PUBLIC_SUPABASE_ANON_KEY=...

5. **Install.** `npm install` in the repo root (phone app and decision package), then `npm install` again
   inside `apps/admin` (it has its own install on purpose, so React versions cannot clash).
6. **Run the phone app:** `cd apps/mobile`, `npx expo start --clear`, scan the QR code with Expo Go.
   If the phone cannot connect, allow Node through the Windows firewall (private networks) or use `--tunnel`.
7. **Run the admin page:** `cd apps/admin`, `npm run dev`, open http://localhost:3000.

## Tests

| What | How |
|---|---|
| Decision logic, copy rules, golden coverage | `npm test -w @verifyrx/decision` |
| Admin import validation | `cd apps/admin && npm test` |
| Type checks | `npx tsc --noEmit` inside `apps/mobile` and `apps/admin` |
| Database rules match the golden cases | `node scripts/gen-parity-sql.cjs`, then run `supabase/tests/parity.sql` in the SQL Editor |
| Database behaviour and security | run `supabase/tests/smoke.sql` (freshly seeded database) and `rescan.sql` in the SQL Editor |

If you change `packages/decision/golden/cases.json`, regenerate and re-run the parity test. That is what
keeps the TypeScript and database copies of the rules in step.

## Demo codes (after running seed.sql)

| Code | Result |
|---|---|
| VRXDEMO00001, 00002, 00004 | VERIFIED |
| VRXDEMO00003 | SUSPICIOUS: scanned many times |
| VRXDEMO00005, 00029 | SUSPICIOUS: expired |
| VRXDEMO00008 | SUSPICIOUS: many phones and areas |
| VRXDEMO00010 | SUSPICIOUS: recalled |
| VRXDEMO00014 | SUSPICIOUS: confirmed fake |
| anything else | CAN'T CONFIRM |

Checking a demo code changes its scan count. Re-run `seed.sql` on a fresh database to reset.

## Settings (`app_config`, editable in the admin page)

| Key | Default | Meaning |
|---|---|---|
| flag_at_devices | 3 | warn at this many different phones |
| flag_at_areas | 2 | warn at this many different areas |
| flag_at_scans | 6 | warn at this many counted scans |
| flag_at_reports | 3 | warn at this many people with open reports |
| area_cell_km | 5 | size of one "area" |
| rescan_window_hours | 24 | the same phone re-checking a code inside this window is not counted (0 = count all) |
| max_scans_per_minute | 30 | per-phone limit on checks |
| max_reports_per_hour | 5 | per-phone limit on reports |

## Security notes

- Row level security is on for every table. Admin rights come only from the `admins` table and a
  non-anonymous login.
- Report photos go to a private bucket and are shown to admins with short-lived links.
- Importing data makes codes show as "Matches our records". Only import from sources you trust, and
  protect the admin account (strong password, MFA).
- Review `SECURITY-CHECKLIST.md` before any public use.

## Known limitations

- Offline cache is capped at 2,000 codes and stored in AsyncStorage. A real launch needs `expo-sqlite` and
  incremental sync.
- Codes are matched as whole strings. Real GS1 DataMatrix codes need parsing first.
- Anonymous accounts are free to create, so per-phone limits can be bypassed (see the checklist).
- Offline data refreshes when the app opens with internet; a new recall is not visible offline until then.
- Offline scans are replayed later, so their recorded time is the replay time.
- No audit log of admin actions yet.

## Roadmap

Phase 2: to be defined.