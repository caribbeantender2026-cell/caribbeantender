/**
 * An account's picture, or a person icon when it has none or it can't load. Pictures live in the
 * public account-pictures bucket (migration 20261117010000), so each one is a plain, cacheable link.
 */
import { UserRoundIcon } from 'lucide-react';
import { classNames } from '../lib/classNames.ts';
import { supabase } from '../lib/supabase.ts';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar.tsx';

export const accountPicturesBucket = 'account-pictures';

/** The picture with a person icon behind it. Size and colours come from className. */
export function AccountPicture({ picturePath, className }: { picturePath: string | null | undefined; className?: string }) {
  return (
    <Avatar className={classNames('rounded-[10px] bg-ink text-white', className)} aria-hidden="true">
      {picturePath && <AvatarImage src={supabase.storage.from(accountPicturesBucket).getPublicUrl(picturePath).data.publicUrl} alt="" />}
      <AvatarFallback>
        <UserRoundIcon className="size-[55%]" />
      </AvatarFallback>
    </Avatar>
  );
}
