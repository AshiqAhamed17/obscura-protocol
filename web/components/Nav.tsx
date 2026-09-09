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
  { href: "/deposit", label: "Deposit" },
  { href: "/claim", label: "Claim" },
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
          <a href="https://github.com/AshiqAhamed17/obscura-protocol" target="_blank" rel="noreferrer" className="nav-link">
            GitHub&nbsp;↗
          </a>
        </nav>

        <div className="nav-right">
          <PriceTicker />
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
      <span className="ticker-net">Sepolia</span>
      <span className="ticker-sep">·</span>
      <span className="ticker-px">{price === null ? "ETH —" : `ETH ${priceUsd(price, 0)}`}</span>
      <span className={`ticker-arrow ${trend}`} aria-hidden>
        {trend === "up" ? "▲" : trend === "down" ? "▼" : ""}
      </span>
    </div>
  );
}
