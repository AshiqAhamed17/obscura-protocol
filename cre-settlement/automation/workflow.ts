import {
	bytesToHex,
	cre,
	getNetwork,
	hexToBase64,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

// ─── Config Schema ──────────────────────────────────────────
// CRE cron automation — the successor to classic Chainlink Automation (sunset
// in 2026). On a schedule, the DON delivers a signed report to the on-chain
// `AutoResolver`, whose `onReport` runs `resolveDue()` — resolving every
// Chainlink-feed market that has passed its deadline. This replaces the classic
// custom-logic upkeep (checkUpkeep/performUpkeep) with a CRE workflow.
export const configSchema = z.object({
	schedule: z.string(),
	autoResolver: z.string(),
	chainSelectorName: z.string().optional().default('ethereum-testnet-sepolia'),
})
type Config = z.infer<typeof configSchema>

export const onCronTrigger = (runtime: Runtime<Config>): string => {
	const config = runtime.config
	runtime.log('AutoResolver cron: sweeping for due Chainlink-feed markets')

	// The payload is intentionally a no-op marker: `resolveDue()` is
	// permissionless and self-validating (it re-checks each market's status,
	// deadline, and feed freshness on-chain), so the report only needs to trigger
	// the sweep, not carry data.
	const encodedPayload = encodeAbiParameters(parseAbiParameters('uint256 marker'), [1n])

	const signedReport = runtime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName })
	if (!network) throw new Error(`unknown chain selector: ${config.chainSelectorName}`)

	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const tx = evmClient
		.writeReport(runtime, {
			receiver: config.autoResolver as Address,
			report: signedReport,
			gasConfig: { gasLimit: '800000' },
		})
		.result()

	if (tx.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`AutoResolver sweep write failed: status=${tx.txStatus}`)
	}

	return `AutoResolver swept due markets, tx=${bytesToHex(tx.txHash ?? new Uint8Array())}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [cre.handler(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger)]
}
