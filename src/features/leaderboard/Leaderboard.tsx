import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassStore, type Student } from '../../store/classStore';
import { sfx } from '../../lib/sfx';
import './Leaderboard.css';

interface LeaderboardProps {
  /** only a teacher can move points or flip attendance */
  canManage: boolean;
}

export function Leaderboard({ canManage }: LeaderboardProps) {
  const { i18n } = useTranslation();
  const students = useClassStore(s => s.students);
  const adjustPoints = useClassStore(s => s.adjustPoints);
  const toggleStudentActive = useClassStore(s => s.toggleStudentActive);
  const [open, setOpen] = useState(false);

  const lang = i18n.language === 'es' ? 'es' : 'en';

  const sorted = [...students].sort((a, b) => b.points - a.points);
  const topActive = sorted.filter(s => s.active).slice(0, 3);

  const handleAdjust = (student: Student, delta: number) => {
    sfx.click();
    adjustPoints(student.id, delta);
  };

  const avatarUrl = (name: string) =>
    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}&backgroundColor=transparent`;

  return (
    <aside className={`rc-leaderboard ${open ? 'is-open' : 'is-collapsed'}`} data-ui="">
      <button
        type="button"
        className="rc-cut rc-lb-trigger"
        onClick={() => {
          sfx.click();
          setOpen(o => !o);
        }}
        aria-expanded={open}
      >
        <span className="rc-lb-summary">
          <span className="rc-lb-title">{lang === 'es' ? 'MARCADOR' : 'LEADERBOARD'}</span>
          {!open && topActive.length > 0 && (
            <span className="rc-lb-mini-podium">
              {topActive.map((st, idx) => (
                <span key={st.id} className="rc-mini-player">
                  <span className="rc-mini-rank" data-rank={idx + 1}>{idx + 1}</span>
                  <span className="rc-mini-name">{st.name}</span>
                  <span className="rc-mini-pts">{st.points}</span>
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="rc-lb-chevron" data-open={open} aria-hidden="true" />
      </button>

      {open && (
        <div className="rc-cut rc-lb-drawer">
          <div className="rc-lb-list">
            {sorted.map((st, index) => (
              <div key={st.id} className={`rc-lb-row ${st.active ? '' : 'is-inactive'}`}>
                <div className="rc-lb-rank" data-rank={index + 1}>{index + 1}</div>

                <div className="rc-lb-avatar">
                  <img src={avatarUrl(st.name)} alt="" loading="lazy" decoding="async" />
                </div>

                <div className="rc-lb-info">
                  <div className="rc-lb-name">{st.name}</div>
                  {canManage ? (
                    <button
                      type="button"
                      className="rc-lb-status"
                      title={lang === 'es' ? 'Alternar presente/ausente' : 'Toggle present/absent'}
                      onClick={() => toggleStudentActive(st.id)}
                    >
                      {st.active ? (lang === 'es' ? 'Presente' : 'Present') : (lang === 'es' ? 'Ausente' : 'Absent')}
                    </button>
                  ) : (
                    <span className="rc-lb-status is-static">
                      {st.active ? (lang === 'es' ? 'Presente' : 'Present') : (lang === 'es' ? 'Ausente' : 'Absent')}
                    </span>
                  )}
                </div>

                <div className="rc-lb-pts">
                  <span className="rc-pts-val">{st.points}</span>
                  <span className="rc-pts-unit">pts</span>
                </div>

                {canManage && (
                  <div className="rc-lb-quick-actions">
                    <button type="button" className="rc-cut rc-quick-btn" title="+1" onClick={() => handleAdjust(st, 1)}>
                      +1
                    </button>
                    <button type="button" className="rc-cut rc-quick-btn" title="+5" onClick={() => handleAdjust(st, 5)}>
                      +5
                    </button>
                    <button
                      type="button"
                      className="rc-cut rc-quick-btn rc-minus"
                      title="-1"
                      disabled={st.points <= 0}
                      onClick={() => handleAdjust(st, -1)}
                    >
                      −1
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
