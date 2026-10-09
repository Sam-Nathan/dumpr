import { rpc } from '../../data/rpc';

/** Roll-only members (guests, people invited to one Roll) can leave it. */
export const leaveRoll = (rollId: string) => rpc<void>('leave_roll', { p_roll_id: rollId });
