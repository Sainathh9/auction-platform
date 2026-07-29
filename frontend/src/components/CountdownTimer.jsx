import { useCountdown } from '../hooks/useCountdown';

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function CountdownTimer({ expiresAt, compact = false, darkBg = false, className = '' }) {
  const { hours, minutes, seconds, isExpired, isUrgent } = useCountdown(expiresAt);

  if (isExpired) {
    return (
      <span className={`font-sans ${darkBg ? 'text-gray-400' : 'text-gray-500'} ${compact ? 'text-xs' : 'text-sm'} ${className}`}>
        00h 00m 00s
      </span>
    );
  }

  let colorClass = darkBg ? 'text-white font-semibold' : 'text-gray-900 font-semibold';
  if (isUrgent) {
    colorClass = darkBg ? 'text-red-400 font-semibold' : 'text-red-600 font-semibold';
  }

  return (
    <span className={`font-sans ${colorClass} ${compact ? 'text-xs' : 'text-sm'} tabular-nums ${className}`}>
      {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
    </span>
  );
}
