// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EnvironmentalEvidenceRegistry
/// @notice Append-only registry of evidence-bundle digests with revision lineage.
/// @dev Raw measurements stay off-chain. A record proves that these exact bytes were
///      committed by an authorised attester at a block. It does not prove that the
///      underlying measurement is accurate, calibrated or causal.
///      Records are never overwritten. A correction is a new record whose parent is
///      the record it replaces; the parent then points forward to its successor.
contract EnvironmentalEvidenceRegistry {
    struct Evidence {
        bytes32 digest;
        bytes32 parentEvidenceId;
        bytes32 metadataHash;
        bytes32 supersededBy;
        address attester;
        uint64 blockNumber;
        uint64 anchoredAt;
    }

    address public immutable admin;
    mapping(address account => bool allowed) public isAttester;
    mapping(bytes32 digest => bytes32 evidenceId) public evidenceIdForDigest;
    uint256 public evidenceCount;
    mapping(bytes32 evidenceId => Evidence record) private records;

    error NotAdmin(address caller);
    error NotAttester(address caller);
    error ZeroAddress();
    error EmptyEvidenceId();
    error EmptyDigest();
    error EvidenceIdTaken(bytes32 evidenceId);
    error DigestAlreadyAnchored(bytes32 digest, bytes32 evidenceId);
    error UnknownParent(bytes32 parentEvidenceId);
    error ParentAlreadySuperseded(bytes32 parentEvidenceId, bytes32 supersededBy);

    event AttesterUpdated(address indexed account, bool allowed, address indexed updatedBy);
    event EvidenceAnchored(
        bytes32 indexed evidenceId,
        bytes32 indexed digest,
        bytes32 indexed parentEvidenceId,
        bytes32 metadataHash,
        address attester,
        uint64 blockNumber,
        uint64 anchoredAt
    );
    event EvidenceSuperseded(bytes32 indexed parentEvidenceId, bytes32 indexed evidenceId);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    modifier onlyAttester() {
        if (!isAttester[msg.sender]) revert NotAttester(msg.sender);
        _;
    }

    constructor() {
        admin = msg.sender;
        isAttester[msg.sender] = true;
        emit AttesterUpdated(msg.sender, true, msg.sender);
    }

    function setAttester(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isAttester[account] = allowed;
        emit AttesterUpdated(account, allowed, msg.sender);
    }

    /// @param evidenceId keccak256 of the off-chain evidence identifier.
    /// @param digest SHA-256 of the canonical evidence bundle.
    /// @param parentEvidenceId Record this one corrects, or zero for an original record.
    /// @param metadataHash SHA-256 of the canonical, non-sensitive bundle metadata.
    function anchorEvidence(bytes32 evidenceId, bytes32 digest, bytes32 parentEvidenceId, bytes32 metadataHash)
        external
        onlyAttester
    {
        if (evidenceId == bytes32(0)) revert EmptyEvidenceId();
        if (digest == bytes32(0)) revert EmptyDigest();
        if (records[evidenceId].digest != bytes32(0)) revert EvidenceIdTaken(evidenceId);
        bytes32 existing = evidenceIdForDigest[digest];
        if (existing != bytes32(0)) revert DigestAlreadyAnchored(digest, existing);

        if (parentEvidenceId != bytes32(0)) {
            Evidence storage parent = records[parentEvidenceId];
            if (parent.digest == bytes32(0)) revert UnknownParent(parentEvidenceId);
            if (parent.supersededBy != bytes32(0)) revert ParentAlreadySuperseded(parentEvidenceId, parent.supersededBy);
            parent.supersededBy = evidenceId;
        }

        uint64 committedBlock = uint64(block.number);
        uint64 committedAt = uint64(block.timestamp);
        records[evidenceId] = Evidence({
            digest: digest,
            parentEvidenceId: parentEvidenceId,
            metadataHash: metadataHash,
            supersededBy: bytes32(0),
            attester: msg.sender,
            blockNumber: committedBlock,
            anchoredAt: committedAt
        });
        evidenceIdForDigest[digest] = evidenceId;
        evidenceCount += 1;

        emit EvidenceAnchored(evidenceId, digest, parentEvidenceId, metadataHash, msg.sender, committedBlock, committedAt);
        if (parentEvidenceId != bytes32(0)) emit EvidenceSuperseded(parentEvidenceId, evidenceId);
    }

    function getEvidence(bytes32 evidenceId) external view returns (Evidence memory) {
        return records[evidenceId];
    }

    function exists(bytes32 evidenceId) public view returns (bool) {
        return records[evidenceId].digest != bytes32(0);
    }

    /// @notice True when the record exists and no correction has replaced it.
    function isCurrent(bytes32 evidenceId) external view returns (bool) {
        Evidence storage record = records[evidenceId];
        return record.digest != bytes32(0) && record.supersededBy == bytes32(0);
    }

    function verifyDigest(bytes32 evidenceId, bytes32 digest) external view returns (bool) {
        return digest != bytes32(0) && records[evidenceId].digest == digest;
    }
}
