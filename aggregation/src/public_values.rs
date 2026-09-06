//! ABI-encoded public values for on-chain consumption.
//!
//! The SP1 guest commits the batch settlement result ABI-encoded (rather than
//! serde), so the settlement contract can `abi.decode` it directly. The Solidity
//! mirror of `SettlementValues` lives in `contracts/src/PredictionMarket.sol`
//! and must match this layout exactly.

use crate::MarketSettlement;
use alloy_sol_types::{sol, SolValue};

sol! {
    /// One market's proven settlement, as decoded on-chain.
    struct SettlementValues {
        uint64 marketId;
        uint64 totalYes;
        uint64 totalNo;
        bytes32 merkleRoot;
    }
}

impl From<&MarketSettlement> for SettlementValues {
    fn from(s: &MarketSettlement) -> Self {
        SettlementValues {
            marketId: s.market_id,
            totalYes: s.total_yes,
            totalNo: s.total_no,
            merkleRoot: s.merkle_root.into(),
        }
    }
}

/// ABI-encodes a batch of settlements as a `SettlementValues[]` — the exact
/// bytes committed by the guest and decoded by the contract.
pub fn encode(settlements: &[MarketSettlement]) -> Vec<u8> {
    let values: Vec<SettlementValues> = settlements.iter().map(SettlementValues::from).collect();
    values.abi_encode()
}

/// Decodes `SettlementValues[]` produced by [`encode`] back into
/// [`MarketSettlement`]s (used by the host to cross-check the guest output).
pub fn decode(bytes: &[u8]) -> Vec<MarketSettlement> {
    let values = <Vec<SettlementValues>>::abi_decode(bytes).expect("decode settlement values");
    values
        .into_iter()
        .map(|v| MarketSettlement {
            market_id: v.marketId,
            total_yes: v.totalYes,
            total_no: v.totalNo,
            merkle_root: v.merkleRoot.into(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MarketSettlement;

    #[test]
    fn encode_decode_roundtrip() {
        let settlements = vec![
            MarketSettlement { market_id: 0, total_yes: 100, total_no: 0, merkle_root: [1u8; 32] },
            MarketSettlement { market_id: 1, total_yes: 300, total_no: 200, merkle_root: [2u8; 32] },
        ];
        let bytes = encode(&settlements);
        assert_eq!(decode(&bytes), settlements);
    }

    #[test]
    fn empty_batch_roundtrips() {
        let empty: Vec<MarketSettlement> = vec![];
        assert_eq!(decode(&encode(&empty)), empty);
    }
}
