import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { useAuthStore } from '../auth/authStore';
import { setLang } from '../../i18n';
import { sfx } from '../../lib/sfx';
import './TeacherHeader.css';

interface TeacherHeaderProps {
  /** teachers get the session, class and projector controls; everyone else gets a read-only bar */
  canManage: boolean;
  onOpenClassManager: () => void;
}

export function TeacherHeader({ canManage, onOpenClassManager }: TeacherHeaderProps) {
  const { t, i18n } = useTranslation();
  const courseName = useClassStore(s => s.courseName);
  const courseCode = useClassStore(s => s.courseCode);
  const liveSession = useClassStore(s => s.liveSession);
  const toggleLiveSession = useClassStore(s => s.toggleLiveSession);
  const openRoom = useClassStore(s => s.openRoom);
  const muted = useClassStore(s => s.muted);
  const toggleMuted = useClassStore(s => s.toggleMuted);
  const projectorMode = useClassStore(s => s.projectorMode);
  const toggleProjectorMode = useClassStore(s => s.toggleProjectorMode);
  const user = useAuthStore(s => s.user);
  const signOut = useAuthStore(s => s.signOut);

  const [copied, setCopied] = useState(false);
  const [confirmNewRoom, setConfirmNewRoom] = useState(false);
  const [opening, setOpening] = useState(false);
  const [roomError, setRoomError] = useState(false);
  const lang = i18n.language === 'es' ? 'es' : 'en';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(courseCode);
      sfx.click();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the code is still readable on screen
    }
  };

  return (
    <header className="rc-teacher-hdr" data-ui="">
      <div className="rc-hdr-left">
        <span className="rc-logo-text">{t('auth.brand')}</span>

        <span className="rc-course-badge rc-cut">{courseName}</span>

        {courseCode ? (
          <button
            type="button"
            className="rc-code-chip rc-cut"
            title={lang === 'es' ? 'Clic para copiar código' : 'Click to copy course code'}
            onClick={copyCode}
          >
            <span className="rc-code-title">{lang === 'es' ? 'CÓDIGO' : 'CODE'}</span>
            <span className="rc-code-val">{courseCode}</span>
            {copied && (
              <span className="rc-copied-toast">{lang === 'es' ? '¡Copiado!' : 'Copied!'}</span>
            )}
          </button>
        ) : canManage ? (
          // Nobody can join until the teacher opens the class, Kahoot style.
          <button
            type="button"
            className="rc-cut rc-code-gen"
            onClick={() => {
              sfx.click();
              setConfirmNewRoom(true);
            }}
          >
            {t('auth.generateCode')}
          </button>
        ) : null}
      </div>

      <div className="rc-hdr-right">
        {canManage && (
          <>
            <button
              type="button"
              className={`rc-cut rc-btn-live ${liveSession ? 'is-live' : ''}`}
              disabled={!courseCode}
              onClick={() => {
                sfx.click();
                toggleLiveSession();
              }}
              title={courseCode
                ? (lang === 'es' ? 'Sincronizar sesión con estudiantes' : 'Sync session with students')
                : t('auth.needCodeFirst')}
            >
              <span className="rc-beacon" />
              <span>
                {liveSession
                  ? (lang === 'es' ? 'EN VIVO' : 'LIVE')
                  : (lang === 'es' ? 'INICIAR SESIÓN' : 'START SESSION')}
              </span>
            </button>

            <button
              type="button"
              className="rc-cut rc-hdr-btn"
              onClick={() => {
                sfx.click();
                onOpenClassManager();
              }}
              title={lang === 'es' ? 'Gestionar estudiantes y temas' : 'Manage students & topics'}
            >
              {lang === 'es' ? 'Clase' : 'Class'}
            </button>

            <button
              type="button"
              className={`rc-cut rc-hdr-btn ${projectorMode ? 'is-projector' : ''}`}
              aria-pressed={projectorMode}
              onClick={() => {
                sfx.click();
                toggleProjectorMode();
              }}
              title={lang === 'es' ? 'Modo proyector (alto contraste)' : 'Projector mode (high contrast)'}
            >
              {lang === 'es' ? 'Proyector' : 'Projector'}
            </button>
          </>
        )}

        <button
          type="button"
          className="rc-cut rc-hdr-btn"
          aria-pressed={!muted}
          onClick={toggleMuted}
          title={muted ? t('game.soundOff') : t('game.soundOn')}
        >
          {lang === 'es' ? (muted ? 'Sonido: no' : 'Sonido: sí') : (muted ? 'Sound: off' : 'Sound: on')}
        </button>

        <button
          type="button"
          className="rc-cut rc-hdr-btn rc-lang-btn"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          aria-label={t('lang.switchAria')}
        >
          {lang === 'en' ? 'ES' : 'EN'}
        </button>

        {user && (
          <div className="rc-user-chip rc-cut">
            <span className="rc-user-name">{user.name}</span>
            <span className="rc-user-role">{t(`auth.role.${user.role}`)}</span>
            <button type="button" className="rc-user-out" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </button>
          </div>
        )}
      </div>
      {confirmNewRoom && (
        <div className="rc-room-alert-backdrop" role="dialog" aria-modal="true">
          <div className="rc-cut rc-room-alert">
            <h2>{t('auth.rosterResetTitle')}</h2>
            <p>{t('auth.rosterResetBody')}</p>
            {roomError && <p className="rc-room-alert-error">{t('auth.err.roomFailed')}</p>}
            <div className="rc-room-alert-actions">
              <button
                type="button"
                className="rc-cut rc-hdr-btn rc-room-go"
                disabled={opening || !user}
                onClick={() => {
                  if (!user) return;
                  sfx.click();
                  setOpening(true);
                  setRoomError(false);
                  void openRoom(user.uid)
                    .then(() => setConfirmNewRoom(false))
                    .catch(() => setRoomError(true))
                    .finally(() => setOpening(false));
                }}
              >
                {opening ? t('auth.working') : t('auth.rosterResetConfirm')}
              </button>
              <button type="button" className="rc-cut rc-hdr-btn" onClick={() => setConfirmNewRoom(false)}>
                {t('auth.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
