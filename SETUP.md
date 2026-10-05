# AD ZONEX — Vercel + Supabase setup

Project root = the site. Hosting: Vercel. Database + photo storage: Supabase.
Admin login: Admin ID → Password → Key file (unchanged).

## 1. Supabase (once)
1. supabase.com → **New project** (region near you, e.g. Mumbai/Singapore). Save the database password.
2. **SQL Editor → New query** → paste everything from `supabase/setup.sql` → **Run**.
   (Creates the `kv_store` table, locks it so the public key can't touch it, and creates the private `media` bucket.)
3. **Project Settings → API** → copy the **Project URL** and the **service_role** key.
   The service_role key is a secret: it goes ONLY into Vercel env vars, never into GitHub or the browser.

## 2. Upload to GitHub
```
git init
git add .
git status        # node_modules, .env, generated-keys must NOT be listed
git commit -m "AD ZONEX website"
git branch -M main
git remote add origin https://github.com/chandrasekar-AWS/AD-ZoneX.git
git push -u origin main
```

## 3. Vercel
**Add New → Project** → import `AD-ZoneX` → keep the detected Vite settings → then **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL from step 1.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from step 1.3 |
| `SMTP_USER` | `designadzonex@gmail.com` (Gmail that SENDS the emails) |
| `SMTP_PASS` | Gmail **App Password** (Google Account → Security → 2-Step Verification → App passwords) |
| `ADMIN_USERNAME` | your admin ID (default `adzone_admin`) |
| `ADMIN_PASSWORD` | strong password — change the default! |
| `ADMIN_KEY_SECRET` | optional; if set, make a new key file with `npm run gen-key` |
| `CRON_SECRET` | optional; long random text that protects the daily-backup URL |
| `VITE_GA_ID` | optional Google Analytics ID |

Then **Deployments → Redeploy** (variables only apply to new deployments).

## 4. Where enquiries go
- Design services → `designadzonex@gmail.com`
- Print / Signage / Digital (or none chosen) → `adzonecbe@outlook.com`
- Every enquiry is also saved (Admin → Enquiries, and Supabase → Table Editor → `kv_store`). Check Outlook's Junk folder on the first test.

## 5. Admin
Open `/admin/login` (not linked on the site). Make a key file: `npm run gen-key` → `generated-keys/` (keep it off GitHub).
Wrong-password lock-out (5 tries → 10 min) is stored in Supabase, so it works reliably on Vercel.
Daily auto-backup runs via Vercel Cron; **Admin → Backups** has Back up now / Download / Restore.

## 6. Run locally
```
npm install
npm run dev
```
http://localhost:5173 — locally, data is kept in `.local-data/` (Supabase not needed). Copy `.env.example` to `.env` to test emails.
