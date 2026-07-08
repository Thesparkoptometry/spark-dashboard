import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import Login from './Login';
import Dashboard from './Dashboard';
import './index.css';

const ALLOWED_EMAIL = 'cyang.od@gmail.com';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingScreen />;
  if (!user) return <Login />;

  // Restrict to authorized email only
  if (user.email !== ALLOWED_EMAIL) {
    signOut(auth);
    return <Login errorMsg="Access restricted. Please use the authorized account." />;
  }

  return <Dashboard user={user} onSignOut={() => signOut(auth)} />;
}

function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #112640 0%, #1B3A5C 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ textAlign: 'center', color: 'white' }}>
        <div style={{
          width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)',
          borderTopColor: '#2E7D8C', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 16px'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontFamily: "'DM Sans', sans-serif", opacity: 0.6, fontSize: 14 }}>Loading…</p>
      </div>
    </div>
  );
}
