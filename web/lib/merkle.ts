import { poseidon2 } from "poseidon-lite";

/// Fixed depth of the commitments tree — must match `MERKLE_DEPTH` in the Noir
/// `obscura` lib and the aggregation crate.
export const MERKLE_DEPTH = 20;

/// Precomputed all-zero-subtree roots per level: zeros[0] = 0 (empty leaf),
/// zeros[i] = Poseidon(zeros[i-1], zeros[i-1]). Mirrors `aggregation::zero_hashes`.
function zeroHashes(): bigint[] {
  const z = [0n];
  for (let i = 1; i <= MERKLE_DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
}

/// The authentication path for a leaf: sibling hash + direction bit per level
/// (0 = this node is the left child). Feeds the Noir claim circuit's
/// `path_indices` / `path_siblings`.
export interface MerklePath {
  indices: bigint[]; // length MERKLE_DEPTH, each 0 or 1
  siblings: bigint[]; // length MERKLE_DEPTH
  root: bigint;
}

/// Rebuilds the fixed-depth tree from the market's leaves (in insertion order)
/// and returns the authentication path for `leafIndex`. Uses the same
/// zero-padding + Poseidon(left,right) construction as `aggregation::merkle_root`,
/// so the recomputed root matches the SP1-proven, on-chain root.
export function merklePath(leaves: bigint[], leafIndex: number): MerklePath {
  const zeros = zeroHashes();
  const indices: bigint[] = [];
  const siblings: bigint[] = [];

  let idx = leafIndex;
  let level = leaves.slice();

  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < level.length ? level[siblingIdx] : zeros[depth];
    indices.push(isRight ? 1n : 0n);
    siblings.push(sibling);

    // build the next level up (with zero padding for the missing right node)
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : zeros[depth];
      next.push(poseidon2([left, right]));
    }
    level = next.length ? next : [zeros[depth + 1]];
    idx = Math.floor(idx / 2);
  }

  return { indices, siblings, root: level[0] };
}

/// Full root of the commitments tree (for display / sanity checks).
export function merkleRoot(leaves: bigint[]): bigint {
  const zeros = zeroHashes();
  if (leaves.length === 0) return zeros[MERKLE_DEPTH];
  let level = leaves.slice();
  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : zeros[depth];
      next.push(poseidon2([left, right]));
    }
    level = next;
  }
  return level[0];
}
