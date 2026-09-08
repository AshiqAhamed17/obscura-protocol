// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Minimal interface to the generated UltraHonk verifier
///         (`contracts/src/verifiers/HonkVerifier.sol`).
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @notice SP1 on-chain verifier interface (SP1VerifierGateway). Reverts if the
///         proof is invalid.
interface ISP1Verifier {
    function verifyProof(bytes32 programVKey, bytes calldata publicValues, bytes calldata proofBytes)
        external
        view;
}

/// @notice Minimal ERC-20 surface used for USDC collateral. USDC returns a bool
///         on transfer/transferFrom; `_callOptionalReturn` also tolerates
///         non-standard tokens that return nothing.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice EIP-2612 permit (USDC implements it) — lets a depositor approve the
///         escrow with a signature instead of a separate `approve` transaction.
interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title PredictionMarket (Milestone 1 — private positions & verified claims)
/// @notice Price-threshold prediction markets resolved by a Chainlink Price
///         Feed. Positions are private: a deposit escrows collateral and
///         records only a Poseidon note *commitment* (the Yes/No side is
///         hidden). After resolution, anyone can settle a batch of markets by
///         submitting an SP1 proof (`settleWithProof`) that attests the
///         per-side totals and commitments-tree root were correctly computed
///         from each market's notes — no trusted operator. Winners then claim
///         with a zk-SNARK proof, unlinkably to their deposit, and the payout
///         recipient is bound into the proof so a claim cannot be front-run.
///
/// @dev Trust model:
///      - Settlement totals and the commitments root are established by the SP1
///        batch-settlement proof, not by any privileged party. The full leaf
///        set is also stored on-chain as an immutable anchor, and settlement
///        still enforces totalYes + totalNo == totalPool as defense in depth.
///      - The consistency between a note's committed `amount` and the escrowed
///        collateral `amount` cannot be checked on-chain (the amount is inside
///        the commitment); it is enforced by the SP1 solvency proof (sum of note
///        amounts == totalPool).
///
/// @dev Collateral is an ERC-20 (USDC). All amounts are the token's base units
///      (USDC = 6 decimals). The Noir/SP1 `amount` is a generic u64, so USDC
///      base units drop in unchanged — the crypto core is token-agnostic.
contract PredictionMarket {
    // Outcomes are indices: a market has `numOutcomes` buckets and a bet backs
    // one of them. Binary markets use the convention 0 = No, 1 = Yes (matching
    // the claim circuit's `winning_outcome` public input); categorical markets
    // (e.g. "which driver wins") use 0..numOutcomes. The whole pool is split
    // pari-mutuel among the notes that backed the winning outcome.
    uint8 internal constant OUTCOME_NO = 0;
    uint8 internal constant OUTCOME_YES = 1;

    enum Status {
        Open,
        Resolved,
        Settled
    }

    /// How a market's outcome is determined. This is the resolution-source
    /// abstraction: one market contract, many kinds of markets.
    /// - `ChainlinkFeed`  — resolved trustlessly on-chain by reading a
    ///                       Chainlink price feed (`resolveMarket`).
    /// - `GraphQuery`     — resolved from an on-chain metric indexed by a
    ///                       subgraph (e.g. "protocol TVL > $X"), reported by
    ///                       the market's registered resolver (`reportResolution`).
    /// - `CreWorkflow`    — resolved from an off-chain event (sports, weather,
    ///                       an API) by a Chainlink CRE workflow, reported by
    ///                       the market's registered resolver.
    /// For the two non-feed sources the outcome cannot be read on-chain, so it
    /// is delivered by the `resolver` address named at creation — in practice
    /// the Chainlink DON / CRE forwarder that posts a signed report. Resolution
    /// trust for those markets is therefore the DON + the pinned off-chain
    /// source (`sourceRef`), never a global admin: this contract has no owner.
    enum ResolutionSource {
        ChainlinkFeed,
        GraphQuery,
        CreWorkflow
    }

    /// Resolution metadata, stored parallel to `Market` so the `markets()`
    /// getter tuple is unchanged. For `ChainlinkFeed` markets `resolver` and
    /// `sourceRef` are unused (the feed lives in `Market.priceFeed`).
    struct ResolutionConfig {
        ResolutionSource source;
        address resolver; // authorized reporter for non-feed sources
        bytes32 sourceRef; // pinned subgraph-deployment / workflow id (provenance)
    }

    /// One market's proven settlement, ABI-decoded from an SP1 proof's public
    /// values. Layout must match `aggregation::public_values::SettlementValues`.
    /// `outcomeTotals` has one entry per market outcome (length 2 for binary).
    struct SettlementValues {
        uint64 marketId;
        uint64[] outcomeTotals;
        bytes32 merkleRoot;
    }

    struct Market {
        AggregatorV3Interface priceFeed;
        int256 threshold;
        uint256 resolveAfter;
        uint256 maxPriceStaleness;
        Status status;
        uint8 winningOutcome; // resolved winning outcome index, set at resolve
        uint8 numOutcomes; // number of outcome buckets (2 for binary)
        uint256 totalPool; // total escrowed collateral across all deposits
        uint256 depositCount; // number of commitments = next leaf index
        bytes32 merkleRoot; // commitments-tree root, set at settle
    }

    /// BN254 scalar field modulus. Commitments are Poseidon outputs over this
    /// field, so any valid commitment is strictly less than this value.
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IHonkVerifier public immutable verifier;
    ISP1Verifier public immutable sp1Verifier;
    /// Verifying-key hash of the batch-settlement SP1 program.
    bytes32 public immutable programVKey;
    /// ERC-20 collateral token (USDC). Deposits pull it in; payouts send it out.
    /// Parameterized at construction so the same contract serves any chain's
    /// canonical USDC (Sepolia, Arc testnet `0x3600…0000`, mainnet, …).
    IERC20 public immutable collateral;

    uint256 public marketCount;
    mapping(uint256 marketId => Market) public markets;

    /// Per-outcome staked totals, set at settlement (length == numOutcomes).
    /// Stored outside the Market struct so the `markets()` getter stays a flat
    /// tuple; read via `getOutcomeTotals`.
    mapping(uint256 marketId => uint256[] outcomeTotals) internal _outcomeTotals;

    /// How each market resolves (parallel to `markets` to keep that getter's
    /// tuple stable). Defaults to `ChainlinkFeed` for markets made via the
    /// original `createMarket`.
    mapping(uint256 marketId => ResolutionConfig) public resolutionConfig;

    /// Leaves of each market's commitments tree, in insertion order. Public so
    /// anyone can reconstruct the tree/root off-chain and check the operator's
    /// (M1) or SP1's (M2) reported root against it.
    mapping(uint256 marketId => bytes32[] commitments) internal _commitments;

    /// Guards against inserting the same commitment twice into a market.
    mapping(uint256 marketId => mapping(bytes32 commitment => bool seen)) public commitmentSeen;

    /// Spent nullifiers. A note's nullifier binds its market_id, so a single
    /// global registry cannot collide across markets.
    mapping(bytes32 nullifier => bool spent) public nullifierSpent;

    event MarketCreated(uint256 indexed marketId, address priceFeed, int256 threshold, uint256 resolveAfter);
    event MarketSourceSet(
        uint256 indexed marketId, ResolutionSource source, address resolver, bytes32 sourceRef
    );
    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, int256 resolvedPrice);
    event MarketSettled(uint256 indexed marketId, bytes32 merkleRoot, uint256[] outcomeTotals);
    event Claimed(uint256 indexed marketId, bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    error MarketNotOpen();
    error MarketNotResolvable();
    error MarketNotResolved();
    error MarketNotSettled();
    error StalePrice();
    error InvalidPrice();
    error ZeroAmount();
    error CommitmentOutOfField();
    error CommitmentAlreadyUsed();
    error TotalsMismatch();
    error NullifierAlreadySpent();
    error InvalidProof();
    error NoWinningStake();
    error TransferFailed();
    error ZeroCollateral();
    error WrongResolutionMethod();
    error NotResolver();
    error ZeroResolver();
    error BadOutcomeCount();
    error OutcomeOutOfRange();

    /// @param verifier_ Address of the deployed UltraHonk claim verifier.
    /// @param sp1Verifier_ Address of the SP1 verifier (gateway).
    /// @param programVKey_ Verifying-key hash of the batch-settlement SP1 program.
    /// @param collateral_ ERC-20 collateral token (USDC) for this chain.
    constructor(address verifier_, address sp1Verifier_, bytes32 programVKey_, address collateral_) {
        if (collateral_ == address(0)) revert ZeroCollateral();
        verifier = IHonkVerifier(verifier_);
        sp1Verifier = ISP1Verifier(sp1Verifier_);
        programVKey = programVKey_;
        collateral = IERC20(collateral_);
    }

    /// @param priceFeed Chainlink AggregatorV3Interface address for the underlying asset.
    /// @param threshold Price threshold in the feed's native decimals. Market resolves
    ///                   Yes if the feed price is >= threshold at resolution time.
    /// @param resolveAfter Timestamp after which `resolveMarket` may be called.
    /// @param maxPriceStaleness Maximum allowed age (seconds) of the feed's last update
    ///                          at resolution time.
    function createMarket(address priceFeed, int256 threshold, uint256 resolveAfter, uint256 maxPriceStaleness)
        external
        returns (uint256 marketId)
    {
        marketId = marketCount++;
        Market storage m = markets[marketId];
        m.priceFeed = AggregatorV3Interface(priceFeed);
        m.threshold = threshold;
        m.resolveAfter = resolveAfter;
        m.maxPriceStaleness = maxPriceStaleness;
        m.numOutcomes = 2; // a price-threshold market is binary (No/Yes)

        // Chainlink-feed markets resolve trustlessly on-chain; no resolver.
        resolutionConfig[marketId] =
            ResolutionConfig({source: ResolutionSource.ChainlinkFeed, resolver: address(0), sourceRef: bytes32(0)});

        emit MarketCreated(marketId, priceFeed, threshold, resolveAfter);
        emit MarketSourceSet(marketId, ResolutionSource.ChainlinkFeed, address(0), bytes32(0));
    }

    /// @notice Creates a market whose outcome comes from a non-feed source (a
    ///         subgraph metric or a CRE workflow). Because such outcomes can't
    ///         be read on-chain, `resolver` — named here at creation, in
    ///         practice the Chainlink DON / CRE forwarder — is the only address
    ///         allowed to report the result via `reportResolution`. Creation is
    ///         permissionless; the contract has no owner.
    /// @param source     Must be `GraphQuery` or `CreWorkflow` (use
    ///                   `createMarket` for `ChainlinkFeed`).
    /// @param resolver   Address authorized to report this market's outcome.
    /// @param threshold  Optional numeric threshold for display/analytics (the
    ///                   off-chain resolver applies it); 0 if unused.
    /// @param resolveAfter Timestamp after which the outcome may be reported.
    /// @param sourceRef  Provenance handle — the pinned subgraph deployment id
    ///                   or CRE workflow id this market is bound to.
    /// @param numOutcomes Number of outcome buckets (2 for a binary Yes/No
    ///                   market, N for a categorical market such as "which of N
    ///                   drivers wins").
    function createMarketWithSource(
        ResolutionSource source,
        address resolver,
        int256 threshold,
        uint256 resolveAfter,
        bytes32 sourceRef,
        uint8 numOutcomes
    ) external returns (uint256 marketId) {
        if (source == ResolutionSource.ChainlinkFeed) revert WrongResolutionMethod();
        if (resolver == address(0)) revert ZeroResolver();
        if (numOutcomes < 2) revert BadOutcomeCount();

        marketId = marketCount++;
        Market storage m = markets[marketId];
        // priceFeed/maxPriceStaleness stay zero: this market is not feed-resolved.
        m.threshold = threshold;
        m.resolveAfter = resolveAfter;
        m.numOutcomes = numOutcomes;

        resolutionConfig[marketId] = ResolutionConfig({source: source, resolver: resolver, sourceRef: sourceRef});

        emit MarketCreated(marketId, address(0), threshold, resolveAfter);
        emit MarketSourceSet(marketId, source, resolver, sourceRef);
    }

    /// @notice Takes a private position: escrows `amount` USDC (pulled via
    ///         `transferFrom`, so the caller must `approve` first — or use
    ///         `depositWithPermit`) and appends the note `commitment` as the next
    ///         leaf of the market's commitments tree. The side and the deposit's
    ///         link to any future claim stay hidden.
    /// @param amount Collateral in USDC base units (6 decimals).
    function deposit(uint256 marketId, bytes32 commitment, uint256 amount) external returns (uint256 leafIndex) {
        return _deposit(marketId, commitment, amount);
    }

    /// @notice Same as `deposit`, but sets the escrow's allowance from an
    ///         EIP-2612 signature first — a single-transaction, gasless-approval
    ///         deposit. The `permit` is wrapped in try/catch so a front-run that
    ///         already consumed the signature (setting the allowance) doesn't
    ///         brick the deposit.
    function depositWithPermit(
        uint256 marketId,
        bytes32 commitment,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 leafIndex) {
        try IERC20Permit(address(collateral)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        return _deposit(marketId, commitment, amount);
    }

    /// @dev Shared deposit logic. All cheap checks run before any token pull, so
    ///      a rejected deposit never moves funds (checks-effects-interactions).
    function _deposit(uint256 marketId, bytes32 commitment, uint256 amount) internal returns (uint256 leafIndex) {
        if (amount == 0) revert ZeroAmount();
        if (uint256(commitment) >= FIELD_MODULUS) revert CommitmentOutOfField();

        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (commitmentSeen[marketId][commitment]) revert CommitmentAlreadyUsed();

        commitmentSeen[marketId][commitment] = true;
        leafIndex = m.depositCount;
        _commitments[marketId].push(commitment);
        m.depositCount = leafIndex + 1;
        m.totalPool += amount;

        // Interaction last: pull the collateral in. Reverts (rolling back the
        // whole deposit) if allowance/balance is insufficient.
        _safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(marketId, commitment, leafIndex, amount);
    }

    /// @notice Resolves the market against the Chainlink feed. Reverts if the
    ///         feed's last update is older than `maxPriceStaleness` — some
    ///         testnet feeds are known to stop updating, so this is a
    ///         correctness requirement, not just defensive programming.
    function resolveMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp < m.resolveAfter) revert MarketNotResolvable();
        // Only feed-resolved markets can be settled trustlessly on-chain here;
        // Graph/CRE markets are delivered via reportResolution.
        if (resolutionConfig[marketId].source != ResolutionSource.ChainlinkFeed) {
            revert WrongResolutionMethod();
        }

        (, int256 price,, uint256 updatedAt,) = m.priceFeed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > m.maxPriceStaleness) revert StalePrice();

        uint8 winningOutcome = price >= m.threshold ? OUTCOME_YES : OUTCOME_NO;
        m.status = Status.Resolved;
        m.winningOutcome = winningOutcome;

        emit MarketResolved(marketId, winningOutcome, price);
    }

    /// @notice Reports the outcome of a non-feed market (`GraphQuery` /
    ///         `CreWorkflow`). Callable only by the market's registered
    ///         `resolver` — the Chainlink DON / CRE forwarder that posts the
    ///         result on-chain — after `resolveAfter`. This is the on-chain
    ///         landing pad for subgraph-metric and CRE-workflow resolution.
    /// @param winningOutcome The resolved outcome index (must be < numOutcomes).
    function reportResolution(uint256 marketId, uint8 winningOutcome) external {
        Market storage m = markets[marketId];
        ResolutionConfig storage rc = resolutionConfig[marketId];
        if (rc.source == ResolutionSource.ChainlinkFeed) revert WrongResolutionMethod();
        if (msg.sender != rc.resolver) revert NotResolver();
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp < m.resolveAfter) revert MarketNotResolvable();
        if (winningOutcome >= m.numOutcomes) revert OutcomeOutOfRange();

        m.status = Status.Resolved;
        m.winningOutcome = winningOutcome;

        // resolvedPrice is 0: this outcome came from an off-chain source, not a
        // price feed. The source + provenance are in `resolutionConfig`.
        emit MarketResolved(marketId, winningOutcome, 0);
    }

    /// @notice Trustlessly settles a batch of resolved markets from an SP1
    ///         proof. The proof attests that, for every market in
    ///         `publicValues`, the per-side totals and commitments-tree root
    ///         were correctly computed from that market's committed notes — so
    ///         no operator is trusted for the numbers. Permissionless: anyone
    ///         holding a valid proof can settle.
    /// @param publicValues ABI-encoded `SettlementValues[]` (the proof's public
    ///        values, produced by the SP1 guest).
    /// @param proofBytes   SP1 proof bytes.
    function settleWithProof(bytes calldata publicValues, bytes calldata proofBytes) external {
        // Reverts if the proof does not attest to `publicValues` under the
        // batch-settlement program's verifying key.
        sp1Verifier.verifyProof(programVKey, publicValues, proofBytes);

        SettlementValues[] memory settlements = abi.decode(publicValues, (SettlementValues[]));

        for (uint256 i = 0; i < settlements.length; i++) {
            SettlementValues memory s = settlements[i];
            Market storage m = markets[s.marketId];
            if (m.status != Status.Resolved) revert MarketNotResolved();
            // The proven totals must have exactly one entry per outcome bucket.
            if (s.outcomeTotals.length != m.numOutcomes) revert BadOutcomeCount();

            // Widen to uint256 and sum. Defense in depth: the proof already ties
            // the totals to the notes, but they must still reconcile with the
            // escrowed collateral on-chain.
            uint256[] memory totals = new uint256[](s.outcomeTotals.length);
            uint256 sum;
            for (uint256 j = 0; j < s.outcomeTotals.length; j++) {
                totals[j] = uint256(s.outcomeTotals[j]);
                sum += totals[j];
            }
            if (sum != m.totalPool) revert TotalsMismatch();

            m.merkleRoot = s.merkleRoot;
            _outcomeTotals[s.marketId] = totals;
            m.status = Status.Settled;

            emit MarketSettled(s.marketId, s.merkleRoot, totals);
        }
    }

    /// @notice Claims a pari-mutuel payout for a winning note, in zero
    ///         knowledge. The proof establishes that the caller owns an unspent
    ///         note that is a member of `merkleRoot`, is on the winning side,
    ///         and yields `nullifier` — without revealing which deposit it is.
    ///         `recipient` is bound into the proof, so the claim cannot be
    ///         front-run.
    /// @param amount    Stake of the claimed note (a public input to the proof).
    /// @param nullifier Note nullifier, revealed and marked spent here.
    /// @param recipient Payout address (bound into the proof).
    /// @param proof     UltraHonk proof bytes.
    function claim(uint256 marketId, uint256 amount, bytes32 nullifier, address recipient, bytes calldata proof)
        external
    {
        Market storage m = markets[marketId];
        if (m.status != Status.Settled) revert MarketNotSettled();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();

        // Public inputs are built from trusted on-chain state (root, marketId,
        // winningOutcome) plus the caller-supplied (amount, nullifier, recipient),
        // in the exact order the claim circuit declares them. Building them here
        // — rather than trusting a caller-supplied array — binds the proof to
        // this market's resolved state.
        bytes32[] memory publicInputs = new bytes32[](6);
        publicInputs[0] = m.merkleRoot;
        publicInputs[1] = bytes32(marketId);
        publicInputs[2] = bytes32(uint256(m.winningOutcome));
        publicInputs[3] = bytes32(amount);
        publicInputs[4] = nullifier;
        publicInputs[5] = bytes32(uint256(uint160(recipient)));

        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        // Effects before interaction: mark the nullifier spent before paying.
        nullifierSpent[nullifier] = true;

        // Pari-mutuel: the whole pool is split among notes on the winning bucket.
        uint256 totalWinning = _outcomeTotals[marketId][m.winningOutcome];
        if (totalWinning == 0) revert NoWinningStake();

        uint256 payout = (amount * m.totalPool) / totalWinning;

        emit Claimed(marketId, nullifier, recipient, payout);

        // Pay the winner in USDC. Nullifier already marked spent above, so this
        // interaction cannot be re-entered for a double payout.
        _safeTransfer(recipient, payout);
    }

    // --- ERC-20 safe-transfer helpers (SafeERC20-style, self-contained) ---

    function _safeTransfer(address to, uint256 amount) internal {
        _callOptionalReturn(abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        _callOptionalReturn(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    /// @dev Calls the collateral token and treats the call as successful only if
    ///      it did not revert AND either returned no data or returned `true`.
    ///      Handles USDC (returns bool) and non-standard no-return tokens.
    function _callOptionalReturn(bytes memory data) private {
        (bool success, bytes memory returndata) = address(collateral).call(data);
        if (!success || (returndata.length != 0 && !abi.decode(returndata, (bool)))) {
            revert TransferFailed();
        }
    }

    /// @notice All commitments (leaves) of a market, in insertion order.
    function getCommitments(uint256 marketId) external view returns (bytes32[] memory) {
        return _commitments[marketId];
    }

    /// @notice A single commitment leaf by index.
    function commitmentAt(uint256 marketId, uint256 leafIndex) external view returns (bytes32) {
        return _commitments[marketId][leafIndex];
    }

    /// @notice Per-outcome staked totals for a settled market (length ==
    ///         numOutcomes). Empty until the market is settled.
    function getOutcomeTotals(uint256 marketId) external view returns (uint256[] memory) {
        return _outcomeTotals[marketId];
    }
}
