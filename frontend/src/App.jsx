import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import TopNav from './components/TopNav';

export default function App() {
  // Global connection state — in a real app this would be provided by a WebSocket context
  const [isConnected] = useState(false);

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#12151C]">
      <TopNav isConnected={isConnected} />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
