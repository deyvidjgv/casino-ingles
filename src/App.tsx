import { useState, useEffect } from 'react';
import { GalaxyMap } from './features/galaxy/GalaxyMap';
import { GameHost } from './games/GameHost';
import { TeacherHeader } from './features/header/TeacherHeader';
import { Leaderboard } from './features/leaderboard/Leaderboard';
import { ClassManagerModal } from './features/class-manager/ClassManagerModal';
import { LoginScreen } from './features/login/LoginScreen';
import { useClassStore } from './store/classStore';
import type { IslandDef } from './features/galaxy/config';

export default function App() {
  const [classManagerOpen, setClassManagerOpen] = useState(false);
  const [activeIsland, setActiveIsland] = useState<IslandDef | null>(null);
  const projectorMode = useClassStore(s => s.projectorMode);
  const isAuthenticated = useClassStore(s => s.isAuthenticated);

  useEffect(() => {
    document.body.classList.toggle('is-projector-mode', projectorMode);
  }, [projectorMode]);

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <>
      {!activeIsland && (
        <>
          <TeacherHeader onOpenClassManager={() => setClassManagerOpen(true)} />
          <Leaderboard />
        </>
      )}

      <GalaxyMap
        onIslandChange={island => setActiveIsland(island)}
        renderIsland={(island, back) => (
          <GameHost
            island={island}
            onExit={() => {
              setActiveIsland(null);
              back();
            }}
          />
        )}
      />

      {classManagerOpen && <ClassManagerModal onClose={() => setClassManagerOpen(false)} />}
    </>
  );
}
