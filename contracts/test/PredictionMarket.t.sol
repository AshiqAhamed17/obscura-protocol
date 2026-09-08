// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MockHonkVerifier} from "./mocks/MockHonkVerifier.sol";
import {MockSP1Verifier} from "./mocks/MockSP1Verifier.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PredictionMarketTest is Test {
    uint8 constant DECIMALS = 8;
    int256 constant INITIAL_PRICE = 3_000e8; // $3000
    uint256 constant MAX_STALENESS = 1 hours;

    uint256 constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    PredictionMarket market;
    MockV3Aggregator feed;
    MockHonkVerifier verifier;
    MockSP1Verifier sp1Verifier;
    MockUSDC usdc;
    bytes32 constant PROGRAM_VKEY = bytes32(uint256(0x5f1));

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    event Deposit(uint256 indexed marketId, bytes32 indexed commitment, uint256 leafIndex, uint256 amount);
    event MarketSettled(uint256 indexed marketId, bytes32 merkleRoot, uint256[] outcomeTotals);
    event Claimed(uint256 indexed marketId, bytes32 indexed nullifier, address indexed recipient, uint256 payout);

    function setUp() public {
        verifier = new MockHonkVerifier();
        sp1Verifier = new MockSP1Verifier();
        usdc = new MockUSDC();
        market = new PredictionMarket(address(verifier), address(sp1Verifier), PROGRAM_VKEY, address(usdc));
        feed = new MockV3Aggregator(DECIMALS, INITIAL_PRICE);
    }

    function _createMarket(int256 threshold, uint256 resolveAfter) internal returns (uint256) {
        return market.createMarket(address(feed), threshold, resolveAfter, MAX_STALENESS);
    }

    function _c(uint256 v) internal pure returns (bytes32) {
        return bytes32(v);
    }

    /// Fund `from` with USDC, approve the escrow, and deposit — the ERC-20
    /// equivalent of the old `deposit{value: amt}`. Sender identity doesn't
    /// affect deposit accounting (only the commitment is recorded).
    function _deposit(address from, uint256 id, bytes32 c, uint256 amt) internal returns (uint256 idx) {
        usdc.mint(from, amt);
        vm.prank(from);
        usdc.approve(address(market), amt);
        vm.prank(from);
        idx = market.deposit(id, c, amt);
    }

    // --- createMarket ---

    function test_createMarket_incrementsId() public {
        uint256 id0 = _createMarket(3_000e8, block.timestamp + 1 days);
        uint256 id1 = _createMarket(4_000e8, block.timestamp + 1 days);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(market.marketCount(), 2);
    }

    // --- deposit / commitments tree ---

    function test_deposit_storesCommitmentAndEscrows() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        uint256 leafIndex = _deposit(alice, id, _c(111), 1 ether);

        assertEq(leafIndex, 0);
        assertEq(market.commitmentAt(id, 0), _c(111));
        assertEq(usdc.balanceOf(address(market)), 1 ether);

        (,,,,,,, uint256 totalPool, uint256 depositCount,) = market.markets(id);
        assertEq(totalPool, 1 ether);
        assertEq(depositCount, 1);
    }

    function test_deposit_emitsEventWithLeafIndex() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        usdc.mint(alice, 2 ether);
        vm.prank(alice);
        usdc.approve(address(market), 2 ether);

        vm.expectEmit(true, true, false, true);
        emit Deposit(id, _c(222), 0, 2 ether);

        vm.prank(alice);
        market.deposit(id, _c(222), 2 ether);
    }

    function test_deposit_multiple_appendsLeavesInOrderAndSumsPool() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        _deposit(alice, id, _c(111), 1 ether);
        _deposit(bob, id, _c(222), 3 ether);

        bytes32[] memory leaves = market.getCommitments(id);
        assertEq(leaves.length, 2);
        assertEq(leaves[0], _c(111));
        assertEq(leaves[1], _c(222));

        (,,,,,,, uint256 totalPool, uint256 depositCount,) = market.markets(id);
        assertEq(totalPool, 4 ether);
        assertEq(depositCount, 2);
    }

    function test_deposit_revertsOnZeroValue() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.ZeroAmount.selector);
        market.deposit(id, _c(111), 0);
    }

    function test_deposit_revertsOnOutOfFieldCommitment() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.CommitmentOutOfField.selector);
        market.deposit(id, bytes32(FIELD_MODULUS), 1 ether);
    }

    function test_deposit_revertsOnDuplicateCommitment() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _deposit(alice, id, _c(111), 1 ether);

        // Reverts at the duplicate-commitment check, before any token pull.
        vm.prank(bob);
        vm.expectRevert(PredictionMarket.CommitmentAlreadyUsed.selector);
        market.deposit(id, _c(111), 1 ether);
    }

    function test_deposit_revertsAfterResolution() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);

        vm.prank(alice);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.deposit(id, _c(111), 1 ether);
    }

    function test_deposit_revertsWithoutApproval() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        usdc.mint(alice, 1 ether); // funded but never approved the escrow
        vm.prank(alice);
        vm.expectRevert(); // MockUSDC: insufficient allowance
        market.deposit(id, _c(111), 1 ether);
    }

    // --- depositWithPermit (EIP-2612 gasless approval) ---

    function test_depositWithPermit_setsAllowanceAndEscrows() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitSigner");
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);

        uint256 amount = 5 ether;
        usdc.mint(signer, amount);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(usdc.PERMIT_TYPEHASH(), signer, address(market), amount, usdc.nonces(signer), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        // No prior approve() — a single call sets the allowance from the
        // signature and deposits.
        vm.prank(signer);
        uint256 leafIndex = market.depositWithPermit(id, _c(777), amount, deadline, v, r, s);

        assertEq(leafIndex, 0);
        assertEq(usdc.balanceOf(address(market)), amount);
        (,,,,,,, uint256 totalPool,,) = market.markets(id);
        assertEq(totalPool, amount);
    }

    // --- resolveMarket ---

    function test_resolveMarket_revertsBeforeResolveAfter() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        vm.expectRevert(PredictionMarket.MarketNotResolvable.selector);
        market.resolveMarket(id);
    }

    function test_resolveMarket_revertsOnStalePrice() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        // warp past resolveAfter + staleness window without refreshing the feed
        vm.warp(block.timestamp + 1 days + MAX_STALENESS + 1);
        vm.expectRevert(PredictionMarket.StalePrice.selector);
        market.resolveMarket(id);
    }

    function test_resolveMarket_yesWinsWhenPriceAtOrAboveThreshold() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);

        (,,,, PredictionMarket.Status status, uint8 winningOutcome,,,,) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Resolved));
        assertEq(winningOutcome, 1); // Yes
    }

    function test_resolveMarket_noWinsWhenPriceBelowThreshold() public {
        uint256 id = _createMarket(4_000e8, block.timestamp + 1 days);
        _resolve(id);

        (,,,,, uint8 winningOutcome,,,,) = market.markets(id);
        assertEq(winningOutcome, 0); // No
    }

    function test_resolveMarket_revertsIfAlreadyResolved() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _resolve(id);
        vm.expectRevert(PredictionMarket.MarketNotOpen.selector);
        market.resolveMarket(id);
    }

    // --- settleWithProof (trustless, SP1-verified) ---

    function _resolvedMarketWithPool(uint256 poolEach) internal returns (uint256 id) {
        id = _createMarket(3_000e8, block.timestamp + 1 days);
        _deposit(alice, id, _c(111), poolEach);
        _deposit(bob, id, _c(222), poolEach);
        _resolve(id);
    }

    /// Binary settlement: outcome 0 = No (`tn`), outcome 1 = Yes (`ty`).
    function _encodeSettlement(uint64 id, uint64 ty, uint64 tn, bytes32 root)
        internal
        pure
        returns (bytes memory)
    {
        uint64[] memory totals = new uint64[](2);
        totals[0] = tn; // No
        totals[1] = ty; // Yes
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] = PredictionMarket.SettlementValues({marketId: id, outcomeTotals: totals, merkleRoot: root});
        return abi.encode(vals);
    }

    function test_settleWithProof_settlesFromDecodedValues() public {
        uint256 id = _resolvedMarketWithPool(1 ether); // pool = 2 ether
        bytes memory pv = _encodeSettlement(uint64(id), 1 ether, 1 ether, _c(0xABCD));

        uint256[] memory expectedTotals = new uint256[](2);
        expectedTotals[0] = 1 ether; // No
        expectedTotals[1] = 1 ether; // Yes
        vm.expectEmit(true, false, false, true);
        emit MarketSettled(id, _c(0xABCD), expectedTotals);
        market.settleWithProof(pv, hex"01");

        (,,,, PredictionMarket.Status status,,,,, bytes32 root) = market.markets(id);
        assertEq(uint8(status), uint8(PredictionMarket.Status.Settled));
        assertEq(root, _c(0xABCD));
        uint256[] memory totals = market.getOutcomeTotals(id);
        assertEq(totals[1], 1 ether); // Yes
        assertEq(totals[0], 1 ether); // No
    }

    function test_settleWithProof_revertsOnInvalidProof() public {
        uint256 id = _resolvedMarketWithPool(1 ether);
        bytes memory pv = _encodeSettlement(uint64(id), 1 ether, 1 ether, _c(0xABCD));

        sp1Verifier.setShouldReject(true);
        vm.expectRevert(bytes("SP1: invalid proof"));
        market.settleWithProof(pv, hex"01");
    }

    function test_settleWithProof_revertsOnTotalsMismatch() public {
        uint256 id = _resolvedMarketWithPool(1 ether); // pool = 2 ether
        // totals sum to 3 ether, not the escrowed 2 ether
        bytes memory pv = _encodeSettlement(uint64(id), 2 ether, 1 ether, _c(0xABCD));

        vm.expectRevert(PredictionMarket.TotalsMismatch.selector);
        market.settleWithProof(pv, hex"01");
    }

    function test_settleWithProof_revertsIfMarketNotResolved() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _deposit(alice, id, _c(111), 2 ether);
        // not resolved
        bytes memory pv = _encodeSettlement(uint64(id), 2 ether, 0, _c(0xABCD));

        vm.expectRevert(PredictionMarket.MarketNotResolved.selector);
        market.settleWithProof(pv, hex"01");
    }

    // --- claim ---

    /// Deposits 4 USDC-units, resolves Yes, settles (via SP1 proof) 2/2.
    function _settledYesMarket() internal returns (uint256 id) {
        id = _createMarket(3_000e8, block.timestamp + 1 days);
        _deposit(alice, id, _c(111), 2 ether);
        _deposit(bob, id, _c(222), 2 ether);
        _resolve(id); // price == threshold -> Yes wins
        // Trustless settlement: mock SP1 verifier accepts, contract decodes the
        // proven totals + root from the (Solidity-encoded here) public values.
        market.settleWithProof(_encodeSettlement(uint64(id), 2 ether, 2 ether, _c(999)), hex"01");
    }

    function test_claim_paysProportionalPariMutuel() public {
        uint256 id = _settledYesMarket();

        // pool = 4, winning (Yes) total = 2, claimed note amount = 1
        // payout = 1 * 4 / 2 = 2 units
        vm.expectEmit(true, true, true, true);
        emit Claimed(id, _c(555), carol, 2 ether);
        market.claim(id, 1 ether, _c(555), carol, hex"01");

        assertEq(usdc.balanceOf(carol), 2 ether);
        assertTrue(market.nullifierSpent(_c(555)));
    }

    function test_claim_revertsIfNotSettled() public {
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _deposit(alice, id, _c(111), 4 ether);
        _resolve(id); // resolved but not settled

        vm.expectRevert(PredictionMarket.MarketNotSettled.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function test_claim_revertsOnInvalidProof() public {
        uint256 id = _settledYesMarket();
        verifier.setResult(false);

        vm.expectRevert(PredictionMarket.InvalidProof.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    // --- categorical (multi-outcome) markets ---

    /// A 3-outcome market ("which of 3 drivers wins") settles from proven
    /// per-outcome totals and pays the winning bucket pari-mutuel.
    function test_categorical_threeOutcome_settlesAndPaysWinningBucket() public {
        // This test contract is the registered resolver for the CRE-sourced market.
        uint256 id = market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            address(this),
            0,
            block.timestamp + 1 days,
            keccak256("2026-spanish-gp"),
            3
        );

        // Bets on outcomes 0/1/2 for 1/2/3 units — pool = 6 units.
        _deposit(alice, id, _c(11), 1 ether); // backed outcome 0
        _deposit(alice, id, _c(22), 2 ether); // backed outcome 1
        _deposit(alice, id, _c(33), 3 ether); // backed outcome 2

        vm.warp(block.timestamp + 1 days + 1);
        market.reportResolution(id, 2); // outcome 2 wins

        uint64[] memory totals = new uint64[](3);
        totals[0] = 1 ether;
        totals[1] = 2 ether;
        totals[2] = 3 ether;
        PredictionMarket.SettlementValues[] memory vals = new PredictionMarket.SettlementValues[](1);
        vals[0] =
            PredictionMarket.SettlementValues({marketId: uint64(id), outcomeTotals: totals, merkleRoot: _c(0xABC)});
        market.settleWithProof(abi.encode(vals), hex"01");

        assertEq(market.getOutcomeTotals(id)[2], 3 ether);

        // Winner on outcome 2 with a 3-unit note: payout = 3 * 6 / 3 = 6 units (the
        // whole pool, since they were the only staker on the winning outcome).
        market.claim(id, 3 ether, _c(77), carol, hex"01");
        assertEq(usdc.balanceOf(carol), 6 ether);
    }

    function test_categorical_createRejectsFewerThanTwoOutcomes() public {
        vm.expectRevert(PredictionMarket.BadOutcomeCount.selector);
        market.createMarketWithSource(
            PredictionMarket.ResolutionSource.CreWorkflow,
            address(this),
            0,
            block.timestamp + 1 days,
            keccak256("bad"),
            1
        );
    }

    function test_claim_revertsOnDoubleSpend() public {
        uint256 id = _settledYesMarket();

        market.claim(id, 1 ether, _c(555), carol, hex"01");

        vm.expectRevert(PredictionMarket.NullifierAlreadySpent.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function test_claim_revertsWhenNoWinningStake() public {
        // Market resolves Yes but the proven totals have zero Yes stake.
        uint256 id = _createMarket(3_000e8, block.timestamp + 1 days);
        _deposit(alice, id, _c(111), 4 ether);
        _resolve(id); // Yes wins
        market.settleWithProof(_encodeSettlement(uint64(id), 0, 4 ether, _c(999)), hex"01");

        vm.expectRevert(PredictionMarket.NoWinningStake.selector);
        market.claim(id, 1 ether, _c(555), carol, hex"01");
    }

    function _resolve(uint256 id) internal {
        vm.warp(block.timestamp + 1 days);
        feed.updateAnswer(INITIAL_PRICE);
        market.resolveMarket(id);
    }
}
