import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import {
  MarketCreated,
  Deposit as DepositEvent,
  MarketResolved,
  MarketSettled,
  Claimed,
} from "../generated/PredictionMarket/PredictionMarket"
import {
  Market,
  Deposit,
  Settlement,
  Claim,
  ProtocolSolvency,
} from "../generated/schema"

const PROTOCOL_ID = "protocol"

// Deterministic Bytes id from a numeric marketId (decimal string -> utf8 bytes).
function marketPk(marketId: BigInt): Bytes {
  return Bytes.fromUTF8(marketId.toString())
}

// Unique id for a log-scoped entity: txHash + logIndex.
function eventPk(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32())
}

function loadProtocol(): ProtocolSolvency {
  let p = ProtocolSolvency.load(Bytes.fromUTF8(PROTOCOL_ID))
  if (p == null) {
    p = new ProtocolSolvency(Bytes.fromUTF8(PROTOCOL_ID))
    p.marketCount = BigInt.zero()
    p.resolvedMarketCount = BigInt.zero()
    p.settledMarketCount = BigInt.zero()
    p.depositCount = BigInt.zero()
    p.claimCount = BigInt.zero()
    p.totalDeposited = BigInt.zero()
    p.totalClaimed = BigInt.zero()
    p.totalSettledYes = BigInt.zero()
    p.totalSettledNo = BigInt.zero()
    p.outstandingEscrow = BigInt.zero()
  }
  return p as ProtocolSolvency
}

function touchProtocol(p: ProtocolSolvency, event: ethereum.Event): void {
  p.outstandingEscrow = p.totalDeposited.minus(p.totalClaimed)
  p.lastUpdatedBlock = event.block.number
  p.lastUpdatedAt = event.block.timestamp
  p.save()
}

export function handleMarketCreated(event: MarketCreated): void {
  let market = new Market(marketPk(event.params.marketId))
  market.marketId = event.params.marketId
  market.priceFeed = event.params.priceFeed
  market.threshold = event.params.threshold
  market.resolveAfter = event.params.resolveAfter
  market.createdAt = event.block.timestamp
  market.createdAtBlock = event.block.number
  market.createdTx = event.transaction.hash
  market.status = "Open"
  market.depositCount = BigInt.zero()
  market.totalDeposited = BigInt.zero()
  market.claimCount = BigInt.zero()
  market.totalClaimed = BigInt.zero()
  market.save()

  let p = loadProtocol()
  p.marketCount = p.marketCount.plus(BigInt.fromI32(1))
  touchProtocol(p, event)
}

export function handleDeposit(event: DepositEvent): void {
  let deposit = new Deposit(eventPk(event))
  deposit.market = marketPk(event.params.marketId)
  deposit.commitment = event.params.commitment
  deposit.leafIndex = event.params.leafIndex
  deposit.amount = event.params.amount
  deposit.timestamp = event.block.timestamp
  deposit.blockNumber = event.block.number
  deposit.txHash = event.transaction.hash
  deposit.save()

  let market = Market.load(marketPk(event.params.marketId))
  if (market != null) {
    market.depositCount = market.depositCount.plus(BigInt.fromI32(1))
    market.totalDeposited = market.totalDeposited.plus(event.params.amount)
    market.save()
  }

  let p = loadProtocol()
  p.depositCount = p.depositCount.plus(BigInt.fromI32(1))
  p.totalDeposited = p.totalDeposited.plus(event.params.amount)
  touchProtocol(p, event)
}

export function handleMarketResolved(event: MarketResolved): void {
  let market = Market.load(marketPk(event.params.marketId))
  if (market == null) return
  market.winningSide = event.params.winningOutcome
  market.resolvedPrice = event.params.resolvedPrice
  market.resolvedAt = event.block.timestamp
  market.status = "Resolved"
  market.save()

  let p = loadProtocol()
  p.resolvedMarketCount = p.resolvedMarketCount.plus(BigInt.fromI32(1))
  touchProtocol(p, event)
}

export function handleMarketSettled(event: MarketSettled): void {
  // N-outcome contract: `outcomeTotals` is the full per-outcome array. For a
  // binary market it is [No, Yes]; totalNo/totalYes stay as convenient views.
  let totals: BigInt[] = event.params.outcomeTotals
  let totalNo: BigInt = totals.length > 0 ? totals[0] : BigInt.zero()
  let totalYes: BigInt = totals.length > 1 ? totals[1] : BigInt.zero()

  let settlement = new Settlement(marketPk(event.params.marketId))
  settlement.market = marketPk(event.params.marketId)
  settlement.merkleRoot = event.params.merkleRoot
  settlement.totalYes = totalYes
  settlement.totalNo = totalNo
  settlement.outcomeTotals = totals
  settlement.timestamp = event.block.timestamp
  settlement.blockNumber = event.block.number
  settlement.txHash = event.transaction.hash
  settlement.save()

  let market = Market.load(marketPk(event.params.marketId))
  if (market != null) {
    market.merkleRoot = event.params.merkleRoot
    market.totalYes = totalYes
    market.totalNo = totalNo
    market.outcomeTotals = totals
    market.settledAt = event.block.timestamp
    market.status = "Settled"
    market.save()
  }

  let p = loadProtocol()
  p.settledMarketCount = p.settledMarketCount.plus(BigInt.fromI32(1))
  p.totalSettledYes = p.totalSettledYes.plus(totalYes)
  p.totalSettledNo = p.totalSettledNo.plus(totalNo)
  touchProtocol(p, event)
}

export function handleClaimed(event: Claimed): void {
  let claim = new Claim(eventPk(event))
  claim.market = marketPk(event.params.marketId)
  claim.nullifier = event.params.nullifier
  claim.recipient = event.params.recipient
  claim.payout = event.params.payout
  claim.timestamp = event.block.timestamp
  claim.blockNumber = event.block.number
  claim.txHash = event.transaction.hash
  claim.save()

  let market = Market.load(marketPk(event.params.marketId))
  if (market != null) {
    market.claimCount = market.claimCount.plus(BigInt.fromI32(1))
    market.totalClaimed = market.totalClaimed.plus(event.params.payout)
    market.save()
  }

  let p = loadProtocol()
  p.claimCount = p.claimCount.plus(BigInt.fromI32(1))
  p.totalClaimed = p.totalClaimed.plus(event.params.payout)
  touchProtocol(p, event)
}
