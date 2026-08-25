"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/deposit", label: "Deposit" },
  { href: "/claim", label: "Claim" },
  { href: "/solvency", label: "Solvency" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link className="logo" href="/">
          <span className="glyph" />
          Obscura
        </Link>
        <nav className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
              {l.label}
            </Link>
          ))}
          <a href="https://github.com/AshiqAhamed17/obscura-protocol" target="_blank" rel="noreferrer">
            GitHub&nbsp;↗
          </a>
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}
