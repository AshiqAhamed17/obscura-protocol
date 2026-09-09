"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button className="btn primary" onClick={() => connect({ connector: injected })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <button className="btn" onClick={() => switchChain({ chainId: sepolia.id })}>
        Switch to Sepolia
      </button>
    );
  }

  const short = `${address!.slice(0, 6)}…${address!.slice(-4)}`;
  // deterministic identicon hue from the address, tinted within the cool range
  const hue = 200 + (parseInt(address!.slice(2, 6), 16) % 60);
  return (
    <button className="btn wallet-chip" onClick={() => disconnect()} title="Disconnect">
      <span className="wallet-dot" style={{ background: `hsl(${hue} 70% 70%)` }} />
      <span className="mono">{short}</span>
    </button>
  );
}
