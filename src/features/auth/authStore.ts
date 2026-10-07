// Auth state for the three entry roles. Firebase is imported lazily: a guest session, or a
// cold start with no stored account, never pays for the SDK.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'teacher' | 'student' | 'guest';
export type Provider = 'password' | 'guest';

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  role: Role;
  provider: Provider;
}

/** i18n key under `auth.err.*`, resolved by the view. */
export type AuthErrorKey =
  | 'providerOff' | 'badCredentials' | 'emailInUse' | 'weakPassword' | 'badEmail'
  | 'tooMany' | 'network' | 'badCode' | 'nameRequired' | 'unknown';

interface AuthState {
  user: AuthUser | null;
  /** false until a stored Firebase session has been confirmed (or ruled out) */
  ready: boolean;
  busy: boolean;
  error: AuthErrorKey | null;
  init: () => void;
  signInWithEmail: (role: Role, email: string, password: string) => Promise<void>;
  registerWithEmail: (role: Role, name: string, email: string, password: string) => Promise<void>;
  continueAsGuest: (name: string) => Promise<void>;
  /** Student joining a class: anonymous session + display name, no password. */
  joinAsStudent: (name: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

/** Firebase's `auth` module, loaded on first use and reused afterwards. */
async function firebaseAuth() {
  const [{ auth }, mod] = await Promise.all([
    import('../../lib/firebase'),
    import('firebase/auth'),
  ]);
  return { auth, ...mod };
}

function errorKey(e: unknown): AuthErrorKey {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  switch (code) {
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found': return 'providerOff';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'badCredentials';
    case 'auth/email-already-in-use': return 'emailInUse';
    case 'auth/weak-password': return 'weakPassword';
    case 'auth/invalid-email': return 'badEmail';
    case 'auth/too-many-requests': return 'tooMany';
    case 'auth/network-request-failed': return 'network';
    default: return 'unknown';
  }
}

const displayName = (name: string | null, email: string | null) =>
  name?.trim() || email?.split('@')[0] || 'Explorer';

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      // A guest (or a signed-out visitor) needs no Firebase round-trip, so the app can paint at once.
      ready: true,
      busy: false,
      error: null,

      init: () => {
        const stored = get().user;
        // Local-fallback guests (uid prefixed `guest-`) have no backend session to confirm.
        if (!stored || stored.uid.startsWith('guest-')) return;
        set({ ready: false });
        void firebaseAuth()
          .then(({ auth, onAuthStateChanged }) => {
            onAuthStateChanged(auth, fbUser => {
              if (!fbUser) {
                set({ user: null, ready: true });
                return;
              }
              set(s => {
                const same = s.user?.uid === fbUser.uid ? s.user : null;
                return {
                  ready: true,
                  user: {
                    uid: fbUser.uid,
                    // role and name are ours, not Firebase's: an anonymous guest has neither
                    name: same?.name ?? displayName(fbUser.displayName, fbUser.email),
                    email: fbUser.email,
                    role: same?.role ?? 'teacher',
                    provider: same?.provider ?? 'password',
                  },
                };
              });
            });
          })
          .catch(() => set({ ready: true }));
      },

      signInWithEmail: async (role, email, password) => {
        set({ busy: true, error: null });
        try {
          const { auth, signInWithEmailAndPassword } = await firebaseAuth();
          const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
          set({
            user: {
              uid: user.uid, name: displayName(user.displayName, user.email),
              email: user.email, role, provider: 'password',
            },
            busy: false, ready: true,
          });
        } catch (e) {
          set({ busy: false, error: errorKey(e) });
        }
      },

      registerWithEmail: async (role, name, email, password) => {
        if (!name.trim()) {
          set({ error: 'nameRequired' });
          return;
        }
        set({ busy: true, error: null });
        try {
          const { auth, createUserWithEmailAndPassword, updateProfile } = await firebaseAuth();
          const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
          await updateProfile(user, { displayName: name.trim() });
          set({
            user: { uid: user.uid, name: name.trim(), email: user.email, role, provider: 'password' },
            busy: false, ready: true,
          });
        } catch (e) {
          set({ busy: false, error: errorKey(e) });
        }
      },

      continueAsGuest: async name => {
        set({ busy: true, error: null });
        const label = name.trim() || 'Guest';
        try {
          // Firebase anonymous auth gives the guest a real uid, so Firestore rules can
          // treat them like any other signed-in visitor later on.
          const { auth, signInAnonymously } = await firebaseAuth();
          const { user } = await signInAnonymously(auth);
          set({
            user: { uid: user.uid, name: label, email: null, role: 'guest', provider: 'guest' },
            busy: false, ready: true,
          });
        } catch {
          // Anonymous sign-in disabled or offline: a browser-local guest still works,
          // it just has no backend identity.
          set({
            user: {
              uid: `guest-${crypto.randomUUID()}`,
              name: label, email: null, role: 'guest', provider: 'guest',
            },
            busy: false, ready: true,
          });
        }
      },

      joinAsStudent: async name => {
        set({ busy: true, error: null });
        const label = name.trim() || 'Student';
        try {
          const { auth, signInAnonymously } = await firebaseAuth();
          const res = await signInAnonymously(auth);
          const uid = res.user.uid;
          set({
            user: { uid, name: label, email: null, role: 'student', provider: 'guest' },
            busy: false, ready: true,
          });
          return uid;
        } catch (e) {
          set({ busy: false, error: errorKey(e) });
          return null;
        }
      },

      signOut: async () => {
        set({ user: null, error: null, busy: false, ready: true });
        try {
          const { auth, signOut } = await firebaseAuth();
          await signOut(auth);
        } catch {
          // the local session is already cleared; a stale Firebase token is harmless
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'rc.auth',
      partialize: s => ({ user: s.user }),
      onRehydrateStorage: () => state => { state?.init(); },
    },
  ),
);
