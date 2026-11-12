# Taskeex

Tasks as bubbles you drag onto a calendar.

This is step 1 of the plan: a prototype of the feel.

- Type a task and press Enter to make a bubble.
- Drag the bubble onto the time grid. A dashed outline shows the time it will start, in quarter hours. Tasks never overlap: a task dropped on a busy time goes right after it, and later tasks move down.
- Drop a bubble on a day's "Any time" lane to put it on that day with no set time.
- Drop a task on a day's name to move it to that day. A task with a time keeps it.
- On a phone, hold a bubble over a day in the strip to open that day, then drop it on a time.
- Drag a task to another time or day, or back to the bubbles.
- Tap a task to rename it, set its start time and length, mark it done, make it rolling, or delete it. A rolling task that is left undone moves to today.
- Every move can be undone for a few seconds.

A computer shows the week. A phone shows one day, picked from a strip of days.

The button beside the task box switches between the device's theme, light and dark.

Taskeex can be installed as an app: open it in the phone's browser and choose "Add to Home Screen". It opens without a connection once it has been opened online.

Tasks are saved on the device. Once a Firebase project is set up ([docs/firebase-setup.md](docs/firebase-setup.md)), an account button appears: signing in with Google keeps the same tasks on every device and puts tasks that are on a day into a "Taskeex" calendar in Google Calendar, with a reminder 10 minutes before a timed task. AI spreading comes in a later step.

## Run it

```
npm install
npm run dev
```

`npm test` runs the scheduling tests. `npm run build` makes a production build in `dist`.

## Publishing

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/ci.yml`. Pages must be turned on once in the repository settings, with "GitHub Actions" as its source.
