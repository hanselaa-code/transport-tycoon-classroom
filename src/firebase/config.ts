import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const metaEnv: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env) ||
  (typeof process !== 'undefined' ? process.env : {}) ||
  {};

export const firebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || 'AIzaSyBYuujIYRRtZdf2JxbWK27XMVn1KbjaXJM',
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || 'tt-classroom-ed-2026.firebaseapp.com',
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || 'tt-classroom-ed-2026',
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || 'tt-classroom-ed-2026.firebasestorage.app',
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || '280386968883',
  appId: metaEnv.VITE_FIREBASE_APP_ID || '1:280386968883:web:0e7a5c76fe9f318d633246',
};

export const hasValidFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    !firebaseConfig.apiKey.includes('placeholder'),
);

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (hasValidFirebaseConfig) {
  try {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    dbInstance = getFirestore(appInstance);
    if (typeof window !== 'undefined') {
      authInstance = getAuth(appInstance);
    }
  } catch (err) {
    console.warn('[Firebase] Initialization warning:', err);
  }
}

export const app: FirebaseApp | null = appInstance;
export const db: Firestore | null = dbInstance;
export const auth: Auth | null = authInstance;
