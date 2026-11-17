/** shadcn/ui avatar: shows its image once it has loaded, and the fallback until then or if it can't load. */
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

/** The avatar's frame. */
function Avatar({ className, ...properties }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root data-slot="avatar" className={classNames('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)} {...properties} />;
}

/** The picture, rendered only after it has loaded. */
function AvatarImage({ className, ...properties }: ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={classNames('aspect-square size-full object-cover', className)} {...properties} />;
}

/** What shows while there is no loaded picture. */
function AvatarFallback({ className, ...properties }: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={classNames('flex size-full items-center justify-center', className)} {...properties} />;
}

export { Avatar, AvatarFallback, AvatarImage };
