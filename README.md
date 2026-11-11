# Taskeex

Tasks as bubbles you drag onto a calendar.

This is step 1 of the plan: a prototype of the feel. Type a task, press Enter, and drag the bubble onto a day. A dashed outline shows where it will land. It takes the next free slot from 9:00 (or from now, on today). Drag it to another day, or back to the bubbles. Tap a bubble to rename it, change its length, or delete it. Every move can be undone for a few seconds.

Tasks are saved in the browser only. Google Calendar sync and AI spreading come in later steps.

## Run it

```
npm install
npm run dev
```

`npm test` runs the scheduling tests. `npm run build` makes a production build in `dist`.
