import { useState, useEffect, useRef } from 'react';

export function useCountdown(expiresAt) {
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const remaining = Math.max(0, expiresAt - now);
  const isExpired = remaining <= 0;
  const isUrgent = remaining > 0 && remaining <= 60000;

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { hours, minutes, seconds, remaining, isExpired, isUrgent };
}
