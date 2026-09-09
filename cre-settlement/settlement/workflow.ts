import {
	cre,
	hexToBase64,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

// ─── Config Schema ──────────────────────────────────────────
// `positionsSecretId` names the Vault-DON secret holding the market's PRIVATE
// positions. `expectedPool` is the publicly-escrowed collateral the private
// positions must reconcile to (the solvency target). Both are the market's
// public parameters — only the positions themselves are confidential.
export const configSchema = z.object({
	schedule: z.string(),
	marketId: z.number().int().nonnegative(),
	numOutcomes: z.number().int().min(2),
	positionsSecretId: z.string(),
	expectedPool: z.string(), // decimal string of USDC base units (6-dec); string avoids float loss
})
type Config = z.infer<typeof configSchema>

// One private position: which outcome it backs and its stake, in USDC base units.
// The `side`/outcome is exactly what Obscura keeps shielded on-chain — here it is
// visible ONLY inside the enclave, and never crosses back out.
type Position = { outcome: number; amount: string }

// ─── The confidential aggregation, computed over private data ───────────────
// This is the heart of the "confidential + verifiable" story. It sums the
// per-outcome stake totals and checks the book is solvent (the private stakes
// reconcile to the public escrow) — all over data that must stay hidden from the
// node operators: individual bettors' sides and amounts. Leaking a single
// position would deanonymise a bettor and enable front-running.
//
// What is and is NOT confidential (see the CRE docs): the enclave protects the
// DATA this logic computes over — the Vault-DON `POSITIONS` secret and every
// intermediate value derived from it. The workflow binary, including this logic,
// is revealed to the DON; only the private positions stay inside the enclave.
//
// Kept deterministic (integer BigInt sums, order-independent) so the enclave
// result is reproducibly attested and verified by DON consensus. Deliberately
// light — no Poseidon / heavy crypto here; that stays in the SP1 proof, which is
// the *verifiability* half we keep alongside this *confidentiality* half.
type Aggregation = {
	outcomeTotals: bigint[] // per-outcome staked totals — the only thing that leaves
	totalPool: bigint
	solvent: boolean
}

export const aggregatePrivatePositions = (
	positions: Position[],
	numOutcomes: number,
	expectedPool: bigint,
): Aggregation => {
	const outcomeTotals: bigint[] = new Array(numOutcomes).fill(0n)
	let totalPool = 0n

	for (const p of positions) {
		if (!Number.isInteger(p.outcome) || p.outcome < 0 || p.outcome >= numOutcomes) {
			throw new Error(`position references outcome ${p.outcome} outside [0, ${numOutcomes})`)
		}
		const amount = BigInt(p.amount)
		if (amount <= 0n) throw new Error('position amount must be positive')
		outcomeTotals[p.outcome] += amount
		totalPool += amount
	}

	// Solvency: the private stakes must sum exactly to the collateral the contract
	// publicly escrowed. This is the invariant the on-chain settlement (and the
	// SP1 proof) also enforce — checked here confidentially over the raw positions.
	const solvent = totalPool === expectedPool

	return { outcomeTotals, totalPool, solvent }
}

// ─── TEE Cron Callback ──────────────────────────────────────
// Receives a `TeeRuntime`, not a `Runtime`. Everything here runs inside the
// enclave until we explicitly cross back with `usingTheDons()`.
export const onSettlementTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// ── Step 2: Fetch the PRIVATE positions inside the enclave ──
	// The Vault DON releases this secret only into an attested enclave, decrypted
	// at the moment `getSecret()` runs. It holds the market's raw positions — the
	// confidential input that must never reach node operators.
	const raw = runtime.getSecret({ id: config.positionsSecretId }).result().value
	const positions = JSON.parse(raw) as Position[]

	// ── Step 3: Aggregate + solvency-check, entirely in-enclave ──
	const expectedPool = BigInt(config.expectedPool)
	const { outcomeTotals, totalPool, solvent } = aggregatePrivatePositions(
		positions,
		config.numOutcomes,
		expectedPool,
	)

	// ⚠️ Simulation-only logging. Logs LEAVE the enclave, so we log ONLY the
	// aggregates and the count — never an individual position's side or amount.
	// This line must be stripped before any production deployment.
	runtime.log(
		`Enclave settled market ${config.marketId}: ${positions.length} private positions -> ` +
			`totals=[${outcomeTotals.join(', ')}], pool=${totalPool}, solvent=${solvent}`,
	)

	// ── Step 4: Cross back to the DON — only the AGGREGATES leave ──
	// `usingTheDons()` returns a regular `Runtime`; anything passed into a call on
	// it runs on Workflow DON nodes and is NO LONGER confidential. We cross over
	// the per-outcome totals + solvency flag ONLY — never a single raw position.
	const donRuntime = runtime.usingTheDons()

	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('uint64 marketId, uint256[] outcomeTotals, bool solvent'),
		[BigInt(config.marketId), outcomeTotals, solvent],
	)

	donRuntime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	// The DON-signed report carries only the aggregate settlement totals. On-chain,
	// the escrow still requires the SP1 proof to verify these totals are correct +
	// solvent before releasing funds — confidentiality (this enclave) AND
	// verifiability (SP1) together. To deliver on-chain, pass the report to
	// `evmClient.writeReport(donRuntime, report)` (Task 4.2).
	return `market ${config.marketId}: solvent=${solvent}, totals=[${outcomeTotals.join(', ')}]`
}

// ─── Workflow Init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		// ── Step 1: Register a TEE handler ──
		// `cre.handlerInTee` (not `cre.handler`). The third argument is the
		// `TeeConstraint`: AWS Nitro in us-west-2 is currently the only registered
		// TEE type and region.
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onSettlementTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
