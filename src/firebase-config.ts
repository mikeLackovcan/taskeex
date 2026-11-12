// The Firebase project Taskeex signs in to and saves tasks in.
// These values identify the project; they are not secrets and are safe to commit.
// While they are empty, Taskeex keeps tasks on the device only and shows no sign-in.
// docs/firebase-setup.md explains where they come from.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
}

/** Set VITE_FIREBASE_EMULATOR=1 to run against the local Firebase emulators (for tests). */
export const useEmulator = !!import.meta.env.VITE_FIREBASE_EMULATOR

export const cloudConfigured = useEmulator || !!firebaseConfig.apiKey
