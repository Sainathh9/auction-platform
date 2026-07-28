import { useState, useEffect } from 'react';

export default function StatusStrip({ processing }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (processing) {
      setMessage('Processing bid via row-level lock...');
      setVisible(true);
    } else if (visible) {
      setMessage('Bid committed to Postgres');
      const timer = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [processing]);

  if (!visible) return null;

  return (
    <div className="bg-[#F7F8FA] border border-[#E2E4E9] px-4 py-1.5 flex items-center gap-2">
      {processing && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D97706] animate-pulse" />
      )}
      {!processing && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#1F5E45]" />
      )}
      <span className="font-mono text-xs text-[#6B7280]">{message}</span>
    </div>
  );
}
