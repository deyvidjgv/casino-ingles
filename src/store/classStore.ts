// Class state. The roster and the island the teacher is on live in Firestore; only local
// preferences and the teacher's own topic/question lists are persisted to localStorage.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setMuted } from '../lib/sfx';
import { useAuthStore } from '../features/auth/authStore';
import { addMember, createCourse, removeMember, setMemberActive, setMemberPoints, subscribeMembers, subscribeCourseState, setCourseActiveIsland } from '../lib/course';


/** Last line of defence: the UI hides these controls and Firestore rejects the write, but a
 *  student or guest must never even attempt a mutation. */
const isTeacher = () => useAuthStore.getState().user?.role === 'teacher';

export interface Student {
  id: string;
  name: string;
  active: boolean;
  points: number;
  avatarSeed?: string;
  /** auth uid of the student who joined with the class code; absent if the teacher added them */
  uid?: string;
}

export interface TextItem {
  id: string;
  text: string;
}

export interface HistoryEntry {
  id: string;
  at: number;
  islandId: string;
  game: string;
  summary: string;
  studentIds: string[];
  points: number;
  saved?: boolean;
}

interface ClassState {
  courseName: string;
  /** Empty until the teacher generates one. No code, no way in for students. */
  courseCode: string;
  /** Firestore course document the code points at. Empty when no room is open. */
  courseId: string;
  liveSession: boolean;
  projectorMode: boolean;
  students: Student[];
  topics: TextItem[];
  questions: TextItem[];
  history: HistoryEntry[];
  muted: boolean;
  activeIslandId: string | null;
  setActiveIslandId: (id: string | null) => void;
  addPoints: (studentIds: string[], points: number) => void;
  adjustPoints: (studentId: string, delta: number) => void;
  /** Shared by addPoints/adjustPoints: optimistic local move plus the Firestore write. */
  shiftPoints: (ids: string[], delta: number) => void;
  toggleStudentActive: (studentId: string) => void;
  addStudentsBatch: (names: string[]) => void;
  removeStudent: (id: string) => void;
  addTopicsBatch: (texts: string[]) => void;
  removeTopic: (id: string) => void;
  addQuestionsBatch: (texts: string[]) => void;
  removeQuestion: (id: string) => void;
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'at'>) => void;
  /** Opens a new room in Firestore: fresh code, empty roster. */
  openRoom: (teacherId: string) => Promise<void>;
  /** Mirrors a room the caller already resolved (student side) and starts the live roster. */
  attachRoom: (courseId: string, code: string) => void;
  /** Stops the roster subscription. */
  detachRoom: () => void;
  toggleLiveSession: () => void;
  toggleProjectorMode: () => void;
  toggleMuted: () => void;
  resetDemo: () => void;
}

const uid = () => crypto.randomUUID();

/** Live roster listener, torn down whenever the room changes. */
let unsubscribeRoster: (() => void) | undefined;
let unsubscribeCourse: (() => void) | undefined;
const items = (texts: string[]) => texts.map(text => ({ id: uid(), text }));

function demo() {
  return {
    courseName: 'Demo 10A',
    courseCode: '',
    courseId: '',
    liveSession: false,
    projectorMode: false,
    activeIslandId: null,
    // Sample roster for trying the games solo. Generating a class code clears it.
    students: ['Ana', 'Luis', 'Camila', 'Mateo', 'Sofía', 'Daniel', 'Valentina', 'Samuel', 'Isabella', 'Juan'].map(name => ({
      id: uid(), name, active: true, points: 0, avatarSeed: name,
    })),
    topics: items(['My family', 'Food', 'Past simple', 'My last vacation', 'Hobbies', 'Technology', 'Future plans', 'Animals']),
    questions: items([
      'What did you do last weekend?', 'Describe your best friend.', 'What is your favorite movie and why?',
      'Where would you like to travel?', 'What do you usually eat for breakfast?', 'Tell us about your hobbies.',
      'What will you do next summer?', 'Describe your house.',
    ]),
    history: [] as HistoryEntry[],
  };
}

export const useClassStore = create<ClassState>()(
  persist(
    (set, get) => ({
      ...demo(),
      muted: false,
      // The roster is owned by Firestore, so a local-only write would be undone by the very
      // next snapshot. Points are applied optimistically and pushed; the snapshot confirms.
      setActiveIslandId: (id) => {
        // Students follow the teacher's island; they never publish one.
        if (!isTeacher()) return;
        set({ activeIslandId: id });
        const { courseId } = get();
        if (courseId) {
          void setCourseActiveIsland(courseId, id);
        }
      },
      addPoints: (ids, points) => {
        if (!points || !ids.length) return;
        get().shiftPoints(ids, points);
      },
      adjustPoints: (studentId, delta) => {
        get().shiftPoints([studentId], delta);
      },
      shiftPoints: (ids, delta) => {
        if (!delta || !ids.length || !isTeacher()) return;
        const { courseId, students } = get();
        const next = new Map(
          students
            .filter(st => ids.includes(st.id))
            .map(st => [st.id, Math.max(0, st.points + delta)] as const),
        );
        set(s => ({
          students: s.students.map(st => (next.has(st.id) ? { ...st, points: next.get(st.id)! } : st)),
        }));
        if (!courseId) return;
        next.forEach((points, id) => { void setMemberPoints(courseId, id, points); });
      },
      toggleStudentActive: studentId => {
        if (!isTeacher()) return;
        const { courseId, students } = get();
        const active = !students.find(st => st.id === studentId)?.active;
        set(s => ({
          students: s.students.map(st => (st.id === studentId ? { ...st, active } : st)),
        }));
        if (courseId) void setMemberActive(courseId, studentId, active);
      },
      addStudentsBatch: names => {
        if (!isTeacher()) return;
        const cleaned = names.map(n => n.trim()).filter(Boolean);
        if (!cleaned.length) return;
        const { courseId } = get();
        if (courseId) {
          // the snapshot brings them back with their real ids
          cleaned.forEach(name => { void addMember(courseId, name); });
          return;
        }
        set(s => ({
          students: [
            ...s.students,
            ...cleaned.map(name => ({ id: uid(), name, active: true, points: 0, avatarSeed: name })),
          ],
        }));
      },
      removeStudent: id => {
        if (!isTeacher()) return;
        const { courseId } = get();
        if (courseId) {
          void removeMember(courseId, id);
          return;
        }
        set(s => ({ students: s.students.filter(st => st.id !== id) }));
      },
      addTopicsBatch: texts => {
        if (!isTeacher()) return;
        const cleaned = texts.map(t => t.trim()).filter(Boolean);
        if (!cleaned.length) return;
        set(s => ({ topics: [...s.topics, ...items(cleaned)] }));
      },
      removeTopic: id => {
        if (!isTeacher()) return;
        set(s => ({ topics: s.topics.filter(t => t.id !== id) }));
      },
      addQuestionsBatch: texts => {
        if (!isTeacher()) return;
        const cleaned = texts.map(t => t.trim()).filter(Boolean);
        if (!cleaned.length) return;
        set(s => ({ questions: [...s.questions, ...items(cleaned)] }));
      },
      removeQuestion: id => {
        if (!isTeacher()) return;
        set(s => ({ questions: s.questions.filter(q => q.id !== id) }));
      },
      addHistory: entry => set(s => ({ history: [{ ...entry, id: uid(), at: Date.now() }, ...s.history].slice(0, 500) })),
      openRoom: async teacherId => {
        if (!isTeacher()) return;
        const { id, code } = await createCourse(teacherId, get().courseName);
        // A new room starts empty: students join with the code.
        set({ courseCode: code, courseId: id, students: [], history: [], liveSession: false });
        get().attachRoom(id, code);
      },

      attachRoom: (courseId, code) => {
        unsubscribeRoster?.();
        unsubscribeCourse?.();
        set({ courseId, courseCode: code });
        unsubscribeRoster = subscribeMembers(courseId, students => set({ students }));
        unsubscribeCourse = subscribeCourseState(courseId, data => {
          set({ activeIslandId: data.activeIslandId ?? null });
        });
      },

      detachRoom: () => {
        unsubscribeRoster?.();
        unsubscribeCourse?.();
        unsubscribeRoster = undefined;
        unsubscribeCourse = undefined;
        set({ courseId: '', courseCode: '', students: [], liveSession: false, activeIslandId: null });
      },

      toggleLiveSession: () => {
        if (!isTeacher()) return;
        set(s => ({ liveSession: s.courseCode ? !s.liveSession : false }));
      },
      toggleProjectorMode: () => set(s => ({ projectorMode: !s.projectorMode })),
      toggleMuted: () => set(s => {
        setMuted(!s.muted);
        return { muted: !s.muted };
      }),
      resetDemo: () => {
        if (!isTeacher()) return;
        set(demo());
      },
    }),
    {
      name: 'rc.class',
      // The roster is server state: persist only what identifies the room and the local
      // preferences, never the students themselves.
      partialize: s => ({
        courseName: s.courseName, courseCode: s.courseCode, courseId: s.courseId,
        topics: s.topics, questions: s.questions, muted: s.muted, projectorMode: s.projectorMode,
      }) as Partial<ClassState>,
      // v1 shipped a hardcoded course code; the teacher must now generate one.
      version: 1,
      migrate: persisted => ({ ...(persisted as ClassState), courseCode: '', liveSession: false }),
      onRehydrateStorage: () => state => {
        if (!state) return;
        setMuted(state.muted);
        // A reload drops the listener; the room id survives, so pick the roster back up.
        if (state.courseId) state.attachRoom(state.courseId, state.courseCode);
      },
    },
  ),
);
