# Shared Backend (Supabase + Render Free)

This backend now uses **Postgres** via `DATABASE_URL` (Supabase).

No local SQLite disk is needed anymore.

## 1. Create Supabase (dumb way)

1. Go to Supabase and create a new project.
2. Wait until project is ready.
3. Open Project Settings -> Database.
4. Copy the **Connection string (URI)**.
5. Replace `[YOUR-PASSWORD]` in the URI with your DB password.

Keep this value safe. This is your `DATABASE_URL`.

## 2. Deploy backend on Render Free

1. Push this repo to GitHub.
2. In Render: New -> Web Service.
3. Select your repo.
4. Use:
   - Runtime: `Node`
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
5. Add env vars:
   - `DATABASE_URL=<your-supabase-postgres-uri>`
   - `NODE_ENV=production`
6. Deploy.

No persistent disk needed.

## 3. Verify backend

Open:

`https://<your-render-service>.onrender.com/api/health`

Expected:

`{"ok":true}`

## 4. Connect extension (both users)

In Dashboard -> Backend panel:

1. Set URL:
   `https://<your-render-service>.onrender.com/api`
2. Click `Test URL`
3. Click `Save URL`
4. Login/Register

Both users must set the **exact same URL**.

## 5. No-data-loss rollout (multiple users)

Do this order exactly:

1. Both users backup old local data before updating extension:
   - Dashboard -> Export JSON Backup
   - DevTools Console:
```js
chrome.storage.local.get(null, (data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "extension-local-storage-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
```
2. Deploy backend (Render + Supabase).
3. User A updates extension, sets backend URL, logs in.
4. Wait a few seconds for auto migration.
5. Verify User A data appears.
6. User B repeats same steps.
7. Verify User B data appears.
8. Verify both see shared combined data.

Migration behavior:

- old local data is copied into shared DB once per user per backend URL
- local old data is not deleted

## 6. Local run (optional)

```bash
cd backend
npm install
DATABASE_URL='your-supabase-uri' npm start
```
