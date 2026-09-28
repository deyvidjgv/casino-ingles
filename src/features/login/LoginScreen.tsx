import { useState } from 'react';
import { useClassStore } from '../../store/classStore';
import './LoginScreen.css';

export function LoginScreen() {
  const setAuthenticated = useClassStore(s => s.setAuthenticated);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulación de login: el PIN es "1234"
    if (pin === '1234') {
      setAuthenticated(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="login-root">
      <div className="login-card rc-cut gx-glass">
        <h1 className="login-title">Cosmic Casino</h1>
        <p className="login-subtitle">Teacher Access Portal</p>
        
        <form onSubmit={handleLogin} className="login-form">
          <label>
            Enter PIN to continue (Hint: 1234)
            <input 
              type="password" 
              value={pin} 
              onChange={e => setPin(e.target.value)} 
              placeholder="****"
              autoFocus
            />
          </label>
          {error && <div className="login-error">Invalid PIN. Try 1234.</div>}
          <button type="submit" className="rc-cut login-btn">Login</button>
        </form>
      </div>
    </div>
  );
}
