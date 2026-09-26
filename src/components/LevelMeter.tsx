const SEGMENTS = 24;

/** Segmented level meter; `level` is 0..1 on a -60..0 dBFS scale. */
export function LevelMeter({level, active = true}: {level: number; active?: boolean}) {
  const lit = active ? Math.round(level * SEGMENTS) : 0;
  return (
    <div className="flex h-3 gap-[3px]" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level} aria-label="Audio level">
      {Array.from({length: SEGMENTS}, (_, i) => {
        const on = i < lit;
        const color = i >= SEGMENTS - 3 ? 'bg-red-500' : i >= SEGMENTS - 8 ? 'bg-amber-400' : 'bg-emerald-400';
        return <div key={i} className={`flex-1 rounded-[2px] transition-colors duration-75 ${on ? color : 'bg-neutral-800'}`} />;
      })}
    </div>
  );
}
