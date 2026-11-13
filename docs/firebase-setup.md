# Turning on Google sign-in, sync and reminders

Taskeex works without an account: tasks stay on the device. To sign in with Google, see the
same tasks on every device and get reminders from Google Calendar, the app needs a free
Firebase project. This takes about ten minutes and is done once. Everything here is on the
free plan ("Spark"); no card is needed.

## 1. Create the Firebase project

1. Open <https://console.firebase.google.com> and choose **Create a project**. Name it `taskeex`.
   Google Analytics can stay off.
2. In the project, open **Build → Authentication → Get started → Sign-in method**, choose
   **Google**, switch it on, pick a support email and save.
3. Still in Authentication, open **Settings → Authorized domains** and add the address the app
   is served from, without `https://`. For GitHub Pages that is `mikelackovcan.github.io`.
4. Open **Build → Firestore Database → Create database**. Choose a location near you and
   **production mode**.
5. In Firestore, open the **Rules** tab, replace the text with the contents of
   [`firestore.rules`](../firestore.rules) and press **Publish**. These rules let each person
   read and change only their own tasks.

## 2. Give the app the project's details

1. In the Firebase console, open **Project settings** (the cog) → **General → Your apps**, press
   the web icon (`</>`), name the app `taskeex` and register it. Hosting is not needed.
2. Firebase shows a `firebaseConfig` block. Copy `apiKey`, `authDomain`, `projectId` and `appId`
   into [`src/firebase-config.ts`](../src/firebase-config.ts) and commit.

These four values identify the project. They are not secrets: every Firebase web app ships
them to the browser, and the rules from step 1 are what protect the data.

## 3. Allow Google Calendar

The Firebase project is also a Google Cloud project with the same name.

1. Open <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>, check the
   project at the top is `taskeex`, and press **Enable**.
2. Open <https://console.cloud.google.com/auth/scopes> (Google Auth Platform → Data access),
   press **Add or remove scopes**, tick `.../auth/calendar.app.created` and save. This scope lets
   Taskeex make its own calendar and manage the events on it. It cannot read or change any
   other calendar.
3. Open **Audience** in the same section. While the app is in **Testing**, add the Google
   account of each person who will use it under **Test users**. Google shows a "Google hasn't
   verified this app" screen on first sign-in; choose **Continue**.

## 4. Allow Gemini, for spreading tasks

Common ways of saying how to spread tasks ("every other day 6 to 8 pm", "weekdays, mornings",
"today") are read on the device, instantly and for free. Gemini is asked only for unusual
sentences, and only when the person presses "Ask Gemini".

1. Open **Build → AI Logic** in the Firebase console and press **Get started**.
2. Choose the **Gemini Developer API** (free tier, no card) and finish the steps. Firebase keeps
   the Gemini key on its side; the app never holds it.

## What to expect

- Tasks sync between devices within a second or two, and changes made without a connection
  are sent when it returns.
- A task on a day appears in a calendar named **Taskeex** in Google Calendar. A task with a
  time gets a reminder 10 minutes before. A task without a time is an all-day event, and
  Google gives those no reminder.
- Google hands a web page calendar access for one hour at a time. After that, tasks keep
  syncing, and the account button shows a red dot: one tap on **Connect** sends the waiting
  changes to the calendar. Removing this step needs a small server, which the free plan does
  not include.

## Running it locally

`npm run dev` uses the project in `src/firebase-config.ts`. To try sign-in and sync with no
Google project at all, start the Firebase emulators and point the app at them:

```
npx firebase-tools emulators:start --only auth,firestore --project demo-taskeex
VITE_FIREBASE_EMULATOR=1 npm run dev
```
