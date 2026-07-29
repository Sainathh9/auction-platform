import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { loginApi, registerApi, googleLoginApi, getMeApi } from '../lib/api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'artmart_jwt_token';
const USER_KEY = 'artmart_user_profile';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(() => {
    try {
      const data = localStorage.getItem(USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  });

  // Track whether we're in the middle of a login call so we don't
  // let the /me validation effect cancel the just-saved session.
  const loggingIn = useRef(false);

  const isAuthenticated = Boolean(token && user);

  function saveSession(jwtToken, userProfile) {
    loggingIn.current = true;
    setToken(jwtToken);
    setUser(userProfile);
    localStorage.setItem(TOKEN_KEY, jwtToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userProfile));
    // Reset flag after state has settled
    setTimeout(() => { loggingIn.current = false; }, 500);
  }

  function logout() {
    setToken('');
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  // Validate stored session on initial mount only (not after every login)
  const hasMounted = useRef(false);
  useEffect(() => {
    // Skip if already triggered, no token, or in the middle of a login
    if (hasMounted.current) return;
    hasMounted.current = true;

    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;

    getMeApi(storedToken)
      .then((data) => {
        if (data && data.user) {
          const userObj = {
            id: data.user.sub || data.user.id || 'USR-a1b2',
            name: data.user.name || 'User',
            email: data.user.email || '',
            avatar: data.user.avatar
              || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.name || 'User')}&background=000&color=fff`,
          };
          setUser(userObj);
          localStorage.setItem(USER_KEY, JSON.stringify(userObj));
        }
      })
      .catch(() => {
        // Only clear session if we're not in the middle of logging in
        if (!loggingIn.current) {
          logout();
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email, password) {
    if (!email || !password) {
      throw new Error('Please fill in both email and password.');
    }
    const data = await loginApi(email, password);
    if (data.token && data.user) {
      const userObj = {
        id: data.user.id || data.user.sub || 'USR-a1b2',
        name: data.user.name,
        email: data.user.email,
        avatar: data.user.avatar
          || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.name)}&background=000&color=fff`,
      };
      saveSession(data.token, userObj);
      return { success: true };
    }
    throw new Error('Failed to log in');
  }

  async function register(name, email, password) {
    if (!name || !email || !password) {
      throw new Error('Please fill in all registration fields.');
    }
    const data = await registerApi(name, email, password);
    if (data.token && data.user) {
      const userObj = {
        id: data.user.id || data.user.sub,
        name: data.user.name,
        email: data.user.email,
        avatar: data.user.avatar
          || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.name)}&background=000&color=fff`,
      };
      saveSession(data.token, userObj);
      return { success: true };
    }
    throw new Error('Registration failed');
  }

  async function googleLogin() {
    const data = await googleLoginApi();
    if (data.token && data.user) {
      const userObj = {
        id: data.user.id || data.user.sub || 'USR-GGL-8891',
        name: data.user.name,
        email: data.user.email,
        avatar: data.user.avatar
          || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.name)}&background=000&color=fff`,
      };
      saveSession(data.token, userObj);
      return { success: true };
    }
    throw new Error('Google authentication failed');
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated,
        login,
        register,
        googleLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
