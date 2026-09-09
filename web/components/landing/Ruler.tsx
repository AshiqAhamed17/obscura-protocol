export function Ruler() {
  return (
    <div className="wrap">
      <div className="ruler" aria-hidden>
        {Array.from({ length: 90 }, (_, i) => (
          <i key={i} className={i % 10 === 0 ? "tall" : ""} />
        ))}
      </div>
    </div>
  );
}
