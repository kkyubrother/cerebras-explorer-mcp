import { requireAnyRole } from '../policy.mjs';

export const authorizeTeamRoute = requireAnyRole('admin', 'manager');
