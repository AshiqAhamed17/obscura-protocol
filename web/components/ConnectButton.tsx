"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { sepolia, arcTestnet } from "wagmi/chains";
import { CHAINS, contractsFor } from "@/lib/contract";

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

  const supported = chainId in CHAINS;
  if (!supported) {
    return (
      <button className="btn" onClick={() => switchChain({ chainId: sepolia.id })}>
        Switch to Sepolia
      </button>
    );
  }

  // toggle between the two supported networks
  const next = chainId === sepolia.id ? arcTestnet.id : sepolia.id;
  const netLabel = contractsFor(chainId).label;

  const short = `${address!.slice(0, 6)}…${address!.slice(-4)}`;
  const hue = 200 + (parseInt(address!.slice(2, 6), 16) % 60);
  return (
    <div className="wallet-cluster">
      <button
        className="btn net-chip"
        onClick={() => switchChain({ chainId: next })}
        title={`Switch to ${contractsFor(next).label}`}
      >
        <span className="net-dot" style={{ background: chainId === arcTestnet.id ? "#8fe6cb" : "hsl(210 70% 70%)" }} />
        <span className="mono">{netLabel}</span>
      </button>
      <button className="btn wallet-chip" onClick={() => disconnect()} title="Disconnect">
        <span className="wallet-dot" style={{ background: `hsl(${hue} 70% 70%)` }} />
        <span className="mono">{short}</span>
      </button>
    </div>
  );
}
