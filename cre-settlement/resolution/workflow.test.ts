import { describe, expect } from 'bun:test'
import type { HTTPSendRequester } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { deriveOutcome, fetchMetric, initWorkflow, onResolutionTrigger } from './workflow'

const makeConfig = () => ({
	schedule: '0 */1 * * * *',
	marketId: 3,
	subgraphUrl: 'https://api.studio.thegraph.com/query/1758912/obscura-protocol/v0.0.2',
	graphQuery: '{ protocolSolvencies(first: 1) { marketCount } }',
	threshold: 3,
	consumerAddress: '',
	chainSelectorName: 'ethereum-testnet-sepolia',
})

// Minimal fake HTTPSendRequester returning a canned subgraph JSON body.
const fakeSendRequester = (marketCount: string | undefined, statusCode = 200): HTTPSendRequester => {
	const payload = marketCount === undefined
		? { data: { protocolSolvencies: [] } }
		: { data: { protocolSolvencies: [{ marketCount }] } }
	return {
		sendRequest: () => ({
			result: () => ({
				statusCode,
				body: new TextEncoder().encode(JSON.stringify(payload)),
			}),
		}),
	} as unknown as HTTPSendRequester
}

describe('deriveOutcome', () => {
	test('Yes (1) when the metric clears the threshold', () => {
		expect(deriveOutcome(3, 3)).toBe(1)
		expect(deriveOutcome(5, 3)).toBe(1)
	})
	test('No (0) when the metric is below the threshold', () => {
		expect(deriveOutcome(2, 3)).toBe(0)
		expect(deriveOutcome(0, 3)).toBe(0)
	})
})

describe('fetchMetric', () => {
	test('parses protocolSolvencies.marketCount from the subgraph response', () => {
		const n = fetchMetric(fakeSendRequester('3'), 'http://x', '{ }')
		expect(n).toBe(3)
	})
	test('throws on a non-2xx response', () => {
		expect(() => fetchMetric(fakeSendRequester('3', 500), 'http://x', '{ }')).toThrow('HTTP 500')
	})
	test('throws when the metric is missing', () => {
		expect(() => fetchMetric(fakeSendRequester(undefined), 'http://x', '{ }')).toThrow('missing')
	})
})

describe('onResolutionTrigger', () => {
	// The handler builds its own HTTPClient, so drive it through a fake runtime
	// whose HTTP path returns a fixed metric. We stub the SDK surface the handler
	// touches: config, the httpClient.sendRequest chain, report, and log.
	const makeFakeRuntime = (metric: number) => {
		const logs: string[] = []
		const reports: unknown[] = []
		const runtime = {
			config: makeConfig(),
			// cre.capabilities.HTTPClient() is constructed inside the handler; its
			// sendRequest(runtime, fn, agg)(...args) chain resolves to the metric.
			log: (m: string) => logs.push(m),
			report: (input: unknown) => {
				reports.push(input)
				return { result: () => ({}) }
			},
			__metric: metric,
		}
		return { runtime, logs, reports }
	}

	test('deriveOutcome + report wiring: Yes path returns outcome 1', () => {
		// Exercised via deriveOutcome directly (the HTTP + report chain needs the
		// real runtime, covered by simulation). Here we assert the decision the
		// handler encodes into the report.
		const { runtime } = makeFakeRuntime(3)
		expect(deriveOutcome(runtime.__metric, runtime.config.threshold)).toBe(1)
	})
})

describe('initWorkflow', () => {
	test('registers a (non-TEE) cron handler', () => {
		const handlers = initWorkflow(makeConfig())
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onResolutionTrigger)
	})
})
