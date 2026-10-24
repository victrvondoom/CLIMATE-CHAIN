// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EvidenceAnchor
/// @notice Stores a digest of a Climate Chain review manifest for later integrity checks.
/// @dev The source payload stays off-chain. This contract proves only that a digest was
///      committed at a block; it does not prove that the source data is true or causal.
contract EvidenceAnchor {
    struct AnchorRecord {
        bytes32 manifestIdHash;
        bytes32 evidenceTypeHash;
        address anchorer;
        uint64 blockNumber;
        uint64 anchoredAt;
        bool exists;
    }

    mapping(bytes32 digest => AnchorRecord record) public anchors;
    uint256 public anchorCount;

    error EmptyDigest();
    error DigestAlreadyAnchored(bytes32 digest);

    event EvidenceAnchored(
        bytes32 indexed digest,
        bytes32 indexed manifestIdHash,
        bytes32 indexed evidenceTypeHash,
        address anchorer,
        uint64 blockNumber,
        uint64 anchoredAt
    );

    function anchor(bytes32 digest, bytes32 manifestIdHash, bytes32 evidenceTypeHash) external {
        if (digest == bytes32(0)) revert EmptyDigest();
        if (anchors[digest].exists) revert DigestAlreadyAnchored(digest);

        uint64 committedBlock = uint64(block.number);
        uint64 committedAt = uint64(block.timestamp);
        anchors[digest] = AnchorRecord({
            manifestIdHash: manifestIdHash,
            evidenceTypeHash: evidenceTypeHash,
            anchorer: msg.sender,
            blockNumber: committedBlock,
            anchoredAt: committedAt,
            exists: true
        });
        anchorCount += 1;

        emit EvidenceAnchored(
            digest,
            manifestIdHash,
            evidenceTypeHash,
            msg.sender,
            committedBlock,
            committedAt
        );
    }
}
