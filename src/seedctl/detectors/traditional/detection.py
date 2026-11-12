from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from seedctl.detectors.traditional.candidates import CandidateEvidence
from seedctl.detectors.traditional.config import DecisionConfig
from seedctl.detectors.traditional.proposals import SeedProposal
from seedctl.detectors.traditional.results import SeedDetection
from seedctl.detectors.traditional.scoring import CandidateModel


@dataclass(frozen=True)
class ScoredCandidate:
    proposal: SeedProposal
    evidence: CandidateEvidence
    confidence: float


@dataclass(frozen=True)
class CandidateSelection:
    candidates: list[ScoredCandidate]
    detections: list[SeedDetection]


def _deduplicate(
    candidates: list[ScoredCandidate], config: DecisionConfig
) -> list[ScoredCandidate]:
    accepted: list[ScoredCandidate] = []
    for candidate in sorted(candidates, key=lambda item: item.confidence, reverse=True):
        proposal = candidate.proposal
        overlaps = any(
            (proposal.x - other.proposal.x) ** 2 + (proposal.y - other.proposal.y) ** 2
            < (
                config.duplicate_distance_scale
                * min(proposal.scale, other.proposal.scale)
            )
            ** 2
            for other in accepted
        )
        if not overlaps:
            accepted.append(candidate)
    return accepted


def detect_seeds(
    proposals: list[SeedProposal],
    evidence: list[CandidateEvidence],
    model: CandidateModel,
    config: DecisionConfig,
) -> CandidateSelection:
    confidences = model.score(evidence)
    scored = [
        ScoredCandidate(proposal, description, float(confidence))
        for proposal, description, confidence in zip(
            proposals, evidence, confidences, strict=True
        )
    ]
    eligible = [
        candidate
        for candidate in scored
        if candidate.confidence >= config.confidence_threshold
        and np.isfinite(candidate.confidence)
    ]
    accepted = _deduplicate(eligible, config)
    detections = [
        SeedDetection(
            detection_id=index,
            x=candidate.proposal.x,
            y=candidate.proposal.y,
            scale=candidate.proposal.scale,
            score=candidate.confidence,
        )
        for index, candidate in enumerate(
            sorted(accepted, key=lambda item: (item.proposal.y, item.proposal.x)),
            start=1,
        )
    ]
    return CandidateSelection(candidates=scored, detections=detections)
