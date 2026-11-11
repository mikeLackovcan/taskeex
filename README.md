# Taskeex

Tasks as bubbles you drag onto a calendar.

This is step 1 of the plan: a prototype of the feel.

- Type a task and press Enter to make a bubble.
- Drag the bubble onto the time grid. A dashed outline shows the time it will start, in quarter hours. Tasks never overlap: a task dropped on a busy time goes right after it, and later tasks move down.
- Drop a bubble on a day's header to give it the next free slot from 9:00 (or from now, on today).
- Drag a task to another time or day, or back to the bubbles.
- Tap a task to rename it, set its start time and length, mark it done, make it rolling, or delete it. A rolling task that is left undone moves to today.
- Every move can be undone for a few seconds.

A computer shows the week. A phone shows one day, picked from a strip of days.

Tasks are saved in the browser only. Google Calendar sync and AI spreading come in later steps.

## Run it

```
npm install
npm run dev
```

`npm test` runs the scheduling tests. `npm run build` makes a production build in `dist`.
