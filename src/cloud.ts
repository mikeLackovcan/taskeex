// Everything that talks to Firebase: Google sign-in and the tasks saved in the account.
// Loaded only when a Firebase project is configured.
import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { firebaseConfig, useEmulator } from './firebase-config'
import type { Task } from './schedule'
import { sortTasks, type Diff, type Events } from './sync'

/** Lets Taskeex make its own calendar in Google Calendar and manage the events on it, and nothing else. */
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const TOKEN_KEY = 'taskeex.google-token'
/** Google's access tokens last an hour. Stop using one a little early. */
const TOKEN_LIFE_MS = 55 * 60 * 1000

const app = initializeApp(
  useEmulator
    ? { apiKey: 'demo', authDomain: 'demo-taskeex.firebaseapp.com', projectId: 'demo-taskeex', appId: 'demo' }
    : firebaseConfig,
)
const auth = getAuth(app)

/** The Firebase app, for other Firebase services such as Gemini (see ai.ts). */
export { app }

let db: Firestore
try {
  // Keeps a copy on the device, so changes made without a connection are sent later.
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
} catch {
  db = getFirestore(app)
}

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

export type Account = { uid: string; email: string }

export const onAccount = (cb: (account: Account | null) => void) =>
  onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email ?? '' } : null))

// ---------- Google access token, for the calendar ----------

function saveToken(token: string | undefined) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, until: Date.now() + TOKEN_LIFE_MS }))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Without storage the calendar stays connected only until the page is closed.
  }
  memoryToken = token ? { token, until: Date.now() + TOKEN_LIFE_MS } : null
}

let memoryToken: { token: string; until: number } | null = null

/** The Google access token, while it is still good. */
export function googleToken() {
  try {
    memoryToken ??= JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null')
  } catch {
    // keep what is in memory
  }
  return memoryToken && memoryToken.until > Date.now() ? memoryToken.token : null
}

export const dropGoogleToken = () => saveToken(undefined)

/**
 * Sign in with Google and get calendar access. Also used to connect the calendar again
 * after the hour-long access runs out; `email` then skips the account chooser.
 */
export async function signIn(email?: string) {
  const provider = new GoogleAuthProvider()
  provider.addScope(CALENDAR_SCOPE)
  if (email) provider.setCustomParameters({ login_hint: email })
  const result = await signInWithPopup(auth, provider)
  saveToken(GoogleAuthProvider.credentialFromResult(result)?.accessToken)
}

export async function signOut() {
  saveToken(undefined)
  await firebaseSignOut(auth)
}

if (useEmulator) {
  // Lets a test sign in without Google's own window.
  ;(window as unknown as Record<string, unknown>).__taskeexTestSignIn = async (email: string) => {
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })),
    )
    saveToken('test-token')
  }
}

// ---------- Tasks in the account ----------

const tasksOf = (uid: string) => collection(db, 'users', uid, 'tasks')
const eventsOf = (uid: string) => collection(db, 'users', uid, 'events')

/** Firestore does not store `undefined`; a missing field is simply left out. */
const clean = (t: Task) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined))

export type Snapshot = {
  tasks: Task[]
  /** The calendar events that exist, and what each was made from. */
  events: Events
  /** The id of the Taskeex calendar in Google Calendar, once it has been made. */
  calendarId: string | null
}

/** Call `cb` with the account's data now and again every time it changes, on any device. */
export function listen(uid: string, cb: (snapshot: Snapshot) => void, onError: (e: Error) => void) {
  const state: Partial<Snapshot> = {}
  const emit = () => {
    if (state.tasks && state.events && state.calendarId !== undefined) cb(state as Snapshot)
  }
  const stops = [
    onSnapshot(
      tasksOf(uid),
      (snap) => {
        state.tasks = sortTasks(snap.docs.map((d) => d.data() as Task))
        emit()
      },
      onError,
    ),
    onSnapshot(
      eventsOf(uid),
      (snap) => {
        state.events = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().sig as string]))
        emit()
      },
      onError,
    ),
    onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        state.calendarId = (snap.data()?.calendarId as string | undefined) ?? null
        emit()
      },
      onError,
    ),
  ]
  return () => stops.forEach((stop) => stop())
}

/** Save changes made on this device. */
export async function push(uid: string, d: Diff) {
  const batch = writeBatch(db)
  for (const t of d.upserts) batch.set(doc(tasksOf(uid), t.id), clean(t))
  for (const t of d.removes) batch.delete(doc(tasksOf(uid), t.id))
  await batch.commit()
}

/** Record what a task's calendar event was made from, or (null) that the event is gone. */
export const setEvent = (uid: string, taskId: string, sig: string | null) =>
  sig === null ? deleteDoc(doc(eventsOf(uid), taskId)) : setDoc(doc(eventsOf(uid), taskId), { sig })

/** Forget every event, after the calendar they were on was deleted. */
export async function clearEvents(uid: string) {
  const snap = await getDocs(eventsOf(uid))
  const batch = writeBatch(db)
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
}

/** Save the id of a newly made calendar, unless the account already has one. Returns the id to use. */
export const claimCalendar = (uid: string, calendarId: string) =>
  runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', uid)
    const existing = (await tx.get(ref)).data()?.calendarId as string | undefined
    if (existing) return existing
    tx.set(ref, { calendarId }, { merge: true })
    return calendarId
  })

export const setCalendarId = (uid: string, calendarId: string | null) =>
  setDoc(doc(db, 'users', uid), { calendarId }, { merge: true })
