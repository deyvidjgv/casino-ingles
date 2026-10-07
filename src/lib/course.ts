// Firestore access for the live class: the room the teacher opens and the roster students
// join. Everything here matches firestore.rules — in particular `joinCodes` is readable only
// to a signed-in user, so a student must have an (anonymous) session before validating a code.
import type { Student } from '../store/classStore';

/** Firestore SDK + app handle, loaded on first use so the map never pays for it. */
async function store() {
  const [{ db }, mod] = await Promise.all([import('./firebase'), import('firebase/firestore')]);
  return { db, ...mod };
}

export interface Course {
  id: string;
  code: string;
}

// Digits only, like a Kahoot PIN: read off a projector, typed on a phone numpad.
const CODE_LENGTH = 5;
const randomCode = () => {
  const n = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(n);
  return Array.from(n, v => String(v % 10)).join('');
};

/**
 * Opens a room: a course document plus the join code that points at it. The code is claimed
 * in a transaction, so two teachers generating at the same moment cannot land on the same one.
 */
export async function createCourse(teacherId: string, courseName: string): Promise<Course> {
  const { db, doc, setDoc, runTransaction, serverTimestamp } = await store();
  const courseId = crypto.randomUUID();

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const claimed = await runTransaction(db, async tx => {
      const ref = doc(db, 'joinCodes', code);
      if ((await tx.get(ref)).exists()) return false;
      tx.set(ref, { courseId, teacherId, createdAt: serverTimestamp() });
      return true;
    });
    if (!claimed) continue;

    await setDoc(doc(db, 'courses', courseId), {
      teacherId, code, name: courseName, createdAt: serverTimestamp(),
    });
    try {
      const { rtdb } = await import('./firebase');
      const { ref: dbRef, set: dbSet } = await import('firebase/database');
      await dbSet(dbRef(rtdb, `courses/${courseId}`), { teacherId });
    } catch {
      // Non-fatal if offline
    }
    return { id: courseId, code };
  }
  throw new Error('Could not claim a free class code');
}

/** Resolves a code typed by a student. Null means no room is using it. */
export async function findCourseByCode(code: string): Promise<Course | null> {
  const { db, doc, getDoc } = await store();
  const snap = await getDoc(doc(db, 'joinCodes', code.trim()));
  const courseId = snap.exists() ? (snap.data().courseId as string | undefined) : undefined;
  return courseId ? { id: courseId, code: code.trim() } : null;
}

/**
 * Adds the student to the roster. The rules only allow a student to create their own member
 * document and only with zero points, so this cannot be used to award points.
 */
export async function joinCourse(
  courseId: string,
  uid: string,
  name: string,
  type: 'account' | 'guest' = 'guest',
): Promise<void> {
  const { db, doc, setDoc, updateDoc } = await store();
  const ref = doc(db, 'courses', courseId, 'members', uid);
  try {
    // First join. Reading the document first is not an option: the rules require membership
    // to read it, so the check would be denied rather than report "missing".
    await setDoc(ref, { name, points: 0, active: true, type });
  } catch {
    // Already on the roster — writing points: 0 again is rejected by the rules, which is what
    // stops a student resetting their own score. Touch only the fields they may change.
    await updateDoc(ref, { name, active: true });
  }
}

/** Live roster. Returns the unsubscribe function. */
export function subscribeMembers(
  courseId: string,
  onChange: (students: Student[]) => void,
  onError?: (e: unknown) => void,
): () => void {
  let stop: (() => void) | undefined;
  let cancelled = false;

  void store()
    .then(({ db, collection, onSnapshot }) => {
      if (cancelled) return;
      stop = onSnapshot(
        collection(db, 'courses', courseId, 'members'),
        snap => {
          onChange(snap.docs.map(d => {
            const data = d.data();
            const memberType = (data.type as Student['type']) ?? 'guest';
            return {
              id: d.id,
              uid: memberType === 'manual' ? undefined : d.id,
              name: (data.name as string) ?? 'Student',
              points: (data.points as number) ?? 0,
              active: (data.active as boolean) ?? true,
              avatarSeed: (data.name as string) ?? d.id,
              type: memberType,
            };
          }));
        },
        e => onError?.(e),
      );
    })
    .catch(e => onError?.(e));

  return () => {
    cancelled = true;
    stop?.();
  };
}

/** Teacher-only: the rules reject a points write from anyone else. */
export async function setMemberPoints(courseId: string, uid: string, points: number): Promise<void> {
  const { db, doc, updateDoc } = await store();
  await updateDoc(doc(db, 'courses', courseId, 'members', uid), { points: Math.max(0, points) });
}

export async function setMemberActive(courseId: string, uid: string, active: boolean): Promise<void> {
  const { db, doc, updateDoc } = await store();
  await updateDoc(doc(db, 'courses', courseId, 'members', uid), { active });
}

/** Teacher-only: a student added from the class manager rather than joining with the code. */
export async function addMember(courseId: string, name: string): Promise<void> {
  const { db, doc, setDoc } = await store();
  await setDoc(doc(db, 'courses', courseId, 'members', crypto.randomUUID()), {
    name, points: 0, active: true, type: 'manual',
  });
}

export async function removeMember(courseId: string, memberId: string): Promise<void> {
  const { db, doc, deleteDoc } = await store();
  await deleteDoc(doc(db, 'courses', courseId, 'members', memberId));
}

export function subscribeCourseState(
  courseId: string,
  onChange: (data: { activeIslandId?: string | null }) => void,
  onError?: (e: unknown) => void,
): () => void {
  let stop: (() => void) | undefined;
  let cancelled = false;

  void store()
    .then(({ db, doc, onSnapshot }) => {
      if (cancelled) return;
      stop = onSnapshot(
        doc(db, 'courses', courseId),
        snap => {
          if (snap.exists()) {
            onChange(snap.data() as { activeIslandId?: string | null });
          }
        },
        e => onError?.(e),
      );
    })
    .catch(e => onError?.(e));

  return () => {
    cancelled = true;
    stop?.();
  };
}

export async function setCourseActiveIsland(courseId: string, islandId: string | null): Promise<void> {
  const { db, doc, updateDoc } = await store();
  await updateDoc(doc(db, 'courses', courseId), { activeIslandId: islandId });
}
