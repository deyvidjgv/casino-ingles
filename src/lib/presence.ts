// Presence tracking with Firebase Realtime Database.
// Automatically sets online state on connect and clears it on disconnect via onDisconnect().
import { rtdb } from './firebase';
import {
  ref,
  set,
  onDisconnect,
  onValue,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/database';

/**
 * Tracks the current user's presence in a given course.
 * Automatically clears when the user disconnects, closes tab or loses internet.
 */
export function trackPresence(courseId: string, uid: string, name: string): () => void {
  if (!courseId || !uid) return () => {};

  const connectedRef = ref(rtdb, '.info/connected');
  const userPresenceRef = ref(rtdb, `presence/${courseId}/${uid}`);

  const unsubscribe = onValue(connectedRef, snap => {
    if (snap.val() === true) {
      onDisconnect(userPresenceRef)
        .remove()
        .then(() => {
          void set(userPresenceRef, {
            online: true,
            name,
            at: serverTimestamp(),
          });
        })
        .catch(() => {});
    }
  });

  return () => {
    unsubscribe();
    void set(userPresenceRef, null).catch(() => {});
  };
}

/**
 * Subscribes to the list of online UIDs for a course.
 */
export function subscribeCoursePresence(
  courseId: string,
  onOnlineChange: (onlineUids: Set<string>) => void,
): Unsubscribe {
  if (!courseId) {
    onOnlineChange(new Set());
    return () => {};
  }

  const coursePresenceRef = ref(rtdb, `presence/${courseId}`);
  return onValue(coursePresenceRef, snap => {
    const data = snap.val() as Record<string, { online?: boolean }> | null;
    const online = new Set<string>();
    if (data) {
      for (const [memberUid, val] of Object.entries(data)) {
        if (val?.online) {
          online.add(memberUid);
        }
      }
    }
    onOnlineChange(online);
  });
}
