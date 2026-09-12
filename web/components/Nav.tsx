"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ConnectButton } from "./ConnectButton";
import { useEthPrice } from "@/hooks/useEthPrice";
import { priceUsd } from "@/lib/format";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/parlays", label: "Parlays" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/reputation", label: "Reputation" },
  { href: "/risk", label: "Risk" },
  { href: "/solvency", label: "Solvency" },
];

export function Nav() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // close the mobile sheet on route change
  useEffect(() => setOpen(false), [path]);

  return (
    <header className={`nav ${scrolled ? "scrolled" : ""}`}>
      <div className="wrap nav-inner">
        <Link className="logo" href="/">
          <span className="glyph" />
          Obscura
        </Link>

        <nav className="nav-links">
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link key={l.href} href={l.href} className={`nav-link ${active ? "active" : ""}`}>
                {l.label}
                {active && <motion.span layoutId="nav-underline" className="nav-underline" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
              </Link>
            );
          })}
        </nav>

        <div className="nav-right">
          <PriceTicker />
          <a href="https://github.com/AshiqAhamed17/obscura-protocol" target="_blank" rel="noreferrer" className="nav-gh" title="View source on GitHub" aria-label="GitHub">
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <ConnectButton />
          <button
            className="nav-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className={open ? "x" : ""} />
            <span className={open ? "x" : ""} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="nav-sheet"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
                {l.label}
              </Link>
            ))}
            <a href="https://github.com/AshiqAhamed17/obscura-protocol" target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/// Compact live ETH/USD chip from the canonical Sepolia feed — makes the whole
/// app feel wired to the same oracle that resolves markets.
function PriceTicker() {
  const { price, trend } = useEthPrice();
  return (
    <div className="ticker mono" title="Chainlink ETH/USD · Sepolia">
      <span className="beat" />
      <span className="ticker-px">{price === null ? "ETH —" : `ETH ${priceUsd(price, 0)}`}</span>
      <span className={`ticker-arrow ${trend}`} aria-hidden>
        {trend === "up" ? "▲" : trend === "down" ? "▼" : ""}
      </span>
    </div>
  );
}
