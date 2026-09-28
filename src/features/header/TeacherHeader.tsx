import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { setLang } from '../../i18n';
import { sfx } from '../../lib/sfx';
import './TeacherHeader.css';

interface TeacherHeaderProps {
  onOpenClassManager: () => void;
}

export function TeacherHeader({ onOpenClassManager }: TeacherHeaderProps) {
  const { t, i18n } = useTranslation();
  const courseName = useClassStore(s => s.courseName);
  const courseCode = useClassStore(s => s.courseCode);
  const liveSession = useClassStore(s => s.liveSession);
  const toggleLiveSession = useClassStore(s => s.toggleLiveSession);
  const muted = useClassStore(s => s.muted);
  const toggleMuted = useClassStore(s => s.toggleMuted);
  const projectorMode = useClassStore(s => s.projectorMode);
  const toggleProjectorMode = useClassStore(s => s.toggleProjectorMode);

  const [copied, setCopied] = useState(false);
  const lang = i18n.language === 'es' ? 'es' : 'en';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(courseCode);
      sfx.click();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <header className="rc-teacher-hdr" data-ui="">
      <div className="rc-hdr-left">
        <div className="rc-logo">
          <span className="rc-logo-icon">🪐</span>
          <span className="rc-logo-text">Random Classroom</span>
        </div>

        <div className="rc-course-badge rc-cut">
          <span className="rc-course-label">{courseName}</span>
        </div>

        <button
          type="button"
          className="rc-code-chip rc-cut"
          title={lang === 'es' ? 'Clic para copiar código' : 'Click to copy course code'}
          onClick={copyCode}
        >
          <span className="rc-code-title">{lang === 'es' ? 'CÓDIGO:' : 'CODE:'}</span>
          <span className="rc-code-val">{courseCode}</span>
          <span className="rc-code-action">{copied ? '✓' : '📋'}</span>
          {copied && (
            <span className="rc-copied-toast">
              {lang === 'es' ? '¡Copiado!' : 'Copied!'}
            </span>
          )}
        </button>
      </div>

      <div className="rc-hdr-right">
        <button
          type="button"
          className={`rc-cut rc-btn-live ${liveSession ? 'is-live' : ''}`}
          onClick={() => {
            sfx.click();
            toggleLiveSession();
          }}
          title={lang === 'es' ? 'Sincronizar sesión con estudiantes' : 'Sync session with students'}
        >
          <span className="rc-beacon" />
          <span>{liveSession ? (lang === 'es' ? 'SESIÓN EN VIVO' : 'LIVE SESSION') : (lang === 'es' ? 'INICIAR SESIÓN' : 'START SESSION')}</span>
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
          <span>👥</span>
          <span>{lang === 'es' ? 'Clase' : 'Class'}</span>
        </button>

        <button
          type="button"
          className={`rc-cut rc-hdr-btn ${projectorMode ? 'is-projector' : ''}`}
          onClick={() => {
            sfx.click();
            toggleProjectorMode();
          }}
          title={lang === 'es' ? 'Modo proyector (alto contraste)' : 'Projector mode (high contrast)'}
        >
          <span>📽️</span>
        </button>

        <button
          type="button"
          className="rc-cut rc-hdr-btn"
          aria-pressed={!muted}
          onClick={toggleMuted}
          title={muted ? t('game.soundOff') : t('game.soundOn')}
        >
          <span>{muted ? '🔇' : '🔊'}</span>
        </button>

        <button
          type="button"
          className="rc-cut rc-hdr-btn rc-lang-btn"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          aria-label={t('lang.switchAria')}
        >
          {lang === 'en' ? 'ES' : 'EN'}
        </button>
      </div>
    </header>
  );
}
