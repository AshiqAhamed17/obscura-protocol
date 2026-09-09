// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PredictionMarket} from "./PredictionMarket.sol";

/// @notice Minimal interface to the generated parlay UltraHonk verifier
///         (`contracts/src/verifiers/ParlayVerifier.sol`).
interface IParlayVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @notice Minimal ERC-20 surface for USDC collateral.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ParlayPool — shielded multi-leg parlays (Private Parlays).
/// @notice A dedicated pool for **parlay** positions: one private note stakes on
///         N legs at once and wins only if EVERY leg resolves to its committed
///         outcome. Deposits publish only a Poseidon commitment; a claim proves,
///         in zero knowledge, that the parlay note is in this pool's tree and
///         that every leg backed the outcome its market actually resolved to —
///         revealing only the combined payout and one nullifier, never the
///         individual legs or which deposit it was.
///
/// @dev Legs settle in the canonical `PredictionMarket`: each leg market must be
///      `Settled` (its winning outcome + pari-mutuel totals final) before a
///      parlay over it can be claimed. Payout is the product of the per-leg
///      pari-mutuel ratios applied to the stake, **capped at the pool's balance**
///      — a parlay's product-of-ratios can exceed a flat pari-mutuel pool, so the
///      cap keeps the pool solvent (documented tradeoff; a fuller design would
///      pre-fund parlay liability).
///
///      The parlay commitments root (`parlayRoot`) is delivered by a `settler`
///      — in production the SP1/DON forwarder that proves the root was computed
///      from this pool's leaves, mirroring the market's SP1-settled root. The
///      pool has no owner.
contract ParlayPool {
    uint256 internal constant PARLAY_LEGS = 3;

    /// BN254 scalar field modulus — every valid Poseidon commitment is below it.
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IParlayVerifier public immutable verifier;
    IERC20 public immutable collateral;
    PredictionMarket public immutable market;
    /// Authorized to set the parlay commitments root (prod: SP1/DON forwarder).
    address public immutable settler;

    /// Commitments tree root for the parlay pool, set by the settler.
    bytes32 public parlayRoot;
    /// Total staked into the pool (USDC base units).
    uint256 public totalStaked;
    uint256 public depositCount;

    bytes32[] internal _commitments;
    mapping(bytes32 commitment => bool seen) public commitmentSeen;
    mapping(bytes32 nullifier => bool spent) public nullifierSpent;

    event ParlayDeposit(bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event ParlayRootSet(bytes32 root);
    event ParlayClaimed(bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    error ZeroAmount();
    error ZeroAddress();
    error CommitmentOutOfField();
    error CommitmentAlreadyUsed();
    error NotSettler();
    error RootNotSet();
    error NullifierAlreadySpent();
    error LegNotSettled();
    error InvalidProof();
    error NoWinningStake();
    error TransferFailed();

    constructor(address verifier_, address collateral_, address market_, address settler_) {
        if (collateral_ == address(0) || market_ == address(0) || settler_ == address(0)) revert ZeroAddress();
        verifier = IParlayVerifier(verifier_);
        collateral = IERC20(collateral_);
        market = PredictionMarket(market_);
        settler = settler_;
    }

    /// @notice Stakes a parlay: escrows `amount` USDC and appends the parlay note
    ///         `commitment` as the next leaf of the pool's commitments tree.
    function deposit(bytes32 commitment, uint256 amount) external returns (uint256 leafIndex) {
        if (amount == 0) revert ZeroAmount();
        if (uint256(commitment) >= FIELD_MODULUS) revert CommitmentOutOfField();
        if (commitmentSeen[commitment]) revert CommitmentAlreadyUsed();

        commitmentSeen[commitment] = true;
        leafIndex = depositCount;
        _commitments.push(commitment);
        depositCount = leafIndex + 1;
        totalStaked += amount;

        _safeTransferFrom(msg.sender, address(this), amount);
        emit ParlayDeposit(commitment, leafIndex, amount);
    }

    /// @notice Sets the parlay commitments root. Only the settler (prod: the
    ///         SP1/DON forwarder that proves the root from this pool's leaves).
    function setParlayRoot(bytes32 root) external {
        if (msg.sender != settler) revert NotSettler();
        parlayRoot = root;
        emit ParlayRootSet(root);
    }

    /// @notice Claims a winning parlay in zero knowledge. The proof establishes
    ///         that an unspent parlay note in this pool's tree picked, on every
    ///         leg, the outcome that leg's market resolved to. Pays the product
    ///         of the per-leg pari-mutuel ratios (capped at the pool balance).
    /// @param marketIds The parlay's leg markets (public inputs to the proof).
    /// @param amount    The parlay stake (public input; drives the payout).
    /// @param nullifier Parlay nullifier, revealed and marked spent here.
    /// @param recipient Payout address, bound into the proof (front-run safe).
    /// @param proof     UltraHonk proof for the parlay circuit.
    function claim(
        uint256[PARLAY_LEGS] calldata marketIds,
        uint256 amount,
        bytes32 nullifier,
        address recipient,
        bytes calldata proof
    ) external {
        if (parlayRoot == bytes32(0)) revert RootNotSet();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();

        // Gather each leg's resolved winning outcome from the canonical market;
        // every leg must be Settled (final totals) to claim.
        uint8[PARLAY_LEGS] memory winningOutcomes;
        for (uint256 i = 0; i < PARLAY_LEGS; i++) {
            (,,,, PredictionMarket.Status status, uint8 winningOutcome,,,,) = market.markets(marketIds[i]);
            if (status != PredictionMarket.Status.Settled) revert LegNotSettled();
            winningOutcomes[i] = winningOutcome;
        }

        // Public inputs, in the exact order the parlay circuit declares them.
        bytes32[] memory publicInputs = new bytes32[](10);
        publicInputs[0] = parlayRoot;
        publicInputs[1] = bytes32(marketIds[0]);
        publicInputs[2] = bytes32(marketIds[1]);
        publicInputs[3] = bytes32(marketIds[2]);
        publicInputs[4] = bytes32(uint256(winningOutcomes[0]));
        publicInputs[5] = bytes32(uint256(winningOutcomes[1]));
        publicInputs[6] = bytes32(uint256(winningOutcomes[2]));
        publicInputs[7] = bytes32(amount);
        publicInputs[8] = nullifier;
        publicInputs[9] = bytes32(uint256(uint160(recipient)));

        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        // Effects before interaction.
        nullifierSpent[nullifier] = true;

        uint256 payout = _parlayPayout(marketIds, winningOutcomes, amount);

        emit ParlayClaimed(nullifier, recipient, payout);
        _safeTransfer(recipient, payout);
    }

    /// @dev payout = amount × Π (leg totalPool / leg winningOutcomeTotal), each
    ///      leg's pari-mutuel multiplier applied in turn (integer division), then
    ///      capped at the pool's USDC balance so the pool always stays solvent.
    function _parlayPayout(
        uint256[PARLAY_LEGS] calldata marketIds,
        uint8[PARLAY_LEGS] memory winningOutcomes,
        uint256 amount
    ) internal view returns (uint256 payout) {
        payout = amount;
        for (uint256 i = 0; i < PARLAY_LEGS; i++) {
            (,,,,,,, uint256 legTotalPool,,) = market.markets(marketIds[i]);
            uint256 winningTotal = market.getOutcomeTotals(marketIds[i])[winningOutcomes[i]];
            if (winningTotal == 0) revert NoWinningStake();
            payout = (payout * legTotalPool) / winningTotal;
        }
        uint256 balance = collateral.balanceOf(address(this));
        if (payout > balance) payout = balance; // solvency cap
    }

    /// @notice All parlay commitments (leaves), in insertion order.
    function getCommitments() external view returns (bytes32[] memory) {
        return _commitments;
    }

    // --- ERC-20 safe-transfer helpers (SafeERC20-style, self-contained) ---

    function _safeTransfer(address to, uint256 amount) internal {
        _callOptionalReturn(abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        _callOptionalReturn(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    function _callOptionalReturn(bytes memory data) private {
        (bool success, bytes memory returndata) = address(collateral).call(data);
        if (!success || (returndata.length != 0 && !abi.decode(returndata, (bool)))) {
            revert TransferFailed();
        }
    }
}
