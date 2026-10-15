import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export default function Login({ errorMsg }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(errorMsg || '');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError('Sign-in failed. Make sure you\'re using your authorized Google account.');
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="#1B3A5C"/>
            <path d="M12 24c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#2E7D8C" strokeWidth="3" strokeLinecap="round"/>
            <circle cx="24" cy="24" r="5" fill="#2E7D8C"/>
            <circle cx="24" cy="24" r="2" fill="white"/>
          </svg>
        </div>
        <h1 style={styles.title}>The Spark</h1>
        <p style={styles.subtitle}>Practice Dashboard</p>
        <div style={styles.divider}/>
        <p style={styles.desc}>Sign in with your authorized Google account to access practice analytics.</p>
        {error && <div style={styles.error}>{error}</div>}
        <button style={styles.btn} onClick={handleLogin} disabled={loading}>
          {loading ? (
            <span>Signing in…</span>
          ) : (
            <>
              <GoogleIcon />
              <span>Sign in with Google</span>
            </>
          )}
        </button>
      </div>
      <p style={styles.footer}>The Spark Optometry · Private Access Only</p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 10, flexShrink: 0 }}>
      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
      <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
      <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
    </svg>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #112640 0%, #1B3A5C 50%, #234876 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    background: 'white',
    borderRadius: 20,
    padding: '48px 40px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
  },
  logo: { marginBottom: 16 },
  title: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 32,
    color: '#1B3A5C',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 0,
  },
  divider: {
    width: 40,
    height: 2,
    background: '#2E7D8C',
    borderRadius: 1,
    margin: '24px 0',
  },
  desc: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 1.6,
    marginBottom: 24,
  },
  error: {
    background: '#FEE2E2',
    color: '#DC2626',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 16,
    width: '100%',
    textAlign: 'center',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    background: '#1B3A5C',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    padding: '13px 24px',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    width: '100%',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  footer: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 32,
    letterSpacing: '0.05em',
  },
};
