"use client";

import dynamic from "next/dynamic";

/// WebGL can't render on the server — load the scene client-only.
const DarkPoolScene = dynamic(() => import("./DarkPoolScene").then((m) => m.DarkPoolScene), {
  ssr: false,
});

export function DarkPoolMount() {
  return <DarkPoolScene />;
}
