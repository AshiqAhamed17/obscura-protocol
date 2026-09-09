import { http, createConfig } from "wagmi";
import { sepolia, arcTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/// wagmi config — Ethereum Sepolia + Circle's Arc testnet (USDC-native gas).
/// Injected (MetaMask/Rabby/etc.) wallet.
export const config = createConfig({
  chains: [sepolia, arcTestnet],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
