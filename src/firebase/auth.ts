import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { app, auth as configAuth } from './config';

export const ADMIN_TEACHER_EMAIL = 'hanselaa@gmail.com';

export interface TeacherUser {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

const UNAUTHORIZED_TEACHER_ERROR =
  'Kun hanselaa@gmail.com har lærertilgang. Elever logger inn med PIN-kode.';

let cachedTeacherUser: TeacherUser | null = null;
let redirectChecked = false;

function resolveAuth(): Auth | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (configAuth) {
    return configAuth;
  }
  if (!app) {
    return null;
  }
  try {
    return getAuth(app);
  } catch {
    return null;
  }
}

function toTeacherUser(fbUser: User): TeacherUser | null {
  const email = (fbUser.email || '').trim().toLowerCase();
  if (email !== ADMIN_TEACHER_EMAIL) {
    return null;
  }
  return {
    uid: fbUser.uid,
    email,
    displayName: fbUser.displayName ?? null,
    photoURL: fbUser.photoURL ?? null,
  };
}

export function getCurrentTeacherUser(): TeacherUser | null {
  const auth = resolveAuth();
  if (auth?.currentUser) {
    const mapped = toTeacherUser(auth.currentUser);
    if (mapped) {
      cachedTeacherUser = mapped;
      return mapped;
    }
  }
  return cachedTeacherUser;
}

export async function signInTeacherWithGoogle(): Promise<{
  ok: boolean;
  user?: TeacherUser;
  error?: string;
}> {
  const auth = resolveAuth();
  if (!auth) {
    return {
      ok: false,
      error: 'Firebase Authentication er ikke tilgjengelig i dette miljøet.',
    };
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
    login_hint: ADMIN_TEACHER_EMAIL,
  });

  try {
    const result = await signInWithPopup(auth, provider);
    const email = (result.user.email || '').trim().toLowerCase();
    if (email !== ADMIN_TEACHER_EMAIL) {
      cachedTeacherUser = null;
      await signOut(auth);
      return {
        ok: false,
        error: UNAUTHORIZED_TEACHER_ERROR,
      };
    }

    const teacher: TeacherUser = {
      uid: result.user.uid,
      email,
      displayName: result.user.displayName ?? null,
      photoURL: result.user.photoURL ?? null,
    };
    cachedTeacherUser = teacher;
    return { ok: true, user: teacher };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';

    if (code === 'auth/popup-blocked') {
      try {
        await signInWithRedirect(auth, provider);
        return {
          ok: false,
          error: 'Omdirigerer til Google-innlogging...',
        };
      } catch (redirErr: unknown) {
        const msg = (redirErr as { message?: string })?.message || 'Ukjent feil';
        return {
          ok: false,
          error: `Kunne ikke åpne Google-innlogging: ${msg}`,
        };
      }
    }

    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return {
        ok: false,
        error: 'Google-innloggingen ble avbrutt.',
      };
    }

    if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
      return {
        ok: false,
        error:
          'Google Sign-In må aktiveres under Authentication -> Sign-in method i Firebase Console for tt-classroom-ed-2026.',
      };
    }

    if (code === 'auth/unauthorized-domain') {
      return {
        ok: false,
        error: 'Dette domenet er ikke lagt til under Authorized Domains i Firebase Authentication.',
      };
    }

    const message = (err as { message?: string })?.message || 'Kunne ikke logge inn med Google.';
    return {
      ok: false,
      error: message,
    };
  }
}

export async function signOutTeacher(): Promise<void> {
  cachedTeacherUser = null;
  const auth = resolveAuth();
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('[Auth] signOut warning:', err);
  }
}

export function subscribeToTeacherAuth(
  cb: (user: TeacherUser | null, authReady: boolean) => void,
): () => void {
  const auth = resolveAuth();
  if (!auth) {
    cb(null, true);
    return () => {};
  }

  if (!redirectChecked) {
    redirectChecked = true;
    getRedirectResult(auth)
      .then(async (res) => {
        if (res?.user) {
          const email = (res.user.email || '').trim().toLowerCase();
          if (email !== ADMIN_TEACHER_EMAIL) {
            cachedTeacherUser = null;
            await signOut(auth);
          }
        }
      })
      .catch(() => {
        // Ignore redirect check errors when not returning from redirect
      });
  }

  return onAuthStateChanged(
    auth,
    (fbUser) => {
      if (!fbUser) {
        cachedTeacherUser = null;
        cb(null, true);
        return;
      }

      const teacher = toTeacherUser(fbUser);
      if (!teacher) {
        cachedTeacherUser = null;
        cb(null, true);
        signOut(auth).catch(() => {});
        return;
      }

      cachedTeacherUser = teacher;
      cb(teacher, true);
    },
    (err) => {
      console.warn('[Auth] onAuthStateChanged warning:', err);
      cachedTeacherUser = null;
      cb(null, true);
    },
  );
}
