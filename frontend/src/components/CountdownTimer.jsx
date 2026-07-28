import { useCountdown } from '../hooks/useCountdown';

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function CountdownTimer({ expiresAt, compact = false }) {
  const { hours, minutes, seconds, isExpired, isUrgent } = useCountdown(expiresAt);

  if (isExpired) {
    return (
      <span className={`font-mono text-[#6B7280] ${compact ? 'text-xs' : 'text-sm'}`}>
        00h 00m 00s
      </span>
    );
  }

  const colorClass = isUrgent ? 'text-[#B91C1C]' : 'text-[#12151C]';

  return (
    <span className={`font-mono ${colorClass} ${compact ? 'text-xs' : 'text-sm'} tabular-nums`}>
      {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
    </span>
  );
}
