// CLI: run the risk assessment over live data and print it. Useful for testing
// the gate and for CI, independent of any MCP client or LLM.
//
//   npm run assess              # combined protocol-risk report
//   npm run assess -- solvency  # solvency snapshot only
//   npm run assess -- concentration

import { concentrationReport, protocolRisk, solvencySnapshot } from "./report.js";

async function main() {
  const which = process.argv[2] ?? "risk";
  let out: unknown;
  switch (which) {
    case "solvency":
      out = await solvencySnapshot();
      break;
    case "concentration":
      out = await concentrationReport();
      break;
    case "risk":
      out = await protocolRisk();
      break;
    default:
      console.error(`Unknown report "${which}". Use: risk | solvency | concentration`);
      process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
