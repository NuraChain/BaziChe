import { ownersOf } from '../admin/roles.ts';

export function isAdminAddress(address: string | null, admin: string)
{
    return address !== null && ownersOf(admin).includes(address.toLowerCase());
}
