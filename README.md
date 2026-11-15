# Budget Calculator

A self-hosted paycheck planner. For each paycheck it shows which bills it has
to cover, how much of the rent it should carry, and how much is left for the
two weeks and for each week. Bills can be moved between paychecks, checked off
as they are paid, and tested in what-if copies before you commit to a decision.

`DESIGN.md` describes how it works and why.

## Run it

You need Docker.

```sh
docker compose up -d --build
```

Open http://localhost:3000, choose **New profile**, and set your pay schedule.

To use it from a phone on the same Wi-Fi, open `http://<this computer's IP address>:3000`.
In the phone's browser menu, "Add to Home Screen" gives it an icon like an app.

Each person makes their own profile. Profiles do not see each other's budgets.
Once everyone has one, set `ALLOW_SIGNUP: "false"` in `docker-compose.yml` and
run the command above again.

## Your data

Everything is in one SQLite file, `budget.db`, in the `budget-data` Docker
volume. It is outside the container, so restarts, crashes, and rebuilds do not
touch it. The server also writes a dated copy to a `backups` folder beside it
once a day and keeps the newest seven.

For a copy you hold yourself, use **Settings › Backup › Download a backup
file**. The same screen restores from one.

`docker compose down` keeps the data. `docker compose down -v` deletes the
volume and the data with it.

## Work on it

You need Node 22 or newer.

```sh
npm install
npm run dev        # interface on http://localhost:5173, server on port 3000
npm test           # budget math and server tests
npm run typecheck
npm run build      # production build into dist/
npm start          # run the production build
```

In development the database is `./data/budget.db`. Set `DATA_DIR` to put it
somewhere else, and `PORT` to change the port.

After changing `server/schema.ts`, run `npm run db:generate` to create the
matching migration in `drizzle/`. Migrations run on startup.

## Layout

| Folder | What is in it |
| --- | --- |
| `shared/` | The budget math and every way a plan can change. No database or interface code. |
| `server/` | Sign-in, profiles, and storage of plans. |
| `web/` | The screens. |
| `drizzle/` | Database migrations. |
