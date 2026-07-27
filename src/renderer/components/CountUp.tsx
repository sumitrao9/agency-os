import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  durationMs?: number;
  format?: (n: number) => string;
}

// Animates a number counting up to `value` whenever it changes — used
// instead of numbers just snapping to a new value, per the "premium app"
// polish pass (Dashboard/Scraper stat tiles).
export default function CountUp({ value, durationMs = 500, format }: CountUpProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, durationMs]);

  return <span className="count-up">{format ? format(display) : display}</span>;
}
