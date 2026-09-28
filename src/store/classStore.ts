// Local class data (demo course) until Firestore courses are wired in. Persisted to localStorage.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setMuted } from '../lib/sfx';

export interface Student {
  id: string;
  name: string;
  active: boolean;
  points: number;
  avatarSeed?: string;
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
  courseCode: string;
  liveSession: boolean;
  projectorMode: boolean;
  students: Student[];
  topics: TextItem[];
  questions: TextItem[];
  history: HistoryEntry[];
  muted: boolean;
  isAuthenticated: boolean;
  setAuthenticated: (val: boolean) => void;
  addPoints: (studentIds: string[], points: number) => void;
  adjustPoints: (studentId: string, delta: number) => void;
  toggleStudentActive: (studentId: string) => void;
  addStudentsBatch: (names: string[]) => void;
  removeStudent: (id: string) => void;
  addTopicsBatch: (texts: string[]) => void;
  removeTopic: (id: string) => void;
  addQuestionsBatch: (texts: string[]) => void;
  removeQuestion: (id: string) => void;
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'at'>) => void;
  toggleLiveSession: () => void;
  toggleProjectorMode: () => void;
  toggleMuted: () => void;
  resetDemo: () => void;
}

const uid = () => crypto.randomUUID();
const items = (texts: string[]) => texts.map(text => ({ id: uid(), text }));

function demo() {
  return {
    courseName: 'Demo 10A',
    courseCode: 'ENG-7K2Q',
    liveSession: false,
    projectorMode: false,
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
    set => ({
      ...demo(),
      muted: false,
      isAuthenticated: false,
      setAuthenticated: (val) => set({ isAuthenticated: val }),
      addPoints: (ids, points) => {
        if (!points || !ids.length) return;
        set(s => ({
          students: s.students.map(st => (ids.includes(st.id) ? { ...st, points: Math.max(0, st.points + points) } : st)),
        }));
      },
      adjustPoints: (studentId, delta) => {
        set(s => ({
          students: s.students.map(st => (st.id === studentId ? { ...st, points: Math.max(0, st.points + delta) } : st)),
        }));
      },
      toggleStudentActive: studentId => {
        set(s => ({
          students: s.students.map(st => (st.id === studentId ? { ...st, active: !st.active } : st)),
        }));
      },
      addStudentsBatch: names => {
        const cleaned = names.map(n => n.trim()).filter(Boolean);
        if (!cleaned.length) return;
        set(s => ({
          students: [
            ...s.students,
            ...cleaned.map(name => ({ id: uid(), name, active: true, points: 0, avatarSeed: name })),
          ],
        }));
      },
      removeStudent: id => {
        set(s => ({ students: s.students.filter(st => st.id !== id) }));
      },
      addTopicsBatch: texts => {
        const cleaned = texts.map(t => t.trim()).filter(Boolean);
        if (!cleaned.length) return;
        set(s => ({ topics: [...s.topics, ...items(cleaned)] }));
      },
      removeTopic: id => {
        set(s => ({ topics: s.topics.filter(t => t.id !== id) }));
      },
      addQuestionsBatch: texts => {
        const cleaned = texts.map(t => t.trim()).filter(Boolean);
        if (!cleaned.length) return;
        set(s => ({ questions: [...s.questions, ...items(cleaned)] }));
      },
      removeQuestion: id => {
        set(s => ({ questions: s.questions.filter(q => q.id !== id) }));
      },
      addHistory: entry => set(s => ({ history: [{ ...entry, id: uid(), at: Date.now() }, ...s.history].slice(0, 500) })),
      toggleLiveSession: () => set(s => ({ liveSession: !s.liveSession })),
      toggleProjectorMode: () => set(s => ({ projectorMode: !s.projectorMode })),
      toggleMuted: () => set(s => {
        setMuted(!s.muted);
        return { muted: !s.muted };
      }),
      resetDemo: () => set(demo()),
    }),
    {
      name: 'rc.class',
      onRehydrateStorage: () => state => { if (state) setMuted(state.muted); },
    },
  ),
);

export const activeStudents = (s: { students: Student[] }) => s.students.filter(st => st.active);
