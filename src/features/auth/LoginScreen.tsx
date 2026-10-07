import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, type Role } from './authStore';
import { useClassStore } from '../../store/classStore';
import { findCourseByCode, joinCourse } from '../../lib/course';
import { setLang } from '../../i18n';
import './LoginScreen.css';

const ROLES: Role[] = ['teacher', 'student', 'guest'];

export function LoginScreen() {
  const { t, i18n } = useTranslation();
  const attachRoom = useClassStore(s => s.attachRoom);

  const busy = useAuthStore(s => s.busy);
  const error = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);
  const signInWithEmail = useAuthStore(s => s.signInWithEmail);
  const registerWithEmail = useAuthStore(s => s.registerWithEmail);
  const continueAsGuest = useAuthStore(s => s.continueAsGuest);
  const signOut = useAuthStore(s => s.signOut);
  const joinAsStudent = useAuthStore(s => s.joinAsStudent);

  const [role, setRole] = useState<Role | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<'badCode' | 'joinFailed' | null>(null);
  const [joining, setJoining] = useState(false);

  const lang = i18n.language === 'es' ? 'es' : 'en';

  const pickRole = (next: Role) => {
    clearError();
    setCodeError(null);
    setRole(next);
    setMode('signin');
  };

  const backToRoles = () => {
    clearError();
    setCodeError(null);
    setRole(null);
  };

  const handleEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    if (mode === 'signup') void registerWithEmail(role, name, email, password);
    else void signInWithEmail(role, email, password);
  };

  const handleGuest = (e: React.FormEvent) => {
    e.preventDefault();
    void continueAsGuest(name);
  };

  /**
   * Kahoot-style: a code plus a name is the whole sign-up. The order matters — the rules only
   * let a signed-in user read `joinCodes`, so the anonymous session has to come first.
   */
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setJoining(true);
    try {
      const uid = await joinAsStudent(name);
      if (!uid) {
        setCodeError('joinFailed');
        return;
      }
      const course = await findCourseByCode(code);
      if (!course) {
        setCodeError('badCode');
        await signOut();
        return;
      }
      await joinCourse(course.id, uid, name.trim() || 'Student');
      attachRoom(course.id, course.code);
    } catch {
      setCodeError('joinFailed');
      await signOut();
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="lg-root">
      <div className="lg-aurora" aria-hidden="true" />

      <button
        type="button"
        className="rc-cut lg-lang"
        onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
        aria-label={t('lang.switchAria')}
      >
        {t('lang.switchTo')}
      </button>

      <main className="lg-stage">
        <header className="lg-brand">
          <h1 className="lg-title">{t('auth.brand')}</h1>
          <p className="lg-tagline">{t('auth.tagline')}</p>
        </header>

        <section className="rc-cut lg-card" aria-live="polite">
          {role === null ? (
            <>
              <h2 className="lg-card-title">{t('auth.chooseRole')}</h2>
              <p className="lg-card-note">{t('auth.chooseRoleNote')}</p>
              <div className="lg-roles">
                {ROLES.map(r => (
                  <button key={r} type="button" className="rc-cut lg-role" onClick={() => pickRole(r)}>
                    <span className="lg-role-name">{t(`auth.role.${r}`)}</span>
                    <span className="lg-role-desc">{t(`auth.roleDesc.${r}`)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="lg-card-head">
                <button type="button" className="rc-cut lg-back" onClick={backToRoles}>
                  {t('auth.changeRole')}
                </button>
                <h2 className="lg-card-title">{t(`auth.role.${role}`)}</h2>
              </div>

              {role === 'student' ? (
                <form className="lg-form" onSubmit={e => void handleJoin(e)}>
                  <p className="lg-card-note">{t('auth.studentNote')}</p>
                  <label className="lg-field">
                    <span>{t('auth.classCode')}</span>
                    <input
                      className="lg-code-input"
                      type="text" value={code}
                      onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 5)); setCodeError(null); }}
                      placeholder="00000" autoFocus inputMode="numeric" autoComplete="off"
                      pattern="[0-9]*" maxLength={5} required
                    />
                    {codeError && <span className="lg-field-error">{t(`auth.err.${codeError}`)}</span>}
                  </label>
                  <label className="lg-field">
                    <span>{t('auth.displayName')}</span>
                    <input
                      type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder={t('auth.displayNamePlaceholder')} maxLength={40} required
                    />
                  </label>
                  <button type="submit" className="rc-cut lg-submit" disabled={busy || joining}>
                    {busy || joining ? t('auth.working') : t('auth.join')}
                  </button>
                </form>
              ) : role === 'guest' ? (
                <form className="lg-form" onSubmit={handleGuest}>
                  <p className="lg-card-note">{t('auth.guestNote')}</p>
                  <label className="lg-field">
                    <span>{t('auth.displayName')}</span>
                    <input
                      type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder={t('auth.displayNamePlaceholder')} autoFocus maxLength={40}
                    />
                  </label>
                  <button type="submit" className="rc-cut lg-submit" disabled={busy}>
                    {busy ? t('auth.working') : t('auth.enterAsGuest')}
                  </button>
                </form>
              ) : (
                <>
                  <form className="lg-form" onSubmit={handleEmail}>
                    {mode === 'signup' && (
                      <label className="lg-field">
                        <span>{t('auth.displayName')}</span>
                        <input
                          type="text" value={name} onChange={e => setName(e.target.value)}
                          placeholder={t('auth.displayNamePlaceholder')} maxLength={40}
                        />
                      </label>
                    )}
                    <label className="lg-field">
                      <span>{t('auth.email')}</span>
                      <input
                        type="email" value={email} onChange={e => setEmail(e.target.value)}
                        placeholder="you@school.edu" autoComplete="email" required
                      />
                    </label>
                    <label className="lg-field">
                      <span>{t('auth.password')}</span>
                      <input
                        type="password" value={password} onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••" minLength={6} required
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      />
                    </label>
                    <button type="submit" className="rc-cut lg-submit" disabled={busy}>
                      {busy ? t('auth.working') : mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}
                    </button>
                  </form>

                  <button
                    type="button" className="lg-switch"
                    onClick={() => { clearError(); setMode(m => (m === 'signin' ? 'signup' : 'signin')); }}
                  >
                    {mode === 'signin' ? t('auth.needAccount') : t('auth.haveAccount')}
                  </button>
                </>
              )}

              {error && <p className="lg-error">{t(`auth.err.${error}`)}</p>}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
