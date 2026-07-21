import { validateParentHandoffV3 } from '../explorer/schemas.mjs';

const ELIGIBLE_STATES = new Set(['complete', 'verify_targets']);

function supportingText(oracle, anchorId) {
  const texts = (oracle.allowedClaims ?? [])
    .filter(claim => claim.evidenceAnchorRefs?.includes(anchorId))
    .map(claim => claim.text)
    .filter(value => typeof value === 'string' && value.trim());
  return [...new Set(texts)].join(' ');
}

export function buildOracleParentHandoff(caseDefinition) {
  const oracle = caseDefinition?.oracle;
  if (!oracle || !ELIGIBLE_STATES.has(oracle.expectedState) ||
      !Array.isArray(oracle.allowedClaims) || oracle.allowedClaims.length === 0 ||
      !Array.isArray(oracle.evidenceAnchors) || oracle.evidenceAnchors.length === 0) {
    throw new Error('Eligible parent-observation case needs an independent answer and evidence oracle.');
  }
  const directAnswer = oracle.allowedClaims.map(item => item.text).join('\n');
  const evidence = oracle.evidenceAnchors.map(anchor => {
    const supports = supportingText(oracle, anchor.id);
    if (!supports) throw new Error('Every oracle evidence anchor must support an allowed claim.');
    if (anchor.kind === 'source') {
      return {
        id: anchor.id,
        kind: 'source',
        path: anchor.path,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        supports,
      };
    }
    if (anchor.kind === 'search' && anchor.matchCount === 0 && anchor.enumerationComplete === true &&
        anchor.toolTruncated === false && anchor.contextTruncated === false &&
        anchor.omittedOutOfScopeFiles === 0 && anchor.deniedPaths === 0 && anchor.errors === 0) {
      return {
        id: anchor.id,
        kind: 'absence',
        boundary: anchor.boundary,
        searches: [`${anchor.tool}:bounded_zero_match`],
        supports,
      };
    }
    throw new Error('Oracle evidence anchor cannot be projected into a certified schema-v3 handoff.');
  });
  const handoff = {
    schemaVersion: 3,
    directAnswer,
    state: oracle.expectedState,
    evidence,
    ...(oracle.expectedState === 'verify_targets' ? {
      targets: evidence.filter(item => item.kind === 'source').map(item => ({
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        role: 'read',
        reason: item.supports,
        evidenceRefs: [item.id],
      })),
    } : {}),
  };
  validateParentHandoffV3(handoff);
  return handoff;
}
