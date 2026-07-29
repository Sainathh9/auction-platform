import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, register, googleLogin, isAuthenticated, user, logout } = useAuth();
  const { addToast } = useToast();

  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('stanley@gmail.com');
  const [password, setPassword] = useState('password123');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated && user) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-6 bg-[#F8F9FA]">
        <div className="bg-white border border-gray-200 p-8 rounded-2xl max-w-md w-full text-center space-y-6 shadow-xl">
          <div className="w-20 h-20 bg-gray-900 rounded-full mx-auto flex items-center justify-center text-white text-2xl font-bold font-serif shadow-md">
            {user.name.charAt(0)}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Logged In Session</div>
            <h2 className="text-2xl font-bold text-gray-900 mt-1">{user.name}</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{user.email}</p>

          </div>

          <div className="space-y-3 pt-2 border-t border-gray-100">
            <button
              onClick={() => navigate('/')}
              className="w-full bg-gray-900 hover:bg-black text-white text-xs font-bold py-3 uppercase tracking-wider transition-colors cursor-pointer rounded-lg shadow-sm"
            >
              Enter Live Bidding Terminal →
            </button>
            <button
              onClick={() => {
                logout();
                addToast('Logged out successfully', 'info');
              }}
              className="w-full bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold py-2.5 transition-colors cursor-pointer rounded-lg"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        addToast(`Welcome back, ${email.split('@')[0]}! JWT token issued.`, 'success');
      } else {
        await register(name, email, password);
        addToast(`Account created for ${name}! JWT token issued.`, 'success');
      }
      navigate('/');
    } catch (err) {
      addToast(err.message || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    try {
      await googleLogin();
      addToast('Authenticated with Google OAuth 2.0!', 'success');
      navigate('/');
    } catch (err) {
      addToast('Google OAuth login failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4 sm:p-8">
      {/* Central Split Layout Card */}
      <div className="bg-white border border-gray-200 rounded-3xl shadow-2xl overflow-hidden max-w-[1100px] w-full grid grid-cols-1 lg:grid-cols-12 min-h-[620px]">
        {/* Left Side: Auth Form Container */}
        <div className="lg:col-span-6 p-8 sm:p-12 flex flex-col justify-between space-y-6">
          {/* Brand Logo */}
          <div className="flex items-center gap-2">
            <Link to="/" className="text-xl font-serif font-bold text-gray-900 tracking-tight no-underline flex items-center gap-2">
              <span>OutBid</span>
              <span className="text-[10px] font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 uppercase tracking-wider rounded">
                AUCTION
              </span>
            </Link>
          </div>

          {/* Heading & Subtitle */}
          <div className="space-y-1.5">
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-900 tracking-tight leading-tight">
              {mode === 'login' ? 'Hello, Welcome Back' : 'Create an Account'}
            </h1>
            <p className="text-xs text-gray-500">
              {mode === 'login'
                ? 'Enter your credentials to access live luxury bidding'
                : 'Join the premier marketplace for luxury art & timepieces'}
            </p>
          </div>



          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Stanley Hudson"
                  className="w-full border border-gray-200 bg-gray-50 text-gray-900 text-xs px-4 py-3 rounded-xl focus:outline-none focus:border-gray-900 focus:bg-white transition-all placeholder:text-gray-400"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="stanley@gmail.com"
                className="w-full border border-gray-200 bg-gray-50 text-gray-900 text-xs px-4 py-3 rounded-xl focus:outline-none focus:border-gray-900 focus:bg-white transition-all placeholder:text-gray-400 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full border border-gray-200 bg-gray-50 text-gray-900 text-xs px-4 py-3 rounded-xl focus:outline-none focus:border-gray-900 focus:bg-white transition-all placeholder:text-gray-400 font-mono"
              />
            </div>

            {mode === 'login' && (
              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-gray-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 accent-black cursor-pointer"
                  />
                  <span>Remember me</span>
                </label>
                <a href="#forgot" onClick={(e) => { e.preventDefault(); addToast('Password reset link sent to ' + email, 'info'); }} className="text-gray-500 hover:text-black font-medium no-underline">
                  Forgot Password?
                </a>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 hover:bg-black text-white text-xs font-bold py-3.5 px-4 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-lg uppercase tracking-wider disabled:opacity-50 mt-2"
            >
              {loading
                ? 'Verifying JWT & bcrypt...'
                : mode === 'login'
                ? 'Sign In →'
                : 'Create Account →'}
            </button>
          </form>

          {/* Toggle Mode */}
          <div className="text-xs text-center text-gray-500 pt-2">
            {mode === 'login' ? (
              <span>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="text-gray-900 font-bold hover:underline cursor-pointer bg-transparent border-none p-0"
                >
                  Sign Up
                </button>
              </span>
            ) : (
              <span>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-gray-900 font-bold hover:underline cursor-pointer bg-transparent border-none p-0"
                >
                  Sign In
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Right Side: AI Generated Luxury Studio Photo */}
        <div className="hidden lg:block lg:col-span-6 p-4 relative bg-gray-900 overflow-hidden">
          <div className="w-full h-full rounded-2xl overflow-hidden relative">
            <img
              src="/images/login_side.png"
              alt="OutBid Luxury Auction Room"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-8 text-white space-y-2">
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
