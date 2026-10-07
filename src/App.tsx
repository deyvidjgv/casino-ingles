import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GalaxyMap } from './features/galaxy/GalaxyMap';
import { GameHost } from './games/GameHost';
import { preloadGame } from './games/registry';
import { TeacherHeader } from './features/header/TeacherHeader';
import { Leaderboard } from './features/leaderboard/Leaderboard';
import { ClassManagerModal } from './features/class-manager/ClassManagerModal';
import { LoginScreen } from './features/auth/LoginScreen';
import { useAuthStore } from './features/auth/authStore';
import { useClassStore } from './store/classStore';
import { DEFAULT_ISLANDS } from './features/galaxy/config';
import { trackPresence } from './lib/presence';
import { DerbyPlayerView } from './games/derby/DerbyPlayerView';

export default function App() {
  const { t } = useTranslation();
  const [classManagerOpen, setClassManagerOpen] = useState(false);
  const activeIslandId = useClassStore(s => s.activeIslandId);
  const setActiveIslandId = useClassStore(s => s.setActiveIslandId);
  const courseId = useClassStore(s => s.courseId);
  const projectorMode = useClassStore(s => s.projectorMode);
  const user = useAuthStore(s => s.user);
  const ready = useAuthStore(s => s.ready);

  const activeIsland = activeIslandId ? DEFAULT_ISLANDS.find(i => i.id === activeIslandId) ?? null : null;

  useEffect(() => {
    document.body.classList.toggle('is-projector-mode', projectorMode);
  }, [projectorMode]);

  // Track online presence in RTDB when user is inside a course
  useEffect(() => {
    if (user && courseId) {
      return trackPresence(courseId, user.uid, user.name);
    }
  }, [user, courseId]);

  // Signing out must drop the roster listener: without a session Firestore rejects it anyway.
  useEffect(() => {
    if (!user) useClassStore.getState().detachRoom();
  }, [user]);

  // Only a stored Firebase session blocks here, and only for the round-trip that confirms it.
  if (!ready) return <div className="rc-boot" role="status" aria-label="Loading" />;
  if (!user) return <LoginScreen />;

  const canManage = user.role === 'teacher';

  return (
    <>
      {!activeIsland && (
        <>
          <TeacherHeader canManage={canManage} onOpenClassManager={() => setClassManagerOpen(true)} />
          <Leaderboard canManage={canManage} />
        </>
      )}

      {/* For students during Derby, show the interactive DerbyPlayerView */}
      {!canManage && activeIsland?.game === 'derby' ? (
        <DerbyPlayerView />
      ) : (
        <GalaxyMap
          canEnter={canManage}
          onIslandChange={island => {
            if (canManage) setActiveIslandId(island?.id ?? null);
          }}
          onIslandIntent={island => (canManage ? preloadGame(island.game) : undefined)}
          renderIsland={activeIsland
            ? (island, back) => (
                // `inert` is what makes this read-only: pointer-events alone still lets a
                // student tab to a button and press Enter.
                <div className={canManage ? 'rc-play' : 'rc-play is-spectator'} inert={!canManage}>
                  <GameHost
                    island={island}
                    onExit={() => {
                      if (!canManage) return;
                      setActiveIslandId(null);
                      back();
                    }}
                  />
                </div>
              )
            : undefined}
        />
      )}

      {activeIsland && !canManage && activeIsland.game !== 'derby' && (
        <div className="rc-cut rc-spectator-badge" role="status">{t('game.watching')}</div>
      )}

      {canManage && classManagerOpen && <ClassManagerModal onClose={() => setClassManagerOpen(false)} />}
    </>
  );
}
