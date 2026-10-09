import { cache } from 'react';
import { loadInvite } from './invite';

/** One fetch per request, shared by generateMetadata and the page. */
export const getInvite = cache((code: string) => loadInvite(code));
