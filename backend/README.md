# Shared Backend

This backend provides shared DB-backed storage for the extension.

## Local Run

```bash
cd backend
npm install
npm start
```

Server runs at:

`http://localhost:8787`

Default DB file:

`backend/shared.db`

## Important Notes

- First login creates the first account (`register-first` flow).
- Other users can login or register.
- All extension pages use this backend via `shared-api.js`.
- Auth is username + password.
- Legacy local extension data auto-migrates once per user on first sign-in per backend URL.
- Keep DB file persistent. If DB is deleted/reset, data is gone.

## Quick Answer For Multi-User

Both users must use the same backend URL in Dashboard -> Backend panel.

Default extension target:

`http://localhost:8787/api`

`localhost` is only your own machine. For real sharing, deploy backend to Render/Railway and use that public URL.

## Render (Recommended)

This repo includes `render.yaml`.

### Setup (dumb/simple)

1. Push this repo to GitHub.
2. In Render: New -> Blueprint -> select this repo.
3. Render auto-detects `render.yaml` and creates service with a persistent disk.
4. Wait until deploy is green.
5. Open:
   `https://<your-render-service>.onrender.com/api/health`
6. Must return:
   `{"ok":true}`

### Why this is safe

- DB path is set to `/var/data/shared.db`.
- `/var/data` is a persistent disk (not wiped on deploy).

## Railway

This repo includes `railway.json`.

### Setup (dumb/simple)

1. Push this repo to GitHub.
2. In Railway: New Project -> Deploy from GitHub.
3. Add environment variable:
   - `DB_PATH=/data/shared.db`
4. Add a persistent volume mounted at `/data`.
5. Deploy.
6. Open:
   `https://<your-railway-domain>/api/health`
7. Must return:
   `{"ok":true}`

### Why this is safe

- DB writes to `/data/shared.db`.
- `/data` is a persistent volume (survives restarts/deploys).

## Zero Data Loss Rollout (Multiple Users)

Do this in order.

1. Both users take backup before updating extension:
   - Dashboard -> `Export JSON Backup`
   - Also raw local storage backup from DevTools console:
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
2. Deploy backend to Render or Railway and verify `/api/health`.
3. User A pulls latest extension, opens Dashboard, Backend panel:
   - paste backend URL (`https://.../api`)
   - click `Test URL`
   - click `Save URL`
   - login/register
4. Wait for migration to complete (few seconds). Verify User A data appears.
5. User B does same steps with the exact same backend URL.
6. Verify both users can see shared data.

Migration behavior:
- Old local data is copied into shared DB.
- Local backup data is not deleted.
- Migration runs once per user per backend URL.

## Backups (Cloud DB file)

Even with persistence, keep manual backups:

- Render shell or Railway shell:
  - copy DB file (`/var/data/shared.db` or `/data/shared.db`) periodically.
- Keep timestamped copies before major updates.
