"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

/// WebGL can't render on the server — load the scene client-only.
const DarkPoolScene = dynamic(() => import("./DarkPoolScene").then((m) => m.DarkPoolScene), {
  ssr: false,
});

export function DarkPoolMount() {
  const wrap = useRef<HTMLDivElement>(null);

  // Fade (and eventually hide) the whole 3D layer once scrolled past the hero,
  // so the expanded particles never float over the content sections below.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onScroll = () => {
      const vh = window.innerHeight;
      const fade = Math.max(0, Math.min(1, 1 - (window.scrollY - vh * 0.35) / (vh * 0.5)));
      el.style.opacity = String(fade);
      el.style.display = fade <= 0.01 ? "none" : "block";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={wrap} className="darkpool-wrap" aria-hidden>
      <DarkPoolScene />
    </div>
  );
}
