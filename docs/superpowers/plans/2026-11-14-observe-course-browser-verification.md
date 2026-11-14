# Course Browser Verification Implementation Plan

**Goal** Compare a full real-material browser verification and a verification scoped to changed courses on the same pinned inputs and bundle.

**Architecture** Extend the verified public deployment checkpoint with a digest for each course. The normal release continues to require full proof. An observed run filters document-level browsing, keeps site-wide checks, and reports timing and coverage in the Actions summary.

1. Extend input fingerprinting and checkpoints. Test isolated changes, multiple changed courses, old checkpoints, different hub commits, and active deployment mismatches. Run the fingerprint and checkpoint tests.
2. Add observed verification to the existing verifier. Keep source and bundle integrity checks, the workbook audit, font fallback probes, and all 42 representative scenarios. Test that observed verification preserves the canonical proof and that invalid scope or incomplete document coverage yields no successful measurement.
3. Wire `STUDY_HUB_COURSE_VERIFICATION=observe` into the production workflow after source binding and Reader revocation. Run both verifiers against the same build and export only bounded counts, durations, and outcome. Exercise enabled and ineligible workflow cases, then run the full test suite and measure a real course change.
