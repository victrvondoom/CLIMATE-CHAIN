// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEvidenceRegistry {
    function exists(bytes32 evidenceId) external view returns (bool);
    function isCurrent(bytes32 evidenceId) external view returns (bool);
}

/// @title ClimateClaimRegistry
/// @notice Records environmental claims against anchored evidence and refuses a second
///         active claim for the same scope inside this registry.
/// @dev This registry never issues, transfers or sells credits. A Submitted claim is an
///      unverified record, not a certified offset. Duplicate protection is scoped to this
///      contract; it cannot see other registries or chains.
///      Two locks apply:
///      - exclusivityKey: one active claim per project, boundary, monitoring period,
///        methodology and benefit type (computed off-chain, documented in the gateway).
///      - evidenceId: one evidence record backs at most one active claim.
///      Claims are never deleted. A correction supersedes the original and keeps both.
contract ClimateClaimRegistry {
    enum Status {
        None,
        Submitted,
        Challenged,
        Rejected,
        Superseded
    }

    struct Claim {
        bytes32 exclusivityKey;
        bytes32 evidenceId;
        bytes32 claimHash;
        bytes32 supersedes;
        bytes32 supersededBy;
        bytes32 challengeReasonHash;
        address claimant;
        address challenger;
        Status status;
        uint64 submittedBlock;
    }

    bytes32 public constant CLAIMANT_ROLE = keccak256("CLAIMANT_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    address public immutable admin;
    IEvidenceRegistry public immutable evidenceRegistry;
    mapping(address account => bool allowed) public isClaimant;
    mapping(address account => bool allowed) public isReviewer;
    mapping(bytes32 exclusivityKey => bytes32 claimId) public activeClaimForKey;
    mapping(bytes32 evidenceId => bytes32 claimId) public activeClaimForEvidence;
    uint256 public claimCount;
    mapping(bytes32 claimId => Claim record) private claims;

    error NotAdmin(address caller);
    error NotClaimant(address caller);
    error NotReviewer(address caller);
    error ZeroAddress();
    error EmptyClaimId();
    error EmptyExclusivityKey();
    error EmptyClaimHash();
    error EmptyReason();
    error ClaimIdTaken(bytes32 claimId);
    error UnknownClaim(bytes32 claimId);
    error InvalidStatus(bytes32 claimId, Status current);
    error EvidenceNotAnchored(bytes32 evidenceId);
    error EvidenceNotCurrent(bytes32 evidenceId);
    error DuplicateClaim(bytes32 exclusivityKey, bytes32 existingClaimId);
    error EvidenceAlreadyClaimed(bytes32 evidenceId, bytes32 existingClaimId);
    error ConflictOfInterest(address reviewer);

    event RoleUpdated(bytes32 indexed role, address indexed account, bool allowed, address indexed updatedBy);
    event ClaimSubmitted(
        bytes32 indexed claimId,
        bytes32 indexed exclusivityKey,
        bytes32 indexed evidenceId,
        bytes32 claimHash,
        bytes32 supersedes,
        address claimant
    );
    event ClaimChallenged(bytes32 indexed claimId, address indexed challenger, bytes32 reasonHash);
    event ChallengeResolved(bytes32 indexed claimId, bool upheld, address indexed reviewer);
    event ClaimSuperseded(bytes32 indexed originalClaimId, bytes32 indexed correctedClaimId, address indexed reviewer);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    modifier onlyClaimant() {
        if (!isClaimant[msg.sender]) revert NotClaimant(msg.sender);
        _;
    }

    modifier onlyReviewer() {
        if (!isReviewer[msg.sender]) revert NotReviewer(msg.sender);
        _;
    }

    constructor(address evidenceRegistry_) {
        if (evidenceRegistry_ == address(0)) revert ZeroAddress();
        admin = msg.sender;
        evidenceRegistry = IEvidenceRegistry(evidenceRegistry_);
    }

    function setClaimant(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isClaimant[account] = allowed;
        emit RoleUpdated(CLAIMANT_ROLE, account, allowed, msg.sender);
    }

    function setReviewer(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isReviewer[account] = allowed;
        emit RoleUpdated(REVIEWER_ROLE, account, allowed, msg.sender);
    }

    function submitClaim(bytes32 claimId, bytes32 exclusivityKey, bytes32 evidenceId, bytes32 claimHash)
        external
        onlyClaimant
    {
        _register(claimId, exclusivityKey, evidenceId, claimHash, bytes32(0), msg.sender);
    }

    /// @notice Anyone may challenge a submitted claim. Only a reviewer can decide it.
    function challengeClaim(bytes32 claimId, bytes32 reasonHash) external {
        if (reasonHash == bytes32(0)) revert EmptyReason();
        Claim storage claim = _existing(claimId);
        if (claim.status != Status.Submitted) revert InvalidStatus(claimId, claim.status);
        claim.status = Status.Challenged;
        claim.challenger = msg.sender;
        claim.challengeReasonHash = reasonHash;
        emit ClaimChallenged(claimId, msg.sender, reasonHash);
    }

    /// @notice Upheld: the claim is rejected and its scope is released. Dismissed: it returns to Submitted.
    function resolveChallenge(bytes32 claimId, bool upheld) external onlyReviewer {
        Claim storage claim = _existing(claimId);
        if (claim.status != Status.Challenged) revert InvalidStatus(claimId, claim.status);
        if (claim.claimant == msg.sender) revert ConflictOfInterest(msg.sender);
        if (upheld) {
            claim.status = Status.Rejected;
            _release(claimId, claim);
        } else {
            claim.status = Status.Submitted;
        }
        emit ChallengeResolved(claimId, upheld, msg.sender);
    }

    /// @notice Replaces a challenged claim with a corrected one in the same scope.
    ///         The original stays readable and points forward to its correction.
    function approveCorrection(bytes32 originalClaimId, bytes32 correctedClaimId, bytes32 evidenceId, bytes32 claimHash)
        external
        onlyReviewer
    {
        Claim storage original = _existing(originalClaimId);
        if (original.status != Status.Challenged) revert InvalidStatus(originalClaimId, original.status);
        if (original.claimant == msg.sender) revert ConflictOfInterest(msg.sender);

        bytes32 exclusivityKey = original.exclusivityKey;
        address claimant = original.claimant;
        original.status = Status.Superseded;
        original.supersededBy = correctedClaimId;
        _release(originalClaimId, original);

        _register(correctedClaimId, exclusivityKey, evidenceId, claimHash, originalClaimId, claimant);
        emit ClaimSuperseded(originalClaimId, correctedClaimId, msg.sender);
    }

    function getClaim(bytes32 claimId) external view returns (Claim memory) {
        return claims[claimId];
    }

    function _register(
        bytes32 claimId,
        bytes32 exclusivityKey,
        bytes32 evidenceId,
        bytes32 claimHash,
        bytes32 supersedes,
        address claimant
    ) private {
        if (claimId == bytes32(0)) revert EmptyClaimId();
        if (exclusivityKey == bytes32(0)) revert EmptyExclusivityKey();
        if (claimHash == bytes32(0)) revert EmptyClaimHash();
        if (claims[claimId].status != Status.None) revert ClaimIdTaken(claimId);
        if (!evidenceRegistry.exists(evidenceId)) revert EvidenceNotAnchored(evidenceId);
        if (!evidenceRegistry.isCurrent(evidenceId)) revert EvidenceNotCurrent(evidenceId);
        bytes32 activeForKey = activeClaimForKey[exclusivityKey];
        if (activeForKey != bytes32(0)) revert DuplicateClaim(exclusivityKey, activeForKey);
        bytes32 activeForEvidence = activeClaimForEvidence[evidenceId];
        if (activeForEvidence != bytes32(0)) revert EvidenceAlreadyClaimed(evidenceId, activeForEvidence);

        claims[claimId] = Claim({
            exclusivityKey: exclusivityKey,
            evidenceId: evidenceId,
            claimHash: claimHash,
            supersedes: supersedes,
            supersededBy: bytes32(0),
            challengeReasonHash: bytes32(0),
            claimant: claimant,
            challenger: address(0),
            status: Status.Submitted,
            submittedBlock: uint64(block.number)
        });
        activeClaimForKey[exclusivityKey] = claimId;
        activeClaimForEvidence[evidenceId] = claimId;
        claimCount += 1;
        emit ClaimSubmitted(claimId, exclusivityKey, evidenceId, claimHash, supersedes, claimant);
    }

    function _existing(bytes32 claimId) private view returns (Claim storage claim) {
        claim = claims[claimId];
        if (claim.status == Status.None) revert UnknownClaim(claimId);
    }

    function _release(bytes32 claimId, Claim storage claim) private {
        if (activeClaimForKey[claim.exclusivityKey] == claimId) delete activeClaimForKey[claim.exclusivityKey];
        if (activeClaimForEvidence[claim.evidenceId] == claimId) delete activeClaimForEvidence[claim.evidenceId];
    }
}
