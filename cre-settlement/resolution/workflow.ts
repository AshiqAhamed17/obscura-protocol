import {
	bytesToBase64,
	bytesToHex,
	consensusMedianAggregation,
	cre,
	getNetwork,
	hexToBase64,
	type HTTPSendRequester,
	json,
	ok,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

// ─── Config Schema ──────────────────────────────────────────
// Resolves a GraphQuery-sourced Obscura market from a live subgraph metric.
// This completes the resolution-source trio (ChainlinkFeed · GraphQuery ·
// CreWorkflow): the CRE workflow reads the subgraph, derives the winning
// outcome, and the DON delivers a signed report to `CreResolutionConsumer`,
// which calls `PredictionMarket.reportResolution` on-chain.
export const configSchema = z.object({
	schedule: z.string(),
	marketId: z.number().int().nonnegative(),
	subgraphUrl: z.string(),
	// GraphQL query returning `protocolSolvencies(first:1){ marketCount }`.
	graphQuery: z.string(),
	// The market resolves to outcome 1 (Yes) when the metric ≥ threshold, else 0.
	threshold: z.number().int().nonnegative(),
	consumerAddress: z.string().optional().default(''),
	chainSelectorName: z.string().optional().default('ethereum-testnet-sepolia'),
})
type Config = z.infer<typeof configSchema>

// The winning outcome for a Graph-resolved market: Yes (1) when the live metric
// clears the threshold, No (0) otherwise. Pure + deterministic.
export const deriveOutcome = (metric: number, threshold: number): number =>
	metric >= threshold ? 1 : 0

// Runs on each DON node; results are aggregated by consensus. Returns the
// subgraph metric as a single number so a whole-value median aggregator suffices
// (robust to a node seeing the subgraph one block ahead of another).
export const fetchMetric = (sendRequester: HTTPSendRequester, url: string, query: string): number => {
	const body = bytesToBase64(new TextEncoder().encode(JSON.stringify({ query })))
	const response = sendRequester
		.sendRequest({
			url,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			cacheSettings: { store: false },
		})
		.result()

	if (!ok(response)) {
		throw new Error(`subgraph query failed: HTTP ${response.statusCode}`)
	}

	const parsed = json(response) as {
		data?: { protocolSolvencies?: Array<{ marketCount?: string }> }
	}
	const metric = parsed?.data?.protocolSolvencies?.[0]?.marketCount
	if (metric === undefined) throw new Error('subgraph response missing protocolSolvencies.marketCount')
	return Number(metric)
}

export const onResolutionTrigger = (runtime: Runtime<Config>): string => {
	const config = runtime.config
	const httpClient = new cre.capabilities.HTTPClient()

	// ── Read the live Graph metric under DON consensus ──
	const metric = httpClient
		.sendRequest(runtime, fetchMetric, consensusMedianAggregation<number>())(
			config.subgraphUrl,
			config.graphQuery,
		)
		.result()

	// ── Derive the winning outcome from the metric ──
	const winningOutcome = deriveOutcome(metric, config.threshold)
	runtime.log(`Graph metric=${metric}, threshold=${config.threshold} -> outcome=${winningOutcome}`)

	// ── Deliver a DON-signed resolution report on-chain ──
	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('uint64 marketId, uint8 winningOutcome'),
		[BigInt(config.marketId), winningOutcome],
	)

	const signedReport = runtime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	let txHash = ''
	if (config.consumerAddress !== '') {
		const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName })
		if (!network) throw new Error(`unknown chain selector: ${config.chainSelectorName}`)

		const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
		const tx = evmClient
			.writeReport(runtime, {
				receiver: config.consumerAddress as Address,
				report: signedReport,
				gasConfig: { gasLimit: '500000' },
			})
			.result()

		if (tx.txStatus !== TxStatus.SUCCESS) {
			throw new Error(`on-chain resolution write failed: status=${tx.txStatus}`)
		}
		txHash = bytesToHex(tx.txHash ?? new Uint8Array())
	}

	const delivered = txHash !== '' ? `, tx=${txHash}` : ''
	return `market ${config.marketId}: metric=${metric} -> outcome=${winningOutcome}${delivered}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [cre.handler(cronTrigger.trigger({ schedule: config.schedule }), onResolutionTrigger)]
}
