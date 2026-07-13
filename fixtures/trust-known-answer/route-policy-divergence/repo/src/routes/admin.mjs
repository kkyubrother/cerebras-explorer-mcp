import { requireAnyRole } from '../policy.mjs';

export const authorizeAdminRoute = requireAnyRole('super_admin');
