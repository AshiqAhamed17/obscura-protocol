import { describe, expect } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { aggregatePrivatePositions, initWorkflow, onSettlementTrigger } from './workflow'

const makeConfig = () => ({
	schedule: '0 */1 * * * *',
	marketId: 0,
	numOutcomes: 2,
	positionsSecretId: 'POSITIONS',
	expectedPool: '6000000',
	// Empty consumerAddress -> the handler stops at the DON report (no on-chain
	// write), so the unit tests exercise the confidential aggregation in isolation.
	consumerAddress: '',
	chainSelectorName: 'ethereum-testnet-sepolia',
})

// A binary market's private positions that sum to the 6,000,000 expected pool:
// outcome 0 gets 1,000,000; outcome 1 gets 2,000,000 + 3,000,000 = 5,000,000.
const SOLVENT_POSITIONS = JSON.stringify([
	{ outcome: 0, amount: '1000000' },
	{ outcome: 1, amount: '2000000' },
	{ outcome: 1, amount: '3000000' },
])

// The public test surface does not ship a TEE runtime factory, so we stand up the
// slice of `TeeRuntime` the handler uses: config, getSecret, log, usingTheDons.
const makeFakeTeeRuntime = (positionsJson: string = SOLVENT_POSITIONS) => {
	const reports: unknown[] = []
	const logs: string[] = []
	const secretReads: string[] = []

	const runtime = {
		config: makeConfig(),
		getSecret: (request: { id?: string }) => {
			secretReads.push(request.id ?? '')
			return { result: () => ({ id: request.id, value: positionsJson }) }
		},
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: (input: unknown) => {
				reports.push(input)
				return { result: () => ({}) }
			},
		}),
	}

	return {
		runtime: runtime as unknown as TeeRuntime<ReturnType<typeof makeConfig>>,
		reports,
		logs,
		secretReads,
	}
}

// ─── Pure aggregation (the confidential math) ───────────────
describe('aggregatePrivatePositions', () => {
	test('sums stake per outcome and the total pool', () => {
		const positions = [
			{ outcome: 0, amount: '1000000' },
			{ outcome: 1, amount: '2000000' },
			{ outcome: 1, amount: '3000000' },
		]
		const agg = aggregatePrivatePositions(positions, 2, 6000000n)
		expect(agg.outcomeTotals).toEqual([1000000n, 5000000n])
		expect(agg.totalPool).toBe(6000000n)
		expect(agg.solvent).toBe(true)
	})

	test('flags INSOLVENT when private stakes do not reconcile to the escrow', () => {
		const positions = [
			{ outcome: 0, amount: '1000000' },
			{ outcome: 1, amount: '2000000' },
		]
		// stakes sum to 3,000,000 but the contract escrowed 6,000,000
		const agg = aggregatePrivatePositions(positions, 2, 6000000n)
		expect(agg.totalPool).toBe(3000000n)
		expect(agg.solvent).toBe(false)
	})

	test('supports categorical (N-outcome) markets', () => {
		const positions = [
			{ outcome: 0, amount: '1000000' },
			{ outcome: 1, amount: '2000000' },
			{ outcome: 2, amount: '3000000' },
		]
		const agg = aggregatePrivatePositions(positions, 3, 6000000n)
		expect(agg.outcomeTotals).toEqual([1000000n, 2000000n, 3000000n])
		expect(agg.solvent).toBe(true)
	})

	test('rejects an out-of-range outcome index', () => {
		expect(() => aggregatePrivatePositions([{ outcome: 2, amount: '1' }], 2, 1n)).toThrow(
			'outside [0, 2)',
		)
	})

	test('rejects a non-positive amount', () => {
		expect(() => aggregatePrivatePositions([{ outcome: 0, amount: '0' }], 2, 0n)).toThrow(
			'must be positive',
		)
	})
})

// ─── TEE handler ────────────────────────────────────────────
describe('onSettlementTrigger', () => {
	test('fetches the private positions from the enclave secret', () => {
		const { runtime, secretReads } = makeFakeTeeRuntime()
		onSettlementTrigger(runtime)
		expect(secretReads).toEqual(['POSITIONS'])
	})

	test('crosses back to the DON with an evm report of the aggregates', () => {
		const { runtime, reports } = makeFakeTeeRuntime()
		onSettlementTrigger(runtime)
		expect(reports).toHaveLength(1)
		expect(reports[0]).toMatchObject({
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
	})

	test('returns the solvent verdict and per-outcome totals', () => {
		const { runtime } = makeFakeTeeRuntime()
		expect(onSettlementTrigger(runtime)).toBe('market 0: solvent=true, totals=[1000000, 5000000]')
	})

	test('reports INSOLVENT when the private stakes do not reconcile', () => {
		const positions = JSON.stringify([{ outcome: 0, amount: '1000000' }])
		const { runtime } = makeFakeTeeRuntime(positions)
		expect(onSettlementTrigger(runtime)).toContain('solvent=false')
	})

	// The core confidentiality guarantee: nothing that leaves the enclave — not the
	// logs, not the crossover return value — may reveal an individual position.
	test('only aggregates leave the enclave: no single position is exposed', () => {
		// Give one position a UNIQUE amount that appears in NO aggregate total, so
		// if it leaked we would see it. totals become [1234567, 4765433]; the raw
		// "3530866" second stake must never surface.
		const positions = JSON.stringify([
			{ outcome: 0, amount: '1234567' },
			{ outcome: 1, amount: '3530866' },
			{ outcome: 1, amount: '1234567' },
		])
		const { runtime, logs } = makeFakeTeeRuntime(positions)
		const result = onSettlementTrigger(runtime)

		// The individual second-outcome stake never appears in anything that left.
		expect(result).not.toContain('3530866')
		for (const line of logs) expect(line).not.toContain('3530866')
		// Only the aggregate outcome total does.
		expect(result).toContain('4765433')
	})
})

describe('initWorkflow', () => {
	test('registers the settlement handler with a Nitro TEE constraint', () => {
		const handlers = initWorkflow(makeConfig())
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onSettlementTrigger)
		// handlerInTee attaches TEE requirements; cre.handler does not.
		expect(handlers[0].requirements).toBeDefined()
	})
})
