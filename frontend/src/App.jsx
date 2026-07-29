import { Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import TopNav from './components/TopNav';

export default function App() {
  const location = useLocation();
  const [isConnected] = useState(false);
  const isLoginPage = location.pathname === '/login';

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-gray-900">
      {!isLoginPage && <TopNav isConnected={isConnected} />}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
