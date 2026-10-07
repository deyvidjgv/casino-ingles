// Realtime Database synchronization for Stellar Derby live racing.
import { rtdb } from '../../lib/firebase';
import {
  ref,
  set,
  update,
  onValue,
  type Unsubscribe,
} from 'firebase/database';
import type { HorseColor } from './scene';

export type DerbyPhase = 'closed' | 'lobby' | 'tutorial' | 'countdown' | 'running' | 'question' | 'finish';
export type ControlMode = 'phones' | 'single';
export type QuestionMode = 'manual' | 'auto';

export interface LiveRiderInfo {
  uid: string;
  studentId: string;
  name: string;
  lane: number;
  color: HorseColor;
  ready: boolean;
}

export interface LivePodiumResult {
  uid: string;
  lane: number;
  name: string;
  pos: number;
  points: number;
}

export interface LiveRaceState {
  raceId: string;
  phase: DerbyPhase;
  controlMode: ControlMode;
  questionMode: QuestionMode;
  riders: Record<string, LiveRiderInfo>;
  startAt: number; // Server epoch ms for synchronized countdown
  currentQuestion: string | null;
  results: {
    championUid?: string;
    podium?: LivePodiumResult[];
  } | null;
  betting: boolean;
  betPoints: number;
  winPoints: number;
  questionPoints: number;
  activeQuestionNominee: string | null; // UID chosen by teacher to answer
  turboUid: string | null; // UID that received turbo boost
  turboPoints: number;
  updatedAt: number;
}

/** Server time offset in ms (serverTime = clientTime + offset) */
let cachedServerOffset = 0;
let offsetSubscribed = false;

export function initServerTimeOffset(): void {
  if (offsetSubscribed) return;
  offsetSubscribed = true;
  const offsetRef = ref(rtdb, '.info/serverTimeOffset');
  onValue(offsetRef, snap => {
    cachedServerOffset = (snap.val() as number) ?? 0;
  });
}

export function getServerTime(): number {
  return Date.now() + cachedServerOffset;
}

export function getEstimatedServerOffset(): number {
  return cachedServerOffset;
}

export async function publishRaceState(courseId: string, state: LiveRaceState): Promise<void> {
  if (!courseId) return;
  const stateRef = ref(rtdb, `races/${courseId}/state`);
  await set(stateRef, state);
}

export async function updateRaceState(courseId: string, partial: Partial<LiveRaceState>): Promise<void> {
  if (!courseId) return;
  const stateRef = ref(rtdb, `races/${courseId}/state`);
  await update(stateRef, partial);
}

export function subscribeRaceState(
  courseId: string,
  onChange: (state: LiveRaceState | null) => void,
): Unsubscribe {
  if (!courseId) {
    onChange(null);
    return () => {};
  }
  const stateRef = ref(rtdb, `races/${courseId}/state`);
  return onValue(stateRef, snap => {
    onChange(snap.val() as LiveRaceState | null);
  });
}

export async function publishPositions(courseId: string, positions: Record<number, number>): Promise<void> {
  if (!courseId) return;
  const posRef = ref(rtdb, `races/${courseId}/positions`);
  await set(posRef, positions);
}

export function subscribePositions(
  courseId: string,
  onChange: (positions: Record<number, number>) => void,
): Unsubscribe {
  if (!courseId) {
    onChange({});
    return () => {};
  }
  const posRef = ref(rtdb, `races/${courseId}/positions`);
  return onValue(posRef, snap => {
    const val = snap.val() as Record<number, number> | null;
    onChange(val ?? {});
  });
}

export async function sendStudentTap(courseId: string, uid: string, raceId: string, count: number): Promise<void> {
  if (!courseId || !uid) return;
  const tapRef = ref(rtdb, `races/${courseId}/taps/${uid}`);
  await set(tapRef, { raceId, count, t: getServerTime() });
}

export function subscribeStudentTaps(
  courseId: string,
  onChange: (taps: Record<string, { raceId: string; count: number }>) => void,
): Unsubscribe {
  if (!courseId) {
    onChange({});
    return () => {};
  }
  const tapsRef = ref(rtdb, `races/${courseId}/taps`);
  return onValue(tapsRef, snap => {
    const val = snap.val() as Record<string, { raceId: string; count: number }> | null;
    onChange(val ?? {});
  });
}

export async function setRiderReady(courseId: string, uid: string, ready: boolean): Promise<void> {
  if (!courseId || !uid) return;
  const riderReadyRef = ref(rtdb, `races/${courseId}/state/riders/${uid}/ready`);
  await set(riderReadyRef, ready);
}

export async function raiseHand(courseId: string, uid: string): Promise<void> {
  if (!courseId || !uid) return;
  const handRef = ref(rtdb, `races/${courseId}/hands/${uid}`);
  await set(handRef, getServerTime());
}

export function subscribeHands(
  courseId: string,
  onChange: (hands: Record<string, number>) => void,
): Unsubscribe {
  if (!courseId) {
    onChange({});
    return () => {};
  }
  const handsRef = ref(rtdb, `races/${courseId}/hands`);
  return onValue(handsRef, snap => {
    const val = snap.val() as Record<string, number> | null;
    onChange(val ?? {});
  });
}

export async function clearHands(courseId: string): Promise<void> {
  if (!courseId) return;
  const handsRef = ref(rtdb, `races/${courseId}/hands`);
  await set(handsRef, null);
}

export async function placeLiveBet(courseId: string, uid: string, color: HorseColor): Promise<void> {
  if (!courseId || !uid) return;
  const betRef = ref(rtdb, `races/${courseId}/bets/${uid}`);
  await set(betRef, color);
}

export function subscribeLiveBets(
  courseId: string,
  onChange: (bets: Record<string, HorseColor>) => void,
): Unsubscribe {
  if (!courseId) {
    onChange({});
    return () => {};
  }
  const betsRef = ref(rtdb, `races/${courseId}/bets`);
  return onValue(betsRef, snap => {
    const val = snap.val() as Record<string, HorseColor> | null;
    onChange(val ?? {});
  });
}
